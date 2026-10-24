"""
Main entrypoint for the event-driven agent.

Run:
  python -m agent.listener

Then in another terminal:
  python scripts/publish_alert.py --sev P1

Watch the agent auto-trigger and process the alert end-to-end.
"""
import os
import sys
import time
from dotenv import load_dotenv

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

load_dotenv()

from agent.redis_queue import subscribe_and_run
from agent.incident_runner import execute_incident_stream


def handle_alert(alert: dict):
    """Called automatically when an alert arrives on the Redis channel."""
    print(f"\n{'='*60}")
    print(f"  AGENT TRIGGERED: {alert['title']}")
    print(f"{'='*60}")

    try:
        incident_id = alert.get("incident_id") or f"INC-{int(time.time())}"
        result = execute_incident_stream(alert, incident_id=incident_id)

        print(f"\n Incident handled.")
        print(f"   Severity  : {result.get('severity')}")
        print(f"   Service   : {result.get('service')}")
        print(f"   Ticket    : {result.get('incident_id')}")
        print(f"   Status    : {result.get('status')}")
        print(f"\n Report preview:")
        print(result.get("report", "")[:400] + "...")

    except Exception as e:
        print(f" Agent error: {e}")
        raise


if __name__ == "__main__":
    print("🤖 Incident Response Agent — listening for alerts")
    print("   Redis channel: alerts")
    print(f"   Model: {os.getenv('DECISION_PROVIDER', 'mock')} / Mock LLM: {os.getenv('USE_MOCK_LLM', '0')}")
    print("\n   Test with: python scripts/publish_alert.py --sev P1\n")

    subscribe_and_run(handle_alert)

    # Keep main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\nAgent stopped.")