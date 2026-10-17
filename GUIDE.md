# Manual Start Guide (Windows PowerShell)

Use this for a clean manual run of backend + worker + frontend. No Docker image build required — Docker is used only for Redis.

## 0. What runs where

| Piece | Command | URL |
|---|---|---|
| Redis | Docker container `incident-redis` | `redis://localhost:6379` |
| Backend API | `uvicorn api.main:app --reload --port 8000` | http://localhost:8000/docs |
| Worker | `python -m agent.listener` | subscribes to `alerts` channel |
| Frontend dev | `npm run dev` in `frontend/` | http://localhost:3000 |
| Frontend prod | `frontend/dist` served by FastAPI | http://localhost:8000/ |

Order matters: Redis → API → Worker → Frontend → Trigger.

## 1. Prerequisites

- Windows 10/11, Python via `.venv` in repo (do not use system Python 3.14 for backend)
- Node 24 + npm 11 (verified)
- Docker Desktop installed

## 2. Docker + Redis setup

Docker Desktop must be running first. If `docker ps` fails with `npipe ... not found`, the daemon is down.

```powershell
# 1. Start Docker Desktop (GUI) and wait for green status.
# NOTE: on this machine Docker Desktop is installed per-user:
Start-Process "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
# (default path only if installed system-wide:)
# Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"

# 2. Confirm daemon is up (retry until it responds; 10-60s typical)
docker version
docker ps

# 3. First time only — create Redis
docker run --name incident-redis -p 6379:6379 -d redis:7-alpine

# 4. Every next boot — start existing container
docker start incident-redis

# 5. Verify
docker exec incident-redis redis-cli ping
# expect: PONG

# 6. Inspect / logs if needed
docker ps --filter "name=incident-redis"
docker logs incident-redis --tail 20

# 7. Stop when done
docker stop incident-redis
```

Notes:
- `infra/docker-compose.yml` also defines Redis as `incident_redis`, but manual `docker run` above uses `incident-redis`. Pick one name and stick to it.
- Do NOT proceed until `PONG` works. Without Redis, `/health` = `degraded` and CLI alerts are lost (pub/sub has no retention).

## 3. Backend setup (once)

```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent"
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt

# first time only
Copy-Item .env.example .env
```

Edit `.env` for local demo (recommended):
```env
REDIS_URL=redis://localhost:6379
USE_MOCK_LLM=1
DECISION_PROVIDER=mock
APPROVAL_MODE=auto
LANGCHAIN_TRACING_V2=false
```

For Groq reasoning instead:
```env
DECISION_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=openai/gpt-oss-120b
APPROVAL_MODE=auto
```

Then init local vector DB (once, needs internet first time for `all-MiniLM-L6-v2`):
```powershell
.\.venv\Scripts\Activate.ps1
python -m agent.rag
python -m agent.memory
```

## 4. Manual start (3 terminals + optional frontend)

Keep `.venv` activated in each backend terminal.

Terminal 1 — API:
```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent"
.\.venv\Scripts\Activate.ps1
uvicorn api.main:app --reload --port 8000
```
Open http://localhost:8000/docs

Terminal 2 — Worker (start BEFORE triggering):
```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent"
.\.venv\Scripts\Activate.ps1
python -m agent.listener
```
Wait for: `[queue] Subscribed to 'alerts' channel...`

Terminal 3 — Trigger (pick one):
```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent"
.\.venv\Scripts\Activate.ps1
python scripts/publish_alert.py --sev P1
# P0 / P2 also supported
```
Or via API:
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8000/incidents/test/P1
```

Terminal 4 — Frontend dev (optional if using http://localhost:8000/ static build):
```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent\frontend"
npm install
npm run dev
```
Open http://localhost:3000 — Vite proxies `/incidents /health /runbooks /memory /stats /api` to `127.0.0.1:8000`.

Prod frontend without Vite:
```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent\frontend"
npm run build
# then open http://localhost:8000/
```

## 5. Verify it worked

```powershell
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json
Invoke-RestMethod http://localhost:8000/stats | ConvertTo-Json
Invoke-RestMethod http://localhost:8000/incidents | ConvertTo-Json -Depth 6
```

Healthy signs:
- `redis: connected`, `memory: connected`, `agent: running` (when listener up)
- Worker prints: `ingest -> recall_memory -> fetch_evidence -> fetch_runbook -> make_decision -> human_approval -> auto_remediate -> verify -> report -> save_to_memory`
- UI shows incident in Overview / Incident Records, Approve button flips `awaiting_approval -> mitigating -> resolved`

## 6. Stop

- `Ctrl+C` in API, worker, frontend terminals
- `docker stop incident-redis`
- Next boot: `docker start incident-redis` then repeat section 4 (no reinstall needed).

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `docker ps` npipe error | Start Docker Desktop, wait green, retry `docker version` |
| Redis `ConnectionError 10061` | `docker start incident-redis`, check `.env REDIS_URL=redis://localhost:6379`, restart worker/API |
| Alert published but worker silent | Worker was started AFTER publish (pub/sub not retained). Start worker first, republish |
| `LangSmith authentication failed` | Set `LANGCHAIN_TRACING_V2=false`, restart |
| Stuck at approval 300s then `pending` | `APPROVAL_MODE=manual` in non-tty. Use `auto` for demo or click Approve in UI within 300s |
| `datetime.utcnow()` warnings | Non-blocking, ignore |
| First `agent.rag` downloads | Expected once, then cached |
| Full Laya graph stalls at decision | Use `mock` for demo. Laya isolated OK but combined Laya+Chroma not reliable on Windows yet |
| API stops answering, process alive | uvicorn `WinError 64` accept loop crash — restart `uvicorn api.main:app --port 8000` |
| `http://127.0.0.1:3000` fails | Vite binds `::1` only — use `http://localhost:3000` |
| `EOFError: EOF when reading a line` at approval | Headless run + `APPROVAL_MODE=manual` — use `auto` (env override) or run listener in a real terminal |
| Groq 400 `json_validate_failed` | Flaky model JSON — re-run the incident; provider has no retry yet |
| Incident appears to run twice | Known: API runs it in-process AND publishes to Redis (duplicate path) |

### Headless start (what this session used)

`APPROVAL_MODE` is read from process env and wins over `.env`, so a one-off demo can be started without editing `.env`:

```powershell
# Terminal A — API
$env:APPROVAL_MODE="auto"; .\.venv\Scripts\python.exe -m uvicorn api.main:app --port 8000

# Terminal B — Worker
$env:APPROVAL_MODE="auto"; .\.venv\Scripts\python.exe -m agent.listener
```
