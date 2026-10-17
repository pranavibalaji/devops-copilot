"""Human approval gate for simulated remediation."""

import json
import os
import sys
import threading
import time
from typing import Optional, Dict, Any

# In-memory approval events for web/API integration
_pending_approvals: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()

# --- Shared (cross-process) approval record ----------------------------------
#
# The API and the listener are separate processes and each one used to keep
# only its own private _pending_approvals dict. An incident the listener was
# waiting on therefore could not be approved from the dashboard, because the
# API could not see it (it answered 404). The decision is now mirrored into
# Redis under "approval:<incident_id>", a place both processes already share.
#
# The local dict still owns the threading.Event, because events cannot cross
# process boundaries — so a waiter also polls Redis to pick up a decision that
# was made by the *other* process.
_APPROVAL_KEY_PREFIX = "approval:"
_APPROVAL_TTL_SECONDS = 3600  # safety net; the live wait itself is 300s
_SHARED_POLL_SECONDS = 1.0  # how often a waiter re-checks Redis
WEB_APPROVAL_TIMEOUT_SECONDS = 300.0  # how long anyone may hold the gate

_shared_client = None
_shared_client_lock = threading.Lock()


def _shared_client_ref():
    """Shared Redis client, or None when Redis is unavailable.

    Approval must never hard-depend on Redis: whenever it is unreachable,
    every helper below degrades to this process's own memory, which is
    exactly how the gate behaved before it was shared.
    """
    global _shared_client
    if _shared_client is not None:
        return _shared_client
    with _shared_client_lock:
        if _shared_client is None:
            try:
                from agent.redis_queue import get_redis_client

                _shared_client = get_redis_client()
            except Exception:
                return None
    return _shared_client


def _shared_key(incident_id: str) -> str:
    return f"{_APPROVAL_KEY_PREFIX}{incident_id}"


def _read_shared(incident_id: str) -> Optional[Dict[str, Any]]:
    client = _shared_client_ref()
    if client is None:
        return None
    try:
        raw = client.get(_shared_key(incident_id))
    except Exception:
        return None
    if not raw:
        return None
    try:
        record = json.loads(raw)
    except Exception:
        return None
    return record if isinstance(record, dict) else None


def _read_shared_status(incident_id: str) -> Optional[str]:
    """Status where both processes can see it, or None if there is no record."""
    record = _read_shared(incident_id)
    if not record:
        return None
    status = record.get("status")
    return status if isinstance(status, str) else None


def _write_shared(record: Dict[str, Any]) -> None:
    client = _shared_client_ref()
    incident_id = record.get("incident_id")
    if client is None or not incident_id:
        return
    try:
        client.setex(
            _shared_key(incident_id),
            _APPROVAL_TTL_SECONDS,
            json.dumps(record, default=str),
        )
    except Exception:
        pass


def _publish_status(
    incident_id: str, status: str, entry: Optional[Dict[str, Any]] = None
) -> None:
    """Mirror an approval status where the other process can see it.

    Existing fields are preserved, so a decision made by a process that never
    registered the request (the API approving a listener-run incident) still
    keeps the action/service/confidence the registrant published.
    """
    record = _read_shared(incident_id) or {}
    record["incident_id"] = incident_id
    record["status"] = status
    if entry:
        for key in ("action", "service", "confidence", "timestamp"):
            if key in entry:
                record[key] = entry[key]
    record["updated_at"] = time.time()
    _write_shared(record)


def _entry_fields(entry: Dict[str, Any]) -> Dict[str, Any]:
    """The serialisable half of a local entry (the Event cannot be shared)."""
    return {key: entry[key] for key in ("action", "service", "confidence", "timestamp") if key in entry}


def register_pending_approval(incident_id: str, action: str, service: str, confidence: float) -> threading.Event:
    """Register an approval request and return the threading.Event to wait on."""
    with _lock:
        evt = threading.Event()
        entry = {
            "event": evt,
            "status": "pending",
            "action": action,
            "service": service,
            "confidence": confidence,
            "timestamp": time.time(),
        }
        _pending_approvals[incident_id] = entry
        fields = _entry_fields(entry)
    # Announce it where the other process can see it.
    _publish_status(incident_id, "pending", fields)
    return evt


def record_approval_decision(incident_id: str, decision: str) -> bool:
    """Resolve a pending approval with 'approved' or 'denied'.

    Returns True ONLY when this exact incident has a still-pending approval —
    either one this process is waiting on, or one the *other* process
    published to the shared Redis record. That second case is what lets the
    dashboard approve an incident the listener is waiting on.

    There is deliberately no "fall back to the newest pending approval"
    shortcut: approving an unknown or already-finished id must not silently
    release a different incident's gate. Returning False lets the caller
    report "not found" instead of corrupting another record.
    """
    with _lock:
        entry = _pending_approvals.get(incident_id)
        if entry is not None:
            if entry["status"] != "pending":
                # Already approved/denied/expired here — nothing left to do.
                return False
            entry["status"] = decision
            entry["event"].set()
            fields = _entry_fields(entry)
            decided_locally = True
        else:
            fields = None
            decided_locally = False

    if decided_locally:
        # The waiter lives here, so its event has already been released.
        _publish_status(incident_id, decision, fields)
        return True

    # Not ours: the waiter may be the other process (the listener).
    if _read_shared_status(incident_id) == "pending":
        _publish_status(incident_id, decision, None)
        return True

    return False


