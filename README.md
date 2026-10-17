# Incident Response On-Call Agent

An event-driven incident response system that listens for alerts, searches historical incidents and runbooks, evaluates likely root causes, and coordinates a human-approved remediation path. The project combines a Python LangGraph workflow, a FastAPI backend, a Redis event bus, and a small React dashboard for incident tracking.

## What the project does

The app is designed for the first phase of incident handling, where the agent:

- ingests an alert from Redis or an HTTP request
- classifies the severity and affected services
- recalls similar incidents from ChromaDB memory
- gathers logs, metrics, service health, and deployment metadata
- retrieves the most relevant runbook via semantic search
- asks a configured decision provider for a recommended action
- waits for human approval before performing a remediation
- stores the resulting incident state and report for future recall

This is not a full production SRE platform; it is a practical local prototype for evaluating agent-driven incident triage and response.

## Architecture

```text
Alert source / REST API / CLI
        |
        v
Redis pub/sub channel: alerts
        |
        v
agent.listener
        |
        v
LangGraph workflow in agent.graph
        |-- recall_memory -> ChromaDB historical incidents
        |-- fetch_evidence -> simulated logs/metrics/service data
        |-- fetch_runbook -> ChromaDB runbook RAG
        |-- make_decision -> Groq, mock, or Laya provider
        |-- human approval -> approval workflow
        |-- auto_remediate -> simulated remediation
        |-- generate_report -> stored incident state
        |
        v
FastAPI API + incident state cache + Redis persistence
        |
        v
React frontend dashboard
```

The system is intentionally modular: the decision provider, remediation behavior, queue, and storage are isolated behind simple interfaces.

## Core technologies

- Python 3.11+
- LangGraph for orchestration
- FastAPI for the API layer
- Redis for event-driven alert delivery
- ChromaDB + sentence-transformers for memory and runbook retrieval
- Groq cloud LLM support, plus a deterministic mock provider for local demos
- React + Vite for the frontend dashboard
- Docker for Redis and optional containerized deployment

## Decision providers

The app supports multiple provider modes through the environment variable `DECISION_PROVIDER`:

- `mock`: deterministic local demo logic for offline testing
- `groq`: structured decision-making with a Groq API key
- `laya`: optional typed-decision model via the Laya package

The default environment file includes `mock` and `groq` examples, while the rest of the graph depends on a consistent decision interface rather than a single model.

## Runbook and memory workflow

The repository includes markdown runbooks under `runbooks/` and a memory store in ChromaDB. The workflow behaves like this:

1. A service alert arrives.
2. The agent searches historical incidents for similar failures.
3. It collects evidence and retrieves the most relevant runbook.
4. It asks the decision provider whether the issue is likely a deployment regression, infra fault, or another cause.
5. It recommends an action and waits for approval before changing the system state.

## Project structure

```text
Incident-response-on-call-agent/
├── agent/
│   ├── approval.py              # human approval flow
│   ├── decision_provider.py     # mock / groq / laya provider abstraction
│   ├── embeddings.py            # embedding helpers
│   ├── graph.py                 # LangGraph workflow and stages
│   ├── incident_runner.py       # execution + state tracking + Redis sync
│   ├── listener.py              # Redis subscription entrypoint
│   ├── llm.py                   # LLM integration
│   ├── memory.py                # ChromaDB incident memory logic
│   ├── metrics.py               # metrics/query helpers
│   ├── rag.py                   # runbook ingestion and retrieval
│   ├── reasoner.py              # confidence and retry logic
│   ├── redis_queue.py           # Redis pub/sub helpers
│   ├── remediation.py           # remediation planning and execution
│   ├── simulated_env.py         # simulated infra evidence
│   ├── state.py                 # typed workflow state
│   └── tools.py                 # external integrations and helper calls
├── api/
│   └── main.py                  # FastAPI API and endpoints
├── frontend/
│   ├── package.json             # React/Vite app setup
│   ├── src/
│   └── public/
├── infra/
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── redis.conf
├── runbooks/
│   ├── db_connection_pool.md
│   ├── elasticsearch_rebalancing.md
│   ├── high_error_rate.md
│   ├── memory_leak.md
│   └── redis_connection_failure.md
├── scripts/
│   └── publish_alert.py         # publish sample alerts to Redis
├── tests/
│   └── test_decision_provider.py
├── .env.example
├── .gitignore
├── GETTING_STARTED.md
├── Procfile
├── README.md
├── requirements.txt
├── requirements-laya.txt
├── architecture.png
└── JULES_REPORT.md
```

