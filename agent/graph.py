# agent/graph.py
# ── IMPORTS ──────────────────────────────────────────────────
import sys
import io

# Ensure stdout/stderr can handle emoji on Windows (cp1252 → UTF-8)
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
elif hasattr(sys.stdout, "buffer"):
    # Fallback: wrap the underlying buffer directly
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from typing import Literal
from datetime import datetime
import json

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from agent.state import IncidentState
from agent.tools import query_logs
from agent.llm import get_llm
from agent.reasoner import CONFIDENCE_THRESHOLD, MAX_RETRIES
from agent.metrics import query_metrics
from agent.rag import retrieve_runbook 
from agent.remediation import plan_remediation, execute_remediation
from agent.memory import recall_similar_incidents, store_incident
from agent.approval import request_approval
from agent.decision_provider import get_decision_provider
from agent.simulated_env import (
    get_deployment_history,
    get_service_health,
    verify_error_rate,
    verify_service_health,
)


# ── NODE 1: Alert Ingestion ───────────────────────────────────
def ingest_alert(state: IncidentState) -> dict:
    print("\n[ALERT] [Node 1] Ingesting alert...")
    alert = state["alert"]
    llm = get_llm()

    prompt = f"""You are an SRE triage agent. Analyze this alert and extract structured info.

Alert payload:
{json.dumps(alert, indent=2)}

Respond ONLY with valid JSON in this exact format:
{{
  "severity": "P0|P1|P2|P3",
  "affected_services": ["service1", "service2"],
  "alert_type": "latency|error_rate|saturation|availability|custom",
  "summary": "one sentence description of the problem"
}}

Severity guide:
- P0: full outage, revenue impact, >10% error rate
- P1: partial outage, degraded, >1% error rate
- P2: elevated errors, <1% error rate, no customer impact
- P3: warning threshold, investigation needed
"""

    response = llm.invoke(prompt)

    try:
        content = response.content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        parsed = json.loads(content.strip())
    except Exception:
        parsed = {
            "severity": "P1",
            "affected_services": [alert.get("service", "unknown")],
            "alert_type": "custom",
            "summary": alert.get("title", "Unknown incident")
        }

    print(f"   Severity: {parsed['severity']} | Services: {parsed['affected_services']}")

    return {
        "severity":          parsed["severity"],
        "affected_services": parsed["affected_services"],
        "status":            "investigating",
        "needs_escalation":  parsed["severity"] == "P0",
        "retry_count":       0,
        "max_retries":       MAX_RETRIES,
        "logs":              [],
        "metrics":           [],
        "confidence_history":[],
        "similar_past_incidents": [],
    }

# agent/graph.py — ADD node: recall_memory (goes BEFORE fetch_evidence)

def recall_memory(state: IncidentState) -> dict:
    """
    First thing the agent does after triage —
    search memory for similar past incidents.
    Results get injected into the reasoning prompt.

    Past incidents are an ENHANCEMENT, not a requirement. If the memory
    store is unreachable (embedding model failed to load, ChromaDB error,
    out of memory) we log it and continue with an empty list rather than
    killing the whole incident at node 2 — which is exactly how incidents
    used to get frozen at "recall_memory".
    """
    print(f"\n[MEMORY] [recall_memory] Searching past incidents...")

    query = " ".join([
        state["alert"].get("title", ""),
        state["alert"].get("metric", ""),
        " ".join(state.get("affected_services", [])),
    ])

    try:
        similar = recall_similar_incidents(query)
    except Exception as exc:
        # _get_collection() lives outside recall_similar_incidents()'s own
        # try/except, so a store failure reaches here and used to escape
        # uncaught, aborting the run.
        print(f"   [WARN] memory recall unavailable ({type(exc).__name__}: {exc})")
        print("   [WARN] continuing WITHOUT past-incident history")
        return {"similar_past_incidents": []}

    if similar:
        best = similar[0]
        print(f"   Best match: {best['incident_id']} ({best['similarity']:.0%}) — {best['title'][:50]}")

    return {"similar_past_incidents": similar}


# ── NODE 2: Fetch Evidence (logs + metrics) ───────────────────
def fetch_evidence(state: IncidentState) -> dict:
    retry  = state.get("retry_count", 0)
    window = [15, 30, 60][min(retry, 2)]

    print(f"\n[EVIDENCE] [fetch_evidence] retry={retry}, window={window}min")

    all_logs    = []
    all_metrics = []

    for service in state["affected_services"]:
        logs = query_logs(
            service=service,
            time_window_minutes=window,
            severity_filter=["ERROR", "CRITICAL", "FATAL"],
        )
        all_logs.extend(logs)

        metrics = query_metrics(
            service=service,
            time_window_minutes=window,
        )
        all_metrics.extend(metrics)

        print(f"   {service}: {len(logs)} logs, {len(metrics)} metrics")

    services = state["affected_services"]
    service_health = get_service_health(services)
    deployment_history = get_deployment_history(services)
    print(f"   Service health: {service_health}")
    print(f"   Deployment history: {deployment_history}")

    return {
        "logs":                all_logs,
        "metrics":             all_metrics,
        "service_health":      service_health,
        "deployment_history":  deployment_history,
    }


