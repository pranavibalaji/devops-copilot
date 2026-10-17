"""
FastAPI â€” Incident Response Agent API
======================================
Endpoints:
  POST /incidents                 -> trigger agent with alert payload
  GET  /incidents                 -> list all past & active incidents
  GET  /incidents/{id}            -> get specific incident details & timeline
  POST /incidents/{id}/approve    -> approve recommended remediation
  POST /incidents/{id}/reject     -> reject recommended remediation
  GET  /incidents/{id}/report     -> download generated incident report (markdown)
  GET  /runbooks                  -> list available runbooks
  GET  /runbooks/{name}           -> get specific runbook content
  GET  /memory                    -> query ChromaDB incident memory
  GET  /health                    -> detailed system health (FastAPI, Redis, Groq, ChromaDB, Listener)
  GET  /stats                     -> agent performance stats
  POST /incidents/test/{sev}      -> fire sample alert (P0, P1, P2)

All endpoints are also available under the `/api/...` prefix.
"""

import os
import json
import glob
from datetime import datetime
from typing import Optional, List

from fastapi import FastAPI, HTTPException, BackgroundTasks, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from agent.incident_runner import (
    execute_incident_stream,
    get_incident as runner_get_incident,
    list_incidents as runner_list_incidents,
    approve_incident_remediation,
    reject_incident_remediation,
    _get_redis_safe,
)
from agent.memory import recall_similar_incidents, _get_collection


