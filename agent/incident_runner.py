"""
Incident runner coordinates the LangGraph execution with real-time state streaming,
Redis synchronization, and human approval tracking.
"""

import os
import sys
import json
import time
import threading
from datetime import datetime
from typing import Dict, Any, Optional, List

# Force UTF-8 on stdout/stderr so emoji print() calls in graph.py
# don't crash on Windows where the default codec is cp1252.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from agent.state import IncidentState
from agent.graph import build_graph, MAX_RETRIES
from agent.approval import record_approval_decision, get_pending_approval
from agent.redis_queue import get_redis_client, publish_alert
from agent.memory import recall_similar_incidents, _get_collection
from agent.simulated_env import reset_state

# In-memory store for active incidents (fallback / fast read)
_incidents_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = threading.Lock()


def _get_redis_safe():
    try:
        r = get_redis_client()
        r.ping()
        return r
    except Exception:
        return None


def _save_incident_to_redis(incident_id: str, record: Dict[str, Any]):
    r = _get_redis_safe()
    if r:
        try:
            r.set(f"incident:{incident_id}", json.dumps(record, default=str), ex=86400)
            # Publish state update event so any listener or SSE client gets notified
            r.publish("incident_updates", json.dumps({
                "incident_id": incident_id,
                "status": record.get("status"),
                "current_stage": record.get("current_stage"),
            }, default=str))
        except Exception as e:
            print(f"[incident_runner] Redis save warning: {e}")


def _load_incident_from_redis(incident_id: str) -> Optional[Dict[str, Any]]:
    r = _get_redis_safe()
    if r:
        try:
            data = r.get(f"incident:{incident_id}")
            if data:
                return json.loads(data)
        except Exception as e:
            print(f"[incident_runner] Redis load warning: {e}")
    return None