def make_decision(state: IncidentState) -> dict:
    """Ask the configured decision provider for structured incident decisions."""
    print("\n[DECISION] Evaluating structured incident decisions...")
    result = get_decision_provider().evaluate_incident(dict(state))
    confidence = float(result.get("confidence", 0.0))
    print(f"   Hypothesis: {result['hypothesis']}")
    print(f"   Recommended action: {result['recommended_action']}")
    print(f"   Confidence: {confidence:.0%}")

    return {
        "severity": result.get("severity", state.get("severity", "P1")),
        "hypothesis": result["hypothesis"],
        "root_cause": result["root_cause"],
        "confidence": confidence,
        "confidence_history": [{"attempt": 1, "score": confidence}],
        "retry_count": 1,
        "needs_escalation": not result.get("sufficient_evidence", False),
        "decision": result,
    }


# ── ROUTER: Confidence Loop ───────────────────────────────────
def confidence_router(state: IncidentState):
    confidence  = state.get("confidence", 0.0)
    retry_count = state.get("retry_count", 0)

    if confidence >= CONFIDENCE_THRESHOLD:
        print(f"\n[OK] Confidence {confidence:.0%} >= {CONFIDENCE_THRESHOLD:.0%} — requesting approval")
        return "proceed"

    if retry_count >= MAX_RETRIES:
        print(f"\n[WARN] Max retries ({MAX_RETRIES}) reached at {confidence:.0%} — escalating")
        return "escalate"

    print(f"\n[WARN] Confidence {confidence:.0%} < {CONFIDENCE_THRESHOLD:.0%} — escalating without remediation")
    return "escalate"


# ── NODE 4: Fetch Runbook ────────────────────────────────────
def fetch_runbook(state: IncidentState) -> dict:
    """
    Semantic runbook retrieval using ChromaDB RAG.
    Builds a rich query from the incident context — not just service name.
    """
    print(f"\n[RUNBOOK] [fetch_runbook] Querying ChromaDB...")

    # Build a rich semantic query from everything we know so far
    query = " ".join([
        state.get("hypothesis", ""),
        state.get("root_cause", ""),
        " ".join(state.get("affected_services", [])),
        state["alert"].get("metric", ""),
        state["alert"].get("title", ""),
    ]).strip()

    print(f"   Query: {query[:100]}...")

    result = retrieve_runbook(query)

    print(f"   Match: '{result['title']}' | Score: {result['relevance_score']:.0%}")

    return {
        "runbook_title":   result["title"],
        "runbook_content": result["content"],
    }

# agent/graph.py — add this new node

def auto_remediate(state: IncidentState) -> dict:
    """
    Autonomous remediation node.

    Runs ONLY after a human operator has approved the action
    (``approval_status == "approved"``). Approval is the gate; if it is
    missing we skip execution and let the report say so.

    NOTE: a confidence threshold of 0.92 exists (reasoner.CONFIDENCE_THRESHOLD)
    and was historically meant to be checked here, but this node does not
    evaluate it — and confidence_router(), the function that does, is not
    wired into build_graph(). See MIGRATION_HANDOFF.md.
    """
    decision = state.get("decision", {})
    action = decision.get("recommended_action", "investigate_more")
    confidence = state.get("confidence", 0.0)
    print(f"\n[REMEDIATION] action={action} confidence={confidence:.0%}")

    if state.get("approval_status") != "approved":
        return {
            "remediation_attempted": False,
            "remediation_result": "No remediation executed before human approval",
        }

    # Human operator approved this action
    if action == "investigate_more":
        action = "rollback" if state.get("deployment_history") else "restart"

    plan = plan_remediation(state.get("root_cause", ""), state.get("affected_services", []))
    plan["action"] = action if action in {"rollback", "restart", "scale", "clear_cache"} else plan.get("action", "rollback_deployment")
    plan["action"] = {
        "rollback": "rollback_deployment",
        "restart": "restart_service",
        "scale": "scale_pods",
    }.get(plan["action"], plan["action"])
    result = execute_remediation(plan)
    print(f"   {result['message']}")
    return {
        "remediation_attempted": True,
        "remediation_result": result["message"],
    }