def get_pending_approval(incident_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve pending approval metadata if present."""
    with _lock:
        return _pending_approvals.get(incident_id)


def _await_web_approval(id_key: str, evt: threading.Event) -> str:
    """Wait for an approval decision coming from the Web UI / API.

    A decision can arrive two ways:

    * from **this** process — the local event fires and the waiter wakes at
      once, or
    * from the **other** process (the API approving an incident the listener
      registered) — only the shared Redis record changes, so the waiter polls
      it at a coarse interval to notice.

    Either way the wait is bounded, and an unanswered gate is closed when it
    expires so a much later click cannot release an incident nobody watches.
    """
    print(f"   Approval: waiting for Web UI approval (incident: {id_key})...")
    deadline = time.monotonic() + WEB_APPROVAL_TIMEOUT_SECONDS

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break

        # Sleep locally first: it wakes instantly on our own decision.
        if evt.wait(timeout=min(_SHARED_POLL_SECONDS, remaining)):
            with _lock:
                local = _pending_approvals.get(id_key, {}).get("status", "pending")
            if local in {"approved", "denied"}:
                print(f"   Approval received from Web UI: {local}")
                return local
            # Signalled without a usable decision: never spin on it.
            time.sleep(0.05)

        shared = _read_shared_status(id_key)
        if shared in {"approved", "denied"}:
            # The other process decided; adopt it here so this process's view
            # stays consistent with the record everyone else can read.
            with _lock:
                entry = _pending_approvals.get(id_key)
                if entry is not None and entry["status"] == "pending":
                    entry["status"] = shared
                    entry["event"].set()
            print(f"   Approval received from Web UI: {shared}")
            return shared
        if shared == "expired":
            print("   Approval: gate closed elsewhere")
            return "pending"

    # Nobody answered in time. Close the gate.
    with _lock:
        entry = _pending_approvals.get(id_key)
        if entry is not None and entry["status"] == "pending":
            entry["status"] = "expired"
            fields = _entry_fields(entry)
        else:
            fields = None
    if _read_shared_status(id_key) == "pending":
        _publish_status(id_key, "expired", fields)
    print("   Approval: timed out waiting for Web UI (pending)")
    return "pending"


DEFAULT_INPUT_TIMEOUT_SECONDS = 30.0
_MIN_INPUT_TIMEOUT_SECONDS = 1.0
_MAX_INPUT_TIMEOUT_SECONDS = 600.0


def _input_timeout_seconds() -> float:
    """Seconds the terminal prompt may block before falling back to the Web UI.

    Configurable through APPROVAL_INPUT_TIMEOUT, but clamped to a safe range
    so the old "wait forever" behaviour cannot be switched back on by
    accident (a zero or negative value would reintroduce the hang).
    """
    raw = os.getenv("APPROVAL_INPUT_TIMEOUT", "").strip()
    try:
        seconds = float(raw) if raw else DEFAULT_INPUT_TIMEOUT_SECONDS
    except ValueError:
        return DEFAULT_INPUT_TIMEOUT_SECONDS
    return min(max(seconds, _MIN_INPUT_TIMEOUT_SECONDS), _MAX_INPUT_TIMEOUT_SECONDS)


def _prompt_with_timeout(prompt: str, timeout: float) -> Optional[str]:
    """Ask on the terminal without ever blocking forever.

    Returns the typed line, or None when input() is unavailable, raised, or
    produced no answer within `timeout` seconds.

    input() has no timeout of its own, so the read runs on a daemon thread:
    the caller keeps control and can move on. A thread left parked on stdin
    cannot hold the process open, because daemon threads are abandoned at
    exit.
    """
    box: Dict[str, Any] = {}

    def _ask() -> None:
        try:
            box["answer"] = input(prompt)
        except (EOFError, KeyboardInterrupt, OSError):
            box["answer"] = None

    worker = threading.Thread(target=_ask, daemon=True, name="approval-input")
    worker.start()
    worker.join(timeout)
    if worker.is_alive():
        # Nobody typed in time. Leave the thread parked on stdin; being a
        # daemon it will never block process exit.
        return None
    return box.get("answer")


def request_approval(action: str, service: str, confidence: float, incident_id: Optional[str] = None) -> str:
    """Return approved, denied, or pending without executing an action."""
    mode = os.getenv("APPROVAL_MODE", "manual").lower()

    print("\n[APPROVAL] Remediation requires approval")
    print(f"   Action: {action} | Service: {service} | Confidence: {confidence:.0%}")

    if mode == "auto":
        print("   Approval: configured local demo approval")
        return "approved"
    if mode == "deny":
        print("   Approval: denied by configuration")
        return "denied"

    id_key = incident_id or f"inc-{int(time.time())}"
    evt = register_pending_approval(id_key, action, service, confidence)

    if not sys.stdin.isatty():
        return _await_web_approval(id_key, evt)

    # Interactive terminal. input() can fail (detached process, redirected
    # stdin, closed console) — and worse, it can block forever when the
    # process merely *looks* interactive but nobody is at the keyboard (a
    # background listener, a detached console). A wedged input() stalls the
    # whole pipeline and leaves this process deaf to new alerts, so the wait
    # is always bounded: no answer in time falls back to Web UI approval.
    answer = _prompt_with_timeout(
        "   Approve simulated remediation? [y/N]: ",
        _input_timeout_seconds(),
    )
    if answer is None:
        print("   Approval: no interactive input (unavailable or timed out)")
        return _await_web_approval(id_key, evt)

    decision = "approved" if answer.strip().lower() in {"y", "yes"} else "denied"
    record_approval_decision(id_key, decision)
    return decision

