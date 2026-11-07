# OmniSight Backend (Person 3)

FastAPI service that receives a simulated CI event (or a manual request), stores an
inspection job in SQLite, hands it to a browser runner, and exposes job status and
artifact references to the dashboard.

**Week 1 status:** the browser runner is a clearly labelled **MOCK**. No real browser
is launched and no AI analysis runs yet. Real integration is planned for Week 2.

## Folder layout

```text
backend/
├── main.py            # entry point: uvicorn main:app --reload
├── api.py             # routes + the background inspection task
├── job_schemas.py     # Pydantic contracts + the job state machine
├── job_store.py       # SQLite storage (jobs + artifact references)
├── browser_runner.py  # runner interface + MOCK runner
├── tests/test_api.py
├── requirements.txt
└── pytest.ini
```

## Setup (Windows PowerShell)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1     # if blocked: Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements.txt
uvicorn main:app --reload
```

Swagger UI: http://127.0.0.1:8000/docs

Tested with Python 3.12, FastAPI 0.143, Pydantic 2.14, pytest 9.1, httpx 0.28.

## How the pieces connect

```text
POST /webhooks/ci ─┐
                   ├─> job service (api.py) ──> SQLite: job "queued"
POST /jobs ────────┘          │
                              └─> background task:
                                    queued -> inspecting
                                    BrowserRunner.run()   <- MOCK today, Playwright runner in Week 2
                                    store artifact references
                                    inspecting -> analyzing   (or -> failed + error text)
GET /jobs/{id}, /jobs/{id}/artifacts  <- dashboard reads status and references
```

The runner is replaceable: Week 2 adds a runner that launches Person 1's
`npm run capture:evidence` and converts its manifest into artifact references.
Nothing else in the service changes.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/jobs` | Create an inspection job (`website_url`, alias `target_url`) |
| GET | `/jobs` | List jobs (`status`, `limit` 1-100, `offset`) |
| GET | `/jobs/{job_id}` | Status, inspection summary, artifact references |
| GET | `/jobs/{job_id}/artifacts` | Artifact references only |
| POST | `/webhooks/ci` | Simulated CI event (`build_success` only) |

Every route is also served under `/api/...` for the dashboard.

### Examples (PowerShell)

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health

Invoke-RestMethod -Uri http://127.0.0.1:8000/jobs -Method Post -ContentType "application/json" `
  -Body '{"website_url":"https://example.com"}' | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri http://127.0.0.1:8000/webhooks/ci -Method Post -ContentType "application/json" `
  -Body '{"event_type":"build_success","website_url":"http://localhost:5173","repository":"Veggies02/OmniSight","commit_sha":"5619e0c"}' | ConvertTo-Json -Depth 5

Invoke-RestMethod http://127.0.0.1:8000/jobs/<job_id> | ConvertTo-Json -Depth 5
```

Error cases: invalid body -> `422`; unsupported CI event type -> `400`; unknown job -> `404`.

## Job contract (proposed; pending team sign-off)

Job object: `job_id`, `website_url`, `status`, `source` (`manual` or `ci_webhook`),
`repository`, `commit_sha`, `created_at`, `updated_at`, `inspection`
(`mode`, `executed`, `message`), `error`, `artifacts[]`.

Artifact reference: `artifact_id`, `kind` (`screenshot`, `dom_snapshot`, `trace`,
`log`, `other`), `uri`, `description`, `mock`, `created_at`. Only references are stored,
never screenshot files.

Statuses and allowed next statuses:

| From | To |
|---|---|
| queued | inspecting, failed |
| inspecting | analyzing, failed |
| analyzing | repair_proposed, needs_review, completed, failed |
| repair_proposed | applying_patch, needs_review, failed |
| applying_patch | validating, failed |
| validating | pr_created, needs_review, failed |
| pr_created, needs_review, completed, failed | final |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OMNISIGHT_DB_PATH` | `backend/jobs.db` | SQLite file location |
| `OMNISIGHT_RUNNER` | `mock` | Browser runner (`mock` only in Week 1; bad values fail at startup) |
| `OMNISIGHT_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Allowed dashboard origins |

`jobs.db` is created on first start. An older 3-column `jobs.db` is upgraded in place.

## Tests

```powershell
pytest -v
```

Each test uses its own temporary database, so `jobs.db` is never touched.

## Demo checklist

- [ ] `uvicorn main:app --reload` starts without errors
- [ ] `/docs` opens and `GET /health` returns `{"status":"ok"}`
- [ ] `POST /webhooks/ci` returns 201 with `status: queued` and a MOCK `browser_result`
- [ ] `GET /jobs/{job_id}` shows `status: analyzing`, `inspection.executed: false`, one `mock://` artifact
- [ ] Invalid URL on `POST /jobs` returns 422; unsupported event type returns 400
- [ ] Stop the server, start it again, the same job is still retrievable
- [ ] `pytest -v` passes

## Known limitations (Week 1)

- The browser step is a mock; nothing is inspected and no AI analysis runs.
- Jobs end in `analyzing` until the AI module is connected (Week 2).
- No authentication, no webhook signature check, no timeouts or retries yet.
- `website_url` accepts any http(s) host; add an allowlist before a real browser visits it.
- SQLite with a simple connection per request; fine for the MVP only.

## Next (Week 2)

Real runner (Person 1), AI analysis through Person 2's `AnalysisResponse`, stored
findings, `GET /jobs/{id}/findings`, timeouts and error handling.