def init_incident_record(incident_id: str, alert: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.utcnow().isoformat() + "Z"
    service = alert.get("service", "unknown")
    affected = alert.get("affected_services") or [service]
    if isinstance(affected, str):
        affected = [affected]

    record = {
        "incident_id": incident_id,
        "title": alert.get("title", f"Incident on {service}"),
        "service": service,
        "severity": alert.get("severity", "P1"),
        "status": "investigating",  # investigating | awaiting_approval | resolved | escalated | error
        "current_stage": "ingest_alert",
        "started_at": now,
        "resolved_at": None,
        "duration_seconds": None,
        "alert": alert,
        "affected_services": affected,
        "stages": [
            {"id": "ingest_alert", "title": "Alert Ingestion", "status": "running", "timestamp": now},
            {"id": "recall_memory", "title": "Memory Search", "status": "pending", "timestamp": None},
            {"id": "fetch_evidence", "title": "Evidence Collection", "status": "pending", "timestamp": None},
            {"id": "fetch_runbook", "title": "Runbook Retrieval", "status": "pending", "timestamp": None},
            {"id": "make_decision", "title": "Groq Decision", "status": "pending", "timestamp": None},
            {"id": "human_approval", "title": "Human Approval", "status": "pending", "timestamp": None},
            {"id": "auto_remediate", "title": "Simulated Remediation", "status": "pending", "timestamp": None},
            {"id": "verify_remediation", "title": "Verification", "status": "pending", "timestamp": None},
            {"id": "generate_report", "title": "Incident Report", "status": "pending", "timestamp": None},
            {"id": "save_to_memory", "title": "ChromaDB Storage", "status": "pending", "timestamp": None},
        ],
        "evidence": {
            "logs": [],
            "metrics": [],
            "service_health": {},
            "deployment_history": {},
        },
        "similar_past_incidents": [],
        "runbook": {
            "title": "",
            "content": "",
        },
        "decision": {
            "hypothesis": "",
            "recommended_action": "",
            "confidence": 0.0,
            "root_cause": "",
            "provider": os.getenv("DECISION_PROVIDER", "groq"),
            "model": os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
        },
        "approval": {
            "status": "pending",  # pending | approved | denied
            "action": "",
            "service": service,
            "confidence": 0.0,
            "resolved_at": None,
        },
        "remediation": {
            "attempted": False,
            "result": "",
            "action": "",
            "service": service,
            "is_simulated": True,
        },
        "verification": {
            "before": {},
            "after": {},
            "passed": False,
        },
        "report": "",
    }

    with _cache_lock:
        _incidents_cache[incident_id] = record
    _save_incident_to_redis(incident_id, record)
    return record


def _update_stage_status(record: Dict[str, Any], stage_id: str, new_status: str):
    now = datetime.utcnow().isoformat() + "Z"
    for stg in record["stages"]:
        if stg["id"] == stage_id:
            stg["status"] = new_status
            if new_status in {"running", "completed"}:
                stg["timestamp"] = now
            break


def execute_incident_stream(alert_payload: Dict[str, Any], incident_id: str) -> Dict[str, Any]:
    """
    Executes LangGraph workflow step-by-step and streams each stage to cache and Redis.
    """
    # Every incident starts from the simulator's canonical demo conditions.
    #
    # _state is process-global and remediation mutates it in place
    # (simulated_env sets services to "healthy"). It was never reset by the
    # API — only by the test suite — so after the first successful fix every
    # later incident in that process began "healthy". That made
    # verification.before lie, made verification.passed meaningless, and
    # reported REJECTED/unapproved incidents as "resolved".
    reset_state()

    # Ensure incident_id is passed in the alert payload
    alert_copy = dict(alert_payload)
    alert_copy["incident_id"] = incident_id
    if "triggered_at" not in alert_copy:
        alert_copy["triggered_at"] = datetime.utcnow().isoformat() + "Z"

    record = init_incident_record(incident_id, alert_copy)
    start_time = time.time()

    initial_state = IncidentState(
        alert=alert_copy,
        logs=[],
        metrics=[],
        service_health={},
        deployment_history={},
        runbook_title="",
        runbook_content="",
        root_cause="",
        hypothesis="",
        confidence=0.0,
        confidence_history=[],
        severity=alert_copy.get("severity", "P1"),
        affected_services=alert_copy.get("affected_services") or [alert_copy.get("service", "unknown")],
        team_paged="",
        slack_thread="",
        ticket_id=incident_id,
        incident_report="",
        status="investigating",
        needs_escalation=False,
        retry_count=0,
        max_retries=MAX_RETRIES,
        remediation_attempted=False,
        remediation_result="",
        similar_past_incidents=[],
        decision={},
        approval_status="pending",
        verification={},
    )

    try:
        app = build_graph()
        config = {"configurable": {"thread_id": incident_id}}

        # Stream node execution
        for step in app.stream(initial_state, config=config):
            node_name = list(step.keys())[0]
            step_output = step[node_name]

            # Mark completed node
            _update_stage_status(record, node_name, "completed")

            if node_name == "ingest_alert":
                record["severity"] = step_output.get("severity", record["severity"])
                record["affected_services"] = step_output.get("affected_services", record["affected_services"])
                _update_stage_status(record, "recall_memory", "running")
                record["current_stage"] = "recall_memory"

            elif node_name == "recall_memory":
                similar = step_output.get("similar_past_incidents", [])
                record["similar_past_incidents"] = similar
                _update_stage_status(record, "fetch_evidence", "running")
                record["current_stage"] = "fetch_evidence"

            elif node_name == "fetch_evidence":
                logs = step_output.get("logs", [])
                metrics = step_output.get("metrics", [])
                sh = step_output.get("service_health", {})
                dh = step_output.get("deployment_history", {})
                record["evidence"]["logs"] = logs
                record["evidence"]["metrics"] = metrics
                record["evidence"]["service_health"] = sh
                record["evidence"]["deployment_history"] = dh
                record["verification"]["before"] = {
                    "service_health": sh,
                    "error_rates": {s: f"{float(metrics[0].get('value', 0)):.1f}%" if metrics else "elevated" for s in record["affected_services"]},
                }
                _update_stage_status(record, "fetch_runbook", "running")
                record["current_stage"] = "fetch_runbook"

            elif node_name == "fetch_runbook":
                record["runbook"]["title"] = step_output.get("runbook_title", "")
                record["runbook"]["content"] = step_output.get("runbook_content", "")
                _update_stage_status(record, "make_decision", "running")
                record["current_stage"] = "make_decision"

            elif node_name == "make_decision":
                dec = step_output.get("decision", {})
                conf = float(step_output.get("confidence", 0.0))
                record["decision"] = {
                    "hypothesis": step_output.get("hypothesis", dec.get("hypothesis", "")),
                    "root_cause": step_output.get("root_cause", dec.get("root_cause", "")),
                    "recommended_action": dec.get("recommended_action", "investigate_more"),
                    "confidence": conf,
                    "provider": dec.get("provider", os.getenv("DECISION_PROVIDER", "groq")),
                    "model": dec.get("model", os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")),
                    "action_plan": dec.get("action_plan", []),
                    "evidence_summary": dec.get("evidence_summary", ""),
                    "risk_assessment": dec.get("risk_assessment", ""),
                }
                record["approval"]["action"] = dec.get("recommended_action", "investigate_more")
                record["approval"]["confidence"] = conf
                record["approval"]["service"] = record["affected_services"][0] if record["affected_services"] else record["service"]
                record["status"] = "awaiting_approval"
                record["current_stage"] = "human_approval"
                _update_stage_status(record, "human_approval", "running")

            elif node_name == "human_approval":
                app_status = step_output.get("approval_status", "pending")
                record["approval"]["status"] = app_status
                record["approval"]["resolved_at"] = datetime.utcnow().isoformat() + "Z"
                _update_stage_status(record, "human_approval", "completed")
                _update_stage_status(record, "auto_remediate", "running")
                record["current_stage"] = "auto_remediate"
                if app_status == "approved":
                    record["status"] = "mitigating"
                elif app_status == "denied":
                    record["status"] = "rejected"

            elif node_name == "auto_remediate":
                record["remediation"]["attempted"] = step_output.get("remediation_attempted", False)
                record["remediation"]["result"] = step_output.get("remediation_result", "")
                record["remediation"]["action"] = record["approval"]["action"]
                record["remediation"]["service"] = record["approval"]["service"]
                _update_stage_status(record, "verify_remediation", "running")
                record["current_stage"] = "verify_remediation"

            elif node_name == "verify_remediation":
                ver = step_output.get("verification", {})
                sh = ver.get("service_health", {})
                er = ver.get("error_rates", {})
                passed = all(v == "healthy" for v in sh.values()) if sh else False
                record["verification"]["after"] = {
                    "service_health": sh,
                    "error_rates": er,
                }
                record["verification"]["passed"] = passed
                _update_stage_status(record, "generate_report", "running")
                record["current_stage"] = "generate_report"

            elif node_name == "generate_report":
                record["report"] = step_output.get("incident_report", "")
                _update_stage_status(record, "save_to_memory", "running")
                record["current_stage"] = "save_to_memory"

            elif node_name == "save_to_memory":
                record["status"] = "resolved" if record["verification"].get("passed") else "mitigating"
                record["current_stage"] = "completed"
                # "resolved_at" must mean *when this incident was actually
                # fixed*. It used to be stamped unconditionally, producing
                # records that claimed "resolved at 03:02" while their status
                # still read "mitigating". duration_seconds below still records
                # when the run ended, which is what the dashboard displays.
                if record["status"] == "resolved":
                    record["resolved_at"] = datetime.utcnow().isoformat() + "Z"
                record["duration_seconds"] = round(time.time() - start_time, 2)

            with _cache_lock:
                _incidents_cache[incident_id] = record
            _save_incident_to_redis(incident_id, record)

    except Exception as e:
        import traceback
        traceback.print_exc()
        record["status"] = "error"
        record["error"] = str(e)
        with _cache_lock:
            _incidents_cache[incident_id] = record
        _save_incident_to_redis(incident_id, record)

    return record


def get_incident(incident_id: str) -> Optional[Dict[str, Any]]:
    with _cache_lock:
        if incident_id in _incidents_cache:
            return _incidents_cache[incident_id]

    # Try Redis
    redis_rec = _load_incident_from_redis(incident_id)
    if redis_rec:
        with _cache_lock:
            _incidents_cache[incident_id] = redis_rec
        return redis_rec

    # Try ChromaDB memory
    try:
        similar = recall_similar_incidents(incident_id, limit=1)
        if similar:
            match = similar[0]
            # Convert memory match to a viewable incident format
            return {
                "incident_id": match.get("incident_id", incident_id),
                "title": match.get("title", f"Incident {incident_id}"),
                "service": match.get("service", "unknown"),
                "severity": match.get("severity", "P1"),
                "status": "resolved",
                "current_stage": "completed",
                "started_at": match.get("occurred_at"),
                "resolved_at": match.get("occurred_at"),
                "decision": {
                    "hypothesis": match.get("root_cause", ""),
                    "root_cause": match.get("root_cause", ""),
                    "recommended_action": match.get("resolution", ""),
                    "confidence": float(match.get("confidence", 0.9)),
                    "provider": "chromadb_memory",
                },
                "report": match.get("root_cause", ""),
                "source": "memory",
            }
    except Exception:
        pass

    return None


def _incident_is_active(record: Dict[str, Any]) -> bool:
    """True only while this incident's run is still in flight.

    ``_incidents_cache`` is a fast-read snapshot that this process never
    evicts, so treating *everything* in it as "active" reported finished
    incidents as active and then hid them from the past list (which skips
    any id already present there). The run is over once the graph reached
    its terminal stage or the record was stamped with ``resolved_at``.
    """
    if record.get("resolved_at"):
        return False
    return record.get("current_stage") != "completed"


def list_incidents(limit: int = 50) -> Dict[str, Any]:
    with _cache_lock:
        active_list = [r for r in _incidents_cache.values() if _incident_is_active(r)]

    # Load past from ChromaDB
    past = []
    try:
        col = _get_collection()
        if col.count() > 0:
            stored = col.get(include=["metadatas"])
            for m in stored["metadatas"]:
                inc_id = m.get("incident_id")
                # Do not duplicate if already in active_list
                if not any(a["incident_id"] == inc_id for a in active_list):
                    past.append({
                        "incident_id": inc_id,
                        "title": m.get("title", ""),
                        "service": m.get("service", "unknown"),
                        "severity": m.get("severity", "P1"),
                        "status": "resolved",
                        "occurred_at": m.get("occurred_at", ""),
                        "root_cause": m.get("root_cause", ""),
                        "resolution": m.get("resolution", ""),
                        "confidence": float(m.get("confidence", 0.9)),
                        "source": "memory",
                    })
    except Exception as e:
        print(f"[incident_runner] ChromaDB list error: {e}")

    # Sort active newest first
    active_sorted = sorted(active_list, key=lambda x: x.get("started_at", ""), reverse=True)[:limit]
    # Sort past newest first
    past_sorted = sorted(past, key=lambda x: x.get("occurred_at", ""), reverse=True)[:limit]

    return {
        "active": active_sorted,
        "past": past_sorted,
        "total_active": len(active_list),
        "total_memory": len(past),
    }


def approve_incident_remediation(incident_id: str) -> bool:
    success = record_approval_decision(incident_id, "approved")
    if not success:
        # No live, still-pending approval for THIS id. Do not touch the
        # incident record — writing here used to flip finished incidents
        # back to "mitigating" on a bogus approve request.
        return False
    return _apply_approval_decision(incident_id, "approved", "mitigating")


def reject_incident_remediation(incident_id: str) -> bool:
    success = record_approval_decision(incident_id, "denied")
    if not success:
        # Same guard as approve: never mutate a record that was not actually
        # waiting on this decision.
        return False
    return _apply_approval_decision(incident_id, "denied", "rejected")


def _apply_approval_decision(
    incident_id: str, decision: str, next_status: str
) -> bool:
    """Record an approval decision on the incident itself.

    Two rules keep this safe:

    * The decision is based on the **freshest** copy of the record, preferring
      Redis over this process's cache — the other process may have advanced
      the incident while we were not looking.
    * The record may only change while its own approval field is still
      pending. Approving must never resurrect an incident that already
      finished, even when the approval registry says otherwise.
    """
    with _cache_lock:
        record = _load_incident_from_redis(incident_id) or _incidents_cache.get(
            incident_id
        )
        if record is None:
            # Nothing to update. The decision itself was still recorded, so
            # the caller should report success rather than "not found".
            return True

        approval = record.get("approval")
        if not isinstance(approval, dict) or approval.get("status") != "pending":
            # Gate and record disagree: this one is already settled, or never
            # existed. Refuse to rewrite history.
            return False

        approval["status"] = decision
        approval["resolved_at"] = datetime.utcnow().isoformat() + "Z"
        record["status"] = next_status
        _incidents_cache[incident_id] = record
        _save_incident_to_redis(incident_id, record)
    return True