## Quick start (A to Z)

This walks you through everything, in order, from a fresh download to a working dashboard.

**By the end you will have 3 programs running at the same time in 3 separate windows:**

| Window | Runs | Job |
| --- | --- | --- |
| 1 | API server | Answers the dashboard, stores incidents |
| 2 | Listener | Watches for alerts and runs the AI agent |
| 3 | Dashboard | The web page you look at |

**Total setup time:** about 15–20 minutes the first time (most of it is downloading). About 1 minute every time after that.

---

### What you need first

Install these four things if you don't have them. You only ever do this once per machine.

| # | Thing | Why | Get it from |
| --- | --- | --- | --- |
| 1 | **Python 3.11 or newer** | Runs the agent | [python.org/downloads](https://www.python.org/downloads/) |
| 2 | **Node.js 20 or newer** | Runs the dashboard | [nodejs.org](https://nodejs.org) |
| 3 | **Docker Desktop** | Runs Redis (the message system) | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) |
| 4 | **A Groq API key** | The AI brain | [console.groq.com/keys](https://console.groq.com/keys) — free, takes 2 minutes |

**How to check you have them** — open a terminal and type each one:

```powershell
python --version     # expect: Python 3.11.x or newer
node --version       # expect: v20.x or newer
docker --version     # expect: Docker version 24.x or newer
```

If any of those say "not recognised", install it first and reopen the terminal.

> **No Groq key?** Skip it. Go to [Step B](#step-b-tell-the-app-your-secret-key) and use the offline demo setting instead. Everything else works identically.

---

### Step A: Get the code and open a terminal in it

Download or clone the repository, then open your terminal **inside the project folder**. This matters: every command below assumes you are standing in this folder.

```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent"
```

*(If your project lives somewhere else, use your own path. On macOS/Linux use `cd "/path/to/Incident-response-on-call-agent"` and `ls` instead of `dir`.)*

Check you are in the right place:

```powershell
dir
```

You should see `agent`, `api`, `frontend`, `requirements.txt`, and `.env.example` listed.

---

### Step B: Tell the app your secret key

The app needs one secret value: your Groq API key. It goes in a file called `.env`, which Git will never upload.

**1. Make your own `.env` file from the template:**

```powershell
Copy-Item .env.example .env
```

*(macOS/Linux: `cp .env.example .env`)*

**2. Open `.env` in any text editor** (Notepad is fine). Find this line:

```
GROQ_API_KEY=
```

**3. Paste your key after the `=` sign**, so it looks like:

```
GROQ_API_KEY=gsk_paste_your_real_key_here
```

**4. Save and close the file.** That's it.

> 🔒 **This is the only secret in the project.** The `.env` file is listed in `.gitignore`, so Git will not upload it. Never copy your key into any other file, and never paste it into a chat or screenshot.

> **Using the offline demo instead?** Leave `GROQ_API_KEY` empty and change one line to read `DECISION_PROVIDER=mock`. No key, no internet needed.

Every other setting in `.env` already has a working default. The comments in the file explain what each one does — you can safely ignore them all for now.

---

### Step C: Install the Python parts

Still in the project folder, run these two commands one after the other. The first creates an isolated Python environment (so this project doesn't clash with anything else on your machine). The second fills it with the required packages.

```powershell
python -m venv .venv
```

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

*(macOS/Linux: use `python3` and the path `.venv/bin/python` instead.)*

This downloads a lot — **expect 5–10 minutes** and several gigabytes of disk. That is normal; it includes the AI model.

**How to tell it worked:** the last line should say `Successfully installed ...` with no red error text.

> 💡 You do **not** need to "activate" the virtual environment. Every command below points straight at `.venv\Scripts\python.exe`, which does the same job and avoids a whole category of confusion.

---

### Step D: Start Redis

Redis is the message box that alerts travel through. Start it with Docker:

```powershell
docker run --name incident-redis -p 6379:6379 -d redis:7-alpine
```

**Check it answered:**

```powershell
docker exec incident-redis redis-cli ping
```

Expected — one word, in capitals:

```text
PONG
```

> 💡 **On later restarts** (Docker already has the container), this command will complain the name is taken. That's fine — just start the existing one:
> ```powershell
> docker start incident-redis
> ```

---

### Step E: Build the search index (once only)

The agent searches past incidents and runbooks. These two commands build those search indexes. **You only need to do this once**, ever.

```powershell
.\.venv\Scripts\python.exe -m agent.rag
```

```powershell
.\.venv\Scripts\python.exe -m agent.memory
```

Each takes 1–3 minutes the first time (it downloads a small language model). You will see progress bars. Let them finish.

**How to tell it worked:** both finish without a red `Traceback`, and two folders appear: `.chromadb` and `.chromadb_memory`.

> Skip this and the app will still start, but the agent will have nothing to search and will answer less intelligently.

---

### Step F: Start the API server (Window 1)

Open a **new** terminal window (don't close the one you've been using — you'll want it for the next step). Go to the project folder:

```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent"
```

Then start the API:

```powershell
$env:PYTHONPATH = (Get-Location).Path
.\.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000
```

**Leave this window open.** It will print something like:

```text
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

That last line means **Window 1 is done**. It will not print much after this — that is normal, it is quietly waiting for work.

---

### Step G: Start the listener (Window 2)

Open a **second** terminal window. Same folder again:

```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent"
```

Then:

```powershell
$env:PYTHONPATH = (Get-Location).Path
.\.venv\Scripts\python.exe -m agent.listener
```

**Leave this window open too.** You should see:

```text
🤖 Incident Response Agent — listening for alerts
   Redis channel: alerts
   Model: Ollama (mistral)

[queue] Subscribed to 'alerts' channel. Waiting for alerts...
```

The `[queue] Subscribed` line is the important one — it means **Window 2 is connected and waiting**.

---

### Step H: Start the dashboard (Window 3)

Open a **third** terminal window:

```powershell
cd "D:\New folder (2)\Incident-response-on-call-agent\frontend"
```

First time only — install the web packages (about 1–2 minutes):

```powershell
npm install
```

Then every time, start the dashboard:

```powershell
npm run dev
```

You will see:

```text
  VITE  v5.x  ready in 500 ms
  ➜  Local:   http://localhost:3000/
```

**Open http://localhost:3000 in your browser.** That's your dashboard.

---

### Step I: Wait. This part looks broken but is not.

**The very first time you load the dashboard or ask it for data, it will be slow — sometimes 1–3 minutes of nothing happening.**

This is the AI model warming up. It happens exactly once, the first time. **Do not:**

- ❌ refresh the page repeatedly
- ❌ press Ctrl+C
- ❌ assume it crashed and restart things

**Just leave it alone and wait.** You'll know it's done when data appears. Every request after that is fast (under a second).

If you're impatient, you can warm it up in a fourth terminal and just watch:

```powershell
curl.exe -s --max-time 300 "http://127.0.0.1:8000/health"
```

Use the long `--max-time 300`. A short timeout here is the single most common way people break their own server — see [Troubleshooting](#if-something-goes-wrong).

---

### Step J: Test it

You now have all three windows running. Time to trigger an incident.

**Easiest way — use the dashboard.** Open http://localhost:3000, find the "Fire test alert" or "Trigger incident" button, and click it.

**Or trigger one from the command line** (any terminal):

```powershell
curl.exe -s -X POST "http://127.0.0.1:8000/incidents/test/P1"
```

**Then watch Window 2.** You'll see the agent work through its stages — collecting evidence, searching memory, finding a runbook, and recommending an action.

**Then go back to the dashboard.** The new incident appears, with a recommended fix waiting for you. Approve it or reject it with the buttons, and watch it finish.

That's the whole loop. 🎯

---

### Step K: Stop everything

When you're done, close each of the three windows (or press `Ctrl+C` in each). Then optionally stop Redis:

```powershell
docker stop incident-redis
```

**Next time you want to run it**, you only need to repeat:

- **Step D** — `docker start incident-redis` *(if you stopped it)*
- **Step F** — start the API
- **Step G** — start the listener
- **Step H** — `npm run dev` in the `frontend` folder

Steps A, B, C and E are one-time-only setup.

---

### Things that will confuse you at first

**"The dashboard loads but shows no data for ages."**
That's the warm-up from [Step I](#step-i-wait-this-part-looks-broken-but-is-not). Wait it out once and it never happens again.

**"One of my windows died by itself."**
Check the others are still running. All three must be up. Look for a red `Traceback` in the window that died — that tells you why.

**"Port 8000 is already in use."**
Something else is using that port. Either close it, or run the API on a different port (say `--port 8010`) — but then the dashboard won't find it, so the cleanest fix is to free port 8000.

**"Docker says the container name is already taken."**
Good news — you already created it. Use `docker start incident-redis` instead of `docker run`.

**"It worked yesterday, now everything is slow."**
Check your free memory. This app wants roughly **3 GB of free RAM** while running. Close other applications if it's struggling.

**"I want a totally clean slate."**
Stop everything, then delete these two folders to wipe the agent's memory and start fresh: `.chromadb` and `.chromadb_memory`. Redo [Step E](#step-e-build-the-search-index-once-only).

---

### If something goes wrong

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `ConnectionRefusedError` on port 8000 | The API isn't running | Do [Step F](#step-f-start-the-api-server-window-1) again |
| `redis: disconnected` in `/health` | Redis container stopped | `docker start incident-redis` |
| Listener shows nothing after an alert | Listener isn't subscribed | Restart it — [Step G](#step-g-start-the-listener-window-2) |
| Dashboard is a blank page | Frontend isn't running | `npm run dev` in `frontend/` |
| `pip` isn't recognised | Wrong Python or venv | Use the full path: `.\.venv\Scripts\python.exe -m pip ...` |
| `ModuleNotFoundError: agent` | Wrong working directory, or `PYTHONPATH` missing | `cd` to the project root and set `$env:PYTHONPATH` as shown in Step F |
| Very slow, unresponsive machine | Not enough free RAM | Close other apps; aim for 3 GB free |
| `GroqError` / 401 | Bad or missing API key | Recheck [Step B](#step-b-tell-the-app-your-secret-key) |

**The API has a built-in self-test.** With the API running, open **http://127.0.0.1:8000/health** — it tells you exactly which piece is unhappy:

```json
{"status":"healthy","redis":"connected","groq":"connected","memory":"connected", ...}
```

If `status` says `"degraded"`, look at which field says `"disconnected"` — that's your broken piece.

---

### A warning about running the API on Windows

The API runs on a single "thread" that also keeps the front door open. On the **first** request it does a big chunk of heavy work, and for a long time this froze the whole server on Windows.

That is fixed in the current code — the heavy work now happens off to one side, and the front door stays open. If you ever see an error in the API window saying:

```text
OSError: [WinError 64] The specified network name is no longer available
Accept failed on a socket
```

...it means something interrupted that first request. **Don't use a short timeout when testing the server for the first time** — always give it the full 300 seconds, as shown in [Step I](#step-i-wait-this-part-looks-broken-but-is-not). If it happens anyway, just stop and restart the API ([Step F](#step-f-start-the-api-server-window-1)) and be patient on the first request.

## API overview

The backend exposes the following major endpoints:

- `GET /health` — health check for Redis, memory, Groq, and agent status
- `GET /stats` — system statistics
- `POST /incidents` — create an incident from an alert payload
- `GET /incidents` — list incidents
- `GET /incidents/{id}` — fetch incident details and timeline
- `POST /incidents/{id}/approve` — approve the recommended action
- `POST /incidents/{id}/reject` — reject the recommendation
- `GET /incidents/{id}/report` — fetch the generated incident report
- `GET /runbooks` and `GET /runbooks/{name}` — list and inspect runbooks
- `GET /memory` — query history in the memory store

The app also supports `/api/...` aliases for the same API surfaces.

## Frontend

The frontend lives in `frontend/` and uses React + Vite. It provides a lightweight dashboard for incident overview, details, runbooks, and memory views.

Full instructions are in [Step H](#step-h-start-the-dashboard-window-3) above. In short, from the `frontend/` folder:

```powershell
npm install      # first time only
npm run dev
```

The dashboard is served on **http://localhost:3000** and forwards all API calls to the backend on port 8000 automatically — you don't need to configure any URLs.

## Configuration

All settings live in one file: `.env` in the project root.

- **`.env.example`** is a commented template listing every setting, what it does, and which ones are required.
- Copy it to `.env` and fill in `GROQ_API_KEY` — that is the only value you must set.
- `.env` is excluded from Git by `.gitignore`. Never commit it, and never paste your key anywhere else.

| Setting | Required? | What it does |
| --- | --- | --- |
| `GROQ_API_KEY` | **Yes** (unless using `mock`) | Your Groq secret key |
| `DECISION_PROVIDER` | No — defaults to `mock` | `groq`, `mock`, or `laya` |
| `GROQ_MODEL` | No | Which Groq model to call |
| `REDIS_URL` | No — defaults to `localhost:6379` | Where the message bus lives |
| `APPROVAL_MODE` | No — defaults to `manual` | `manual` (asks a human), `auto`, or `deny` |

See `.env.example` for the full list, including optional PagerDuty, Slack, Jira, and tracing settings.

## Notes and current status

- The project is designed around local-first investigation and a controlled approval loop.
- `APPROVAL_MODE=manual` is the default safe mode; the agent will not blindly execute a remediation without operator approval.
- Some integrations such as PagerDuty, Slack, Jira, and real observability backends are represented as optional or simulated layers rather than fully connected production integrations.
- For a more hands-on Windows setup guide, see [GETTING_STARTED.md](GETTING_STARTED.md).

## Recommended next steps

- add real log/metrics adapters for your environment
- connect PagerDuty, Slack, and Jira webhooks
- replace the simulated remediation logic with actual infrastructure actions
- wire the frontend to the live incident state and SSE/refresh workflow
- expand the runbook library and historical memory coverage

This repo is best treated as a prototype for building a practical, reviewable AI incident-response assistant with transparent decision-making and a human approval gate.

---

## Known limitations

- All integrations are mocked by default - real Datadog, PagerDuty, 
  and Slack need API keys wired into `.env`
- Confidence threshold (0.92) is tuned for MockLLM - needs calibration 
  when running real Ollama against production logs
- Incident memory is local ChromaDB not shared across multiple agent instances yet
- kubectl remediation calls need a real cluster pointed at `~/.kube/config`

## What's next

- [ ] Wire real Datadog log queries
- [ ] Add Slack slash command to manually trigger investigation
- [ ] Calibrate confidence scoring against real Ollama responses
- [ ] Kubernetes integration tests against a local kind cluster
- [ ] Multi-agent parallelism - separate agents per service