# App setup
app = FastAPI(
    title="Incident Response Agent",
    description="Autonomous SRE agent â€” LangGraph + Groq + ChromaDB",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request / Response models
class AlertPayload(BaseModel):
    title: str
    service: str
    metric: str
    value: str
    threshold: str
    environment: str = "production"
    tags: list[str] = []
    affected_services: Optional[list[str]] = None
    severity: Optional[str] = "P1"
    runbook_hint: Optional[str] = None

    class Config:
        json_schema_extra = {
            "example": {
                "title": "High error rate on checkout-service",
                "service": "checkout-service",
                "metric": "error_rate",
                "value": "8.3%",
                "threshold": "1%",
                "environment": "production",
                "tags": ["team:payments", "region:us-east-1"],
                "affected_services": ["checkout-service", "payment-gateway"],
                "severity": "P1",
            }
        }


# Helper: background execution
def _run_agent_background(alert_dict: dict, incident_id: str):
    """Executes the streaming LangGraph workflow and saves state."""
    execute_incident_stream(alert_dict, incident_id)


# --- SYSTEM HEALTH ---

@app.get("/health", tags=["System"])
@app.get("/api/health", tags=["System"])
def health():
    """
    Comprehensive healthcheck inspecting real backend components:
    FastAPI, Redis, Groq, ChromaDB, and Agent Listener.
    """
    # 1. Redis
    redis_status = "disconnected"
    agent_status = "ready"
    try:
        r = _get_redis_safe()
        if r:
            redis_status = "connected"
            # Check if any listener is subscribed to 'alerts'
            numsub = r.pubsub_numsub("alerts")
            if numsub and numsub[0][1] > 0:
                agent_status = "running"
    except Exception:
        redis_status = "disconnected"

    # 2. ChromaDB Memory
    memory_status = "disconnected"
    memory_count = 0
    try:
        col = _get_collection()
        memory_count = col.count()
        memory_status = "connected"
    except Exception:
        memory_status = "disconnected"

    # 3. Groq
    groq_status = "disconnected"
    groq_key = os.getenv("GROQ_API_KEY", "")
    decision_provider = os.getenv("DECISION_PROVIDER", "groq")
    if decision_provider == "groq":
        if groq_key and len(groq_key) > 5:
            groq_status = "connected"
        else:
            groq_status = "missing_api_key"
    else:
        groq_status = f"configured_{decision_provider}"

    overall = "healthy" if (redis_status == "connected" and memory_status == "connected") else "degraded"

    return {
        "status": overall,
        "api": "operational",
        "redis": redis_status,
        "groq": groq_status,
        "memory": memory_status,
        "chromadb": memory_status,
        "agent": agent_status,
        "memory_incidents": memory_count,
        "decision_provider": decision_provider,
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


# --- INCIDENTS ---

@app.post("/incidents", tags=["Incidents"])
@app.post("/api/incidents", tags=["Incidents"])
def trigger_incident(
    alert: AlertPayload,
    background_tasks: BackgroundTasks,
):
    """
    Trigger the incident response agent with an alert payload.
    The agent executes the real LangGraph workflow in the background.
    """
    # Generate human-friendly ID like INC-C3F457
    import uuid
    short_suffix = uuid.uuid4().hex[:6].upper()
    incident_id = f"INC-{short_suffix}"

    alert_dict = alert.dict()
    alert_dict["incident_id"] = incident_id
    alert_dict["triggered_at"] = datetime.utcnow().isoformat() + "Z"
    if not alert_dict.get("affected_services"):
        alert_dict["affected_services"] = [alert_dict.get("service", "unknown")]

    # Run the agent in background â€” and ONLY here.
    #
    # This alert used to be executed locally *and* published to Redis, where
    # the listener picked it up and ran the very same incident_id a second
    # time. Two processes then wrote one record, so whichever finished last
    # overwrote the other: a listener run that never got approval would clobber
    # an already-resolved incident back to "mitigating".
    #
    # The API is guaranteed to be alive (it just served this request), so it
    # owns dashboard-triggered incidents. The listener keeps handling alerts
    # published from outside (scripts/publish_alert.py), which carry no
    # incident_id and therefore never collide.
    background_tasks.add_task(
        _run_agent_background,
        alert_dict,
        incident_id,
    )

    return {
        "incident_id": incident_id,
        "status": "triggered",
        "message": "Incident triggered. LangGraph workflow executing.",
        "poll_url": f"/incidents/{incident_id}",
        "triggered_at": alert_dict["triggered_at"],
    }


@app.get("/incidents/{incident_id}", tags=["Incidents"])
@app.get("/api/incidents/{incident_id}", tags=["Incidents"])
def get_incident_details(incident_id: str):
    """Get the full structured state and timeline of an incident."""
    inc = runner_get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")
    return inc


@app.get("/incidents", tags=["Incidents"])
@app.get("/api/incidents", tags=["Incidents"])
def list_all_incidents(limit: int = 50):
    """List all active and past incidents."""
    return runner_list_incidents(limit=limit)


@app.post("/incidents/{incident_id}/approve", tags=["Approval"])
@app.post("/api/incidents/{incident_id}/approve", tags=["Approval"])
def approve_incident(incident_id: str):
    """
    Operator approves the recommended remediation action.
    Unblocks the LangGraph workflow to execute remediation.
    """
    success = approve_incident_remediation(incident_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Pending approval for {incident_id} not found or already resolved")
    return {
        "incident_id": incident_id,
        "status": "approved",
        "message": "Remediation approved. Workflow proceeding to execution.",
    }


@app.post("/incidents/{incident_id}/reject", tags=["Approval"])
@app.post("/api/incidents/{incident_id}/reject", tags=["Approval"])
def reject_incident(incident_id: str):
    """
    Operator rejects the recommended remediation action.
    The workflow skips remediation and proceeds directly to reporting.
    """
    success = reject_incident_remediation(incident_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Pending approval for {incident_id} not found or already resolved")
    return {
        "incident_id": incident_id,
        "status": "rejected",
        "message": "Remediation rejected by operator. Workflow skipping remediation.",
    }


@app.get("/incidents/{incident_id}/report", tags=["Reports"])
@app.get("/api/incidents/{incident_id}/report", tags=["Reports"])
def download_incident_report(incident_id: str):
    """
    Download the generated markdown incident report.
    Returns Content-Type: text/markdown with attachment filename incident-{id}.md.
    """
    inc = runner_get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")

    report_text = inc.get("report") or inc.get("incident_report")
    if not report_text:
        # Fallback summary if report generation not reached
        report_text = f"# Incident Report â€” {incident_id}\n\nStatus: {inc.get('status')}\nTitle: {inc.get('title')}\n"

    return Response(
        content=report_text,
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="incident-{incident_id}.md"',
        },
    )


# --- DEMO PRESETS ---

@app.post("/incidents/test/{severity}", tags=["Demo"])
@app.post("/api/incidents/test/{severity}", tags=["Demo"])
def fire_test_alert(
    severity: str,
    background_tasks: BackgroundTasks,
):
    """Fire a sample alert for demo purposes (P0, P1, P2)."""
    samples = {
        "P0": AlertPayload(
            title="auth-service complete outage â€” all regions",
            service="auth-service",
            metric="availability",
            value="0%",
            threshold="99.9%",
            tags=["team:platform", "region:all"],
            affected_services=["auth-service", "api-gateway"],
            severity="P0",
        ),
        "P1": AlertPayload(
            title="High error rate on checkout-service",
            service="checkout-service",
            metric="error_rate",
            value="8.3%",
            threshold="1%",
            tags=["team:payments", "region:us-east-1"],
            affected_services=["checkout-service", "payment-gateway"],
            severity="P1",
        ),
        "P2": AlertPayload(
            title="Search latency elevated â€” eu-west-1",
            service="search-service",
            metric="p99_latency_ms",
            value="4200",
            threshold="500",
            tags=["team:search", "region:eu-west-1"],
            affected_services=["search-service"],
            severity="P2",
        ),
    }

    sev_upper = severity.upper()
    if sev_upper not in samples:
        raise HTTPException(status_code=400, detail="severity must be P0, P1, or P2")

    return trigger_incident(samples[sev_upper], background_tasks)


# --- RUNBOOKS ---

@app.get("/runbooks", tags=["Runbooks"])
@app.get("/api/runbooks", tags=["Runbooks"])
def list_runbooks():
    """List available runbooks from the repository."""
    runbook_files = glob.glob("runbooks/*.md")
    result = []
    for fp in runbook_files:
        fn = os.path.basename(fp)
        try:
            with open(fp, "r", encoding="utf-8") as f:
                content = f.read()
            # Extract first heading or name
            lines = content.strip().split("\n")
            title = fn.replace(".md", "").replace("_", " ").title()
            for line in lines:
                if line.startswith("# "):
                    title = line.replace("# ", "").strip()
                    break
            result.append({
                "filename": fn,
                "title": title,
                "path": fp,
                "size_bytes": os.path.getsize(fp),
                "summary": lines[2] if len(lines) > 2 else "",
            })
        except Exception as e:
            result.append({"filename": fn, "title": fn, "error": str(e)})
    return {"runbooks": result, "total": len(result)}


@app.get("/runbooks/{filename}", tags=["Runbooks"])
@app.get("/api/runbooks/{filename}", tags=["Runbooks"])
def get_runbook_content(filename: str):
    """Retrieve full content of a specific runbook."""
    safe_fn = os.path.basename(filename)
    if not safe_fn.endswith(".md"):
        safe_fn += ".md"
    fp = os.path.join("runbooks", safe_fn)
    if not os.path.exists(fp):
        raise HTTPException(status_code=404, detail=f"Runbook {safe_fn} not found")

    with open(fp, "r", encoding="utf-8") as f:
        content = f.read()

    return {
        "filename": safe_fn,
        "content": content,
    }


# --- MEMORY ---

@app.get("/memory", tags=["Memory"])
@app.get("/api/memory", tags=["Memory"])
def get_incident_memory(query: Optional[str] = Query(None)):
    """Query ChromaDB incident memory for past incidents."""
    try:
        col = _get_collection()
        count = col.count()
        if count == 0:
            return {"incidents": [], "total": 0}

        if query:
            # Semantic search
            similar = recall_similar_incidents(query, limit=10)
            return {"incidents": similar, "total": len(similar), "query": query}
        else:
            # All stored
            stored = col.get(include=["metadatas", "documents"])
            items = []
            for i, m in enumerate(stored.get("metadatas", [])):
                items.append({
                    "incident_id": m.get("incident_id"),
                    "title": m.get("title"),
                    "service": m.get("service"),
                    "severity": m.get("severity"),
                    "occurred_at": m.get("occurred_at"),
                    "root_cause": m.get("root_cause"),
                    "resolution": m.get("resolution"),
                    "confidence": float(m.get("confidence", 0.9)),
                    "document": stored.get("documents", [""])[i] if stored.get("documents") else "",
                })
            return {"incidents": items, "total": len(items)}
    except Exception as e:
        return {"incidents": [], "total": 0, "error": str(e)}


# --- STATS ---

@app.get("/stats", tags=["System"])
@app.get("/api/stats", tags=["System"])
def get_stats():
    """Agent performance statistics."""
    try:
        col = _get_collection()
        total = col.count()

        severities = {}
        avg_confidence = 0.0

        if total > 0:
            stored = col.get(include=["metadatas"])
            for m in stored["metadatas"]:
                sev = m.get("severity", "unknown")
                severities[sev] = severities.get(sev, 0) + 1
                try:
                    avg_confidence += float(m.get("confidence", 0))
                except Exception:
                    pass
            avg_confidence = round(avg_confidence / total, 3)

        list_res = runner_list_incidents(limit=10)

        return {
            "total_incidents_resolved": total,
            "by_severity": severities,
            "avg_confidence": avg_confidence,
            "active_incidents": list_res.get("total_active", 0),
            "agent_version": "2.0.0",
        }
    except Exception as e:
        return {"error": str(e)}


# Mount static frontend build if present
from fastapi.staticfiles import StaticFiles
frontend_dist_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
if os.path.exists(frontend_dist_path):
    app.mount("/", StaticFiles(directory=frontend_dist_path, html=True), name="frontend")