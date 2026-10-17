# Run Guide — Backend + Frontend

Project: `D:\New folder (2)\Incident-response-on-call-agent`
Date verified: 2026-10-02
System checked: Python 3.14.3 system / `.venv` + `.venv-laya311` present, Node v24.13.0, Docker 29.8.1 installed but daemon down.

## 1. Architecture (what you run)

```
Frontend (React+Vite :3000) -> FastAPI (:8000) -> Redis pub/sub `alerts` -> agent/listener.py -> LangGraph agent/graph.py -> ChromaDB + Decision Provider -> Approval -> Simulated remediation
```

* Backend API: `api/main.py` — also serves `frontend/dist` if built (see `api/main.py:459`).
* Worker: `agent/listener.py:57` subscribes to Redis, calls `agent/incident_runner.py:158` `execute_incident_stream`.
* Frontend API client: `frontend/src/lib/api.ts:3` uses relative `API_BASE=''`, proxied by `frontend/vite.config.ts:7` to `127.0.0.1:8000` in dev.
* Trigger UI: `frontend/src/components/TriggerModal.tsx:11` presets P1 checkout / P0 auth / P2 search.

## 2. Prerequisites

1. Start Docker Desktop (currently DOWN — verified `docker ps` fails with `npipe pipe not found`, Redis `localhost:6379` refused).
2. Python: use `.venv` (do NOT use system 3.14). Validated: `.venv` imports `fastapi, uvicorn, redis, langgraph, chromadb` OK.
3. Node 24 + npm 11 — validated `npx tsc --noEmit` passes with 0 errors.
4. `frontend/dist` exists — production serve via FastAPI works even without `npm run dev`.

## 3. Backend — run

```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent"

# 1. Redis (pick one, daemon must be up)
docker run --name incident-redis -p 6379:6379 -d redis:7-alpine
# or if exists:
docker start incident-redis
docker exec incident-redis redis-cli ping  # expect PONG

# 2. Python env (use existing .venv)
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env  # only first time, then edit

# 3. Init ChromaDB (once)
$env:HF_HUB_OFFLINE="1"; $env:HF_DATASETS_OFFLINE="1"; $env:TRANSFORMERS_OFFLINE="1"
python -m agent.rag
python -m agent.memory

# 4. Terminal 1 — API
uvicorn api.main:app --reload --port 8000
# open http://localhost:8000/docs
# check: Invoke-RestMethod http://localhost:8000/health
# check: Invoke-RestMethod http://localhost:8000/stats

# 5. Terminal 2 — Worker (must start BEFORE triggering)
python -m agent.listener
# expect: [queue] Subscribed to 'alerts' channel...

# 6. Terminal 3 — Trigger
python scripts/publish_alert.py --sev P1
# or: Invoke-RestMethod -Method Post -Uri http://localhost:8000/incidents/test/P1
```

Recommended demo `.env`:
```env
REDIS_URL=redis://localhost:6379
USE_MOCK_LLM=1
DECISION_PROVIDER=mock
APPROVAL_MODE=auto
LANGCHAIN_TRACING_V2=false
```
Use `mock+auto` for offline click-through. Use `groq` only with valid `GROQ_API_KEY`.

## 4. Frontend — run

Option A — Dev (recommended for UI work):
```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent\frontend"
npm install
npm run dev
# open http://localhost:3000
# Vite proxies /api, /incidents, /health, /runbooks, /memory, /stats -> 127.0.0.1:8000
```

Option B — Prod (no Vite needed, served by FastAPI):
```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent\frontend"
npm run build
# then with backend running, open http://localhost:8000/
```

UI flow: `Overview -> Simulate Production Incident -> select preset -> Trigger Incident -> IncidentDetails -> Approve/Reject -> Report tab`.

Polling: `App.tsx:45` health every 5s, incidents every 3s.

## 5. Combined run order (both)

1. Docker Redis UP
2. Backend API :8000 UP
3. Worker listener UP
4. Frontend :3000 UP (or use :8000 static)
5. Trigger from UI modal OR CLI OR `POST /incidents/test/P1`
6. Approve from UI (`POST /incidents/{id}/approve`) if `APPROVAL_MODE=manual`

## 6. Current condition — errors found