def human_approval(state: IncidentState) -> dict:
    decision = state.get("decision", {})
    incident_id = state.get("ticket_id") or state.get("alert", {}).get("incident_id")
    status = request_approval(
        action=decision.get("recommended_action", "investigate_more"),
        service=(state.get("affected_services") or ["unknown"])[0],
        confidence=state.get("confidence", 0.0),
        incident_id=incident_id,
    )
    return {"approval_status": status}


def verify_remediation(state: IncidentState) -> dict:
    services = state.get("affected_services", [])
    health = verify_service_health(services)
    error_rates = verify_error_rate(services)
    print("\n[VERIFY] Reading simulated state after the decision...")
    print(f"   Health: {health}")
    print(f"   Error rates: {error_rates}")
    return {
        "verification": {"service_health": health, "error_rates": error_rates},
        "status": "resolved" if all(value == "healthy" for value in health.values()) else "mitigating",
    }

# ── NODE 5: Generate Report ───────────────────────────────────
def generate_report(state: IncidentState) -> dict:
    print("\n[REPORT] Generating postmortem...")
    services = ", ".join(state.get("affected_services", []))
    verification = state.get("verification", {})
    report = f"""# Incident Report

## Incident
{state['alert'].get('title', 'Incident')}

## Severity
{state.get('severity', 'unknown')}

## Affected Services
{services}

## Likely Cause
{state.get('root_cause', 'Unknown')}

## Evidence
- Hypothesis: {state.get('hypothesis', 'Unknown')}
- Runbook: {state.get('runbook_title', 'None')}
- Decision confidence: {state.get('confidence', 0):.0%}

## Decision and Approval
- Recommended action: {state.get('decision', {}).get('recommended_action', 'investigate_more')}
- Approval status: {state.get('approval_status', 'unknown')}
- Remediation: {state.get('remediation_result', 'No remediation')}

## Verification
{verification}

## Status
{state.get('status', 'unknown').upper()}
"""
    return {
        "incident_report": report.strip(),
    }

# agent/graph.py — ADD node: save_to_memory (goes AFTER generate_report)

def save_to_memory(state: IncidentState) -> dict:
    """
    Last thing the agent does —
    store this incident so future agents can learn from it.
    """
    print(f"\n[MEMORY] [save_to_memory] Storing incident in memory...")
    store_incident(state)
    return {}


def build_graph():
    graph = StateGraph(IncidentState)

    graph.add_node("ingest_alert",       ingest_alert)
    graph.add_node("recall_memory",      recall_memory)      
    graph.add_node("fetch_evidence",     fetch_evidence)
    graph.add_node("make_decision",      make_decision)
    graph.add_node("fetch_runbook",      fetch_runbook)
    graph.add_node("human_approval",     human_approval)
    graph.add_node("auto_remediate",     auto_remediate)
    graph.add_node("verify_remediation", verify_remediation)
    graph.add_node("generate_report",    generate_report)
    graph.add_node("save_to_memory",     save_to_memory)    

    graph.set_entry_point("ingest_alert")

    graph.add_edge("ingest_alert",   "recall_memory")        # ← NEW
    graph.add_edge("recall_memory",  "fetch_evidence")       # ← NEW
    graph.add_edge("fetch_evidence", "fetch_runbook")
    graph.add_edge("fetch_runbook",  "make_decision")
    graph.add_edge("make_decision",  "human_approval")
    graph.add_edge("human_approval", "auto_remediate")
    graph.add_edge("auto_remediate", "verify_remediation")
    graph.add_edge("verify_remediation", "generate_report")
    graph.add_edge("generate_report","save_to_memory")       # ← NEW
    graph.add_edge("save_to_memory",  END)                   # ← NEW

    memory = MemorySaver()
    return graph.compile(checkpointer=memory)


# ── ENTRYPOINT ────────────────────────────────────────────────
def run_incident(alert_payload: dict) -> IncidentState:
    app = build_graph()

    config = {"configurable": {"thread_id": f"incident-{datetime.now().timestamp()}"}}

    initial_state = IncidentState(
        alert=alert_payload,
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
        severity="P1",
        affected_services=[],
        team_paged="",
        slack_thread="",
        ticket_id="",
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

    return app.invoke(initial_state, config=config)


if __name__ == "__main__":
    from scripts.publish_alert import SAMPLE_ALERTS
    print("=" * 60)
    print("  INCIDENT RESPONSE AGENT — LangGraph + Ollama")
    print("=" * 60)
    result = run_incident(SAMPLE_ALERTS["P1"])
    print(f"\n[DONE] Done | Status: {result['status']} | Ticket: {result['ticket_id']}")
    print(f"   Confidence reached: {result['confidence']:.0%} in {result['retry_count']} attempt(s)")