### Critical (blocks run now)
1. **Docker daemon down, Redis refused** — `redis.exceptions.ConnectionError 10061 localhost:6379`. Impact: `GET /health` returns `degraded`, listener never fires, CLI publish lost (pub/sub no retain). Fix: start Docker Desktop, `docker start incident-redis`.
2. **`.env` has live Groq key committed + `DECISION_PROVIDER=groq`** — `GROQ_API_KEY=gsk_kI1V...` exposed in repo, model `openai/gpt-oss-120b` mismatches docs `llama-3.3-70b-versatile`. Impact: quota leak, confusion which model works. Fix: rotate key, gitignore `.env`, set demo default to `mock`, document groq model actually tested.
3. **`APPROVAL_MODE=manual` in checked `.env`** — `agent/approval.py:68` non-tty waits 300s for Web UI event then returns `pending`. Impact: API-triggered incidents stall at `human_approval` unless frontend approves within window. For unattended demo use `auto`. Fix: set `auto` for demo, keep `manual` for real review.

### High (wrong behavior, not crash)
4. **`agent/incident_runner.py:236` wrong metric key** — `metrics[0].get('value',0)` should be `latest_value`. `get_service_metrics` returns `latest_value`, so `verification.before.error_rates` always `0.0%`. Fix: use `latest_value`.
5. **`api/main.py:190 + publish_alert` double execution** — `POST /incidents` runs `BackgroundTasks execute_incident_stream` AND `publish_alert` to Redis, so listener (if running) processes same alert twice. Noted also in `PRESENTATION_SCRIPT.md:377`. Fix: single path `FastAPI -> Redis -> Listener`.
6. **`infra/docker-compose.yml:27` missing env passthrough** — only passes `USE_MOCK_LLM, OLLAMA_MODEL, LANGCHAIN_*`, drops `DECISION_PROVIDER, GROQ_API_KEY, GROQ_MODEL, APPROVAL_MODE, REDIS_URL` override. Compose deploy defaults wrong. No `frontend` service. Fix: add missing envs + frontend build.
7. **`agent/graph.py:418` `__main__` demo path broken for API parity** — uses `SAMPLE_ALERTS` without `incident_id`, `ticket_id=""`, so `human_approval` registers `inc-<timestamp>` that API approve endpoint can't resolve. Only `execute_incident_stream` sets `ticket_id=incident_id` correctly. Fix: don't use `python -m agent.graph` for API tests; use runner.

### Found live during full startup run (2026-10-02)

13. **uvicorn accept loop dies on `WinError 64`** — after a client resets a connection during accept (`The specified network name is no longer available`), the ProactorEventLoop `accept_coro` task crashes (`Task exception was never retrieved ... OSError(22...)`) and uvicorn stops accepting new connections while old sockets stay ESTABLISHED.

    - **Confirmed trigger (reproduced 2026-10-02):** a *raw* `TcpClient.Connect()` to port 8000 that is closed immediately without sending HTTP causes the very next `accept()` to fail. A normal HTTP client (`curl.exe`) does **not** trigger it. So health probes must use HTTP, not TCP connect-and-close.
    - **Diagnostic gotcha:** while the accept loop is dead, `netstat -ano` / `Get-NetTCPConnection -LocalPort 8000` show **only `ESTABLISHED`, no `LISTENING`** — yet the existing keep-alive connection (e.g. the Vite proxy) keeps getting `200 OK` in the uvicorn log. The listening socket is still held by the process; it just cannot accept any more. Do not conclude "port free, restart it" from netstat alone.
    - **Symptom:** `curl` returns `HTTP=000` / PowerShell says "Unable to connect" while the uvicorn log is still full of 200s from the Vite proxy.
    - **Fix:** restart uvicorn. **Mitigation:** probe with HTTP only, avoid killing clients mid-handshake, run behind a supervisor / `--workers` guard.
14. **Vite dev server binds IPv6 only** — `Get-NetTCPConnection` shows `LocalAddress ::1` on 3000. `http://localhost:3000` works, `http://127.0.0.1:3000` fails. Fix: `server.host: '127.0.0.1'` in `frontend/vite.config.ts:7` (or always open `localhost`).
15. **`agent/approval.py:81` crashes instead of waiting** — **FIXED 2026-10-02.** `sys.stdin.isatty()` can return True even when stdin has no reader (detached/background shell), so `input()` raised `EOFError: EOF when reading a line` and the whole incident failed at `human_approval` instead of waiting for Web approval. Fix applied: `input()` is now wrapped in `try/except (EOFError, KeyboardInterrupt, OSError)` and falls back to a shared `_await_web_approval()` helper (300s wait for the dashboard Approve/Reject button), the same helper the non-tty branch uses.
16. **Groq returns 400 `json_validate_failed` intermittently** — `openai/gpt-oss-120b` emitted broken JSON (`"deployment_hypothesis_probability": 0. nine?`), no retry logic in `GroqDecisionProvider.evaluate_incident`, so the incident goes to `status=error`. Reproduced 1 of 3 runs; 10/10 unit tests passed because they mock Groq. Fix: 1-2 retries on 400/invalid JSON before failing (tests `test_no_silent_fallback_on_api_error` forbid silent Mock fallback, but a retry of the same provider is allowed).
17. **Duplicate execution confirmed live** — `POST /incidents/test/P1` ran the workflow in-process (BackgroundTask) AND the listener processed the same Redis message, so one incident ran the full graph twice (two Groq calls, two remediations). Matches `PRESENTATION_SCRIPT.md:377`.
18. **Dashboard header hardcodes wrong model** — UI shows `Decision: GROQ (llama-3.3-70b)` while `.env`/API actually run `openai/gpt-oss-120b` (`api/main.py` reports `decision_provider=groq`, model comes from `GROQ_MODEL`). Misleads the demo. Fix: read model from `/health` response.

### Medium (hygiene / docs drift)
8. **`requirements.txt:24` `gunicorn` on Windows + duplicates** — `gunicorn` doesn't run on Windows, `chromadb` listed twice, `python-dotenv` twice. Not fatal but `pip install` noisy. Fix: remove gunicorn or gate by platform, dedupe.
9. **`agent/listener.py:54` stale banner `Model: Ollama (mistral)`** — actual decision comes from `DECISION_PROVIDER`, not Ollama. Misleads demo. Fix: print provider + approval mode.
10. **Docs drift: `.env.example:5` says `groq` default vs `GETTING_STARTED.md:99` says `mock`** — pick one. Recommend `mock` default, `groq` opt-in.
11. **Frontend `lucide-react ^1.49.0` with `react 19.2.8`** — `tsc` passes today, but major version gap is fragile. Pin and test `npm run build` after any icon upgrade.
12. **Laya combined-run blocker (from `MIGRATION_HANDOFF.md`)** — isolated Laya predict OK (rollback 0.3249) and Chroma OK (35 chunks, db_connection_pool match 65%), but full graph stalls at `make_decision`. Plus 0.3249 < 0.92 threshold = report without remediation by design. Do not demo Laya as working e2e until one clean run captured via native `cmd`, not VSCode wrapper.

## 7. Quick verification checklist

```powershell
# backend imports
.\.venv\Scripts\python.exe -c "import api.main; print('api OK')"
.\.venv\Scripts\python.exe -c "from agent.graph import build_graph; build_graph(); print('graph OK')"
.\.venv\Scripts\python.exe -m unittest tests.test_decision_provider -v

# frontend
cd frontend; npx tsc --noEmit; npm run build

# runtime (needs Redis)
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:8000/incidents/test/P1 | ConvertTo-Json
```

Expected healthy: `redis:connected, memory:connected, agent:running` (when listener up).
Currently expected: `redis:disconnected, status:degraded` until Docker started.

Verified 2026-10-02: `import api.main OK`, `build_graph OK`, `unittest tests.test_decision_provider -v` 10/10 OK in ~73s. Full mock+GROQ graph works: `rollback 95% -> simulated v2.4.1->v2.4.0 -> healthy -> report -> Chroma write (29 total)`. Groq model `openai/gpt-oss-120b` with current `.env` key IS working — still rotate it since it is committed.

## 8. Recommended next fixes (smallest first)

1. Start Docker + rotate Groq key + set demo `.env` to `mock/auto`.
2. Fix `incident_runner.py:236` `value` -> `latest_value`.
3. Remove double-execution in `api/main.py:162` (keep Redis-only path).
4. Patch `docker-compose.yml` envs + add frontend.
5. Update `listener.py` banner, dedupe `requirements.txt`, align `.env.example` default.
6. Re-run full mock e2e, capture log, then retry Laya e2e in `cmd` with offline env vars.

## 9. Code changes applied (so far)

Only one source file has been modified:

| File | Change | Why |
|---|---|---|
| `agent/approval.py` | Extracted `_await_web_approval()`; wrapped `input()` in `try/except (EOFError, KeyboardInterrupt, OSError)` falling back to the Web-UI wait | `manual` mode crashed the incident with `EOFError` instead of waiting for the dashboard Approve button |

Untouched: `.env`, `graph.py`, `incident_runner.py`, `decision_provider.py`, frontend, docker files.

Approval modes after the fix:

| Mode | Behaviour |
|---|---|
| `manual` (default in `.env`) | Terminal prompt if stdin really is interactive; otherwise waits up to 300s for the dashboard Approve/Reject button; returns `pending` on timeout |
| `auto` | Approved immediately (demo only) |
| `deny` | Always denied |
