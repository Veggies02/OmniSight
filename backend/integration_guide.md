# OmniSight backend: integration guide

For teammates connecting the dashboard (Ajay, Sahil) and the AI engine (Yuvaraj).
The code is in this folder; every schema is in `job_schemas.py`.

## Run it

From `backend/`, with the virtualenv active:

```powershell
$env:OMNISIGHT_RUNNER = "playwright"          # default is "mock" (no browser, labelled mock)
$env:OMNISIGHT_OPERATOR_TOKEN = "choose-one"  # needed for the repair endpoints (see below)
uvicorn main:app --reload                     # http://127.0.0.1:8000, Swagger at /docs
```

Every route also works under `/api/...`.

| Environment variable | Default | Meaning |
|---|---|---|
| `OMNISIGHT_RUNNER` | `mock` | `mock` or `playwright` (real capture) |
| `OMNISIGHT_REPO_ROOT` | parent of `backend/` | Repo the capture and repair CLIs run in |
| `OMNISIGHT_CAPTURE_BASE_URL` | `http://127.0.0.1:5173` | The only site the capture runner accepts today |
| `OMNISIGHT_CAPTURE_TIMEOUT_SECONDS` | `300` | Kills a hung capture |
| `OMNISIGHT_REPAIR_TIMEOUT_SECONDS` | `900` | Kills a hung repair |
| `OMNISIGHT_OPERATOR_TOKEN` | unset | Enables the repair endpoints. Unset means they return 503 |
| `OMNISIGHT_DB_PATH` | `backend/jobs.db` | SQLite file (not tracked by git) |
| `OMNISIGHT_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Allowed dashboard origins |

## Endpoints

| Method and path | Purpose | Success | Errors |
|---|---|---|---|
| `GET /health` | Liveness | 200 | |
| `POST /jobs` | Body `{"website_url": "http://..."}`. Creates a job and starts inspection in the background | 201 | 422 bad input |
| `POST /webhooks/ci` | Body `{"event_type": "build_success", "website_url", "repository": "owner/name", "commit_sha": "7-40 hex"}` | 201 | 400 unsupported event, 422 |
| `GET /jobs` | Query `status`, `limit` (1-100), `offset`. Returns `{items, total, limit, offset}` | 200 | |
| `GET /jobs/{job_id}` | One job | 200 | 404 |
| `GET /jobs/{job_id}/artifacts` | Artifact references of the job | 200 | 404 |
| `POST /jobs/{job_id}/proposal` | Body `{"proposal": {...}}`. Attaches a repair proposal. Needs `proposalId`. Any review or approval fields inside it are discarded and it is stored as `pending_review` | 200 | 401, 404, 409 (job not in `analyzing`), 422, 503 |
| `POST /jobs/{job_id}/approval` | Body `{"reviewed_by": "name"}`. Records the approval with a server-side timestamp. Once per proposal. Does not start the repair | 200 | 401, 404, 409, 422, 503 |
| `POST /jobs/{job_id}/repair` | Starts the approved repair in the background | 202 | 401, 404, 409 (no proposal, not approved, already started, or another repair running), 503 |

The three repair-flow endpoints need the header `X-Operator-Token` equal to `OMNISIGHT_OPERATOR_TOKEN`.
This is a demo gate, not user authentication. Do not put the token in browser code or a `VITE_` variable;
add it from a server-side proxy. `reviewed_by` is whatever the caller sends.

## Job response

```
job_id, website_url, status, stage, source ("manual" | "ci_webhook"), repository, commit_sha,
created_at, updated_at,
inspection { mode, executed, message, run_id, exit_code, duration_seconds,
             scenarios_captured, total_scenarios, stdout_tail, stderr_tail },
proposal      (the stored proposal, or null),
approval      { reviewed_by, reviewed_at } or null,
repair        { outcome, passed, job_id, message, exit_code, final_state, failure_reason, approved,
                build_passed, test_passed, visual_passed, patch_id, proposal_id, cleanup,
                proposal_path, report_path, duration_seconds, stdout_tail, stderr_tail } or null,
error         (reason when status is failed),
artifacts [ { artifact_id, kind, uri, description, mock, created_at } ]
```

`repair.outcome` is `passed`, `failed`, `rejected` (the CLI refused the approval) or `error`
(no usable report, timeout, or a CLI crash). Artifact `uri` values are paths relative to the repo root.
There is no endpoint that serves the files themselves.

## Statuses and stages

Status moves only along these edges, everything else is rejected:

```
queued -> inspecting -> analyzing -> repair_proposed -> applying_patch -> completed
                                                                      \-> failed
(any non-terminal status -> failed;  analyzing -> completed | needs_review also allowed;
 applying_patch -> validating -> pr_created | needs_review is reserved and not used yet)
```

`completed`, `failed`, `needs_review` and `pr_created` are final.

`stage` is a finer label: `queued`, `inspecting`, `analyzing`, `awaiting_approval` (status `repair_proposed`),
`repairing` (status `applying_patch`), `verifying` (status `validating`). After `completed` or `failed`
the stage keeps its last value. `generating_proposals` and `testing` were agreed with Ajay but the backend
does not emit them yet. The agreed rename of status to `queued/running/completed/failed` has not been done.

## Flow

1. `POST /jobs` or `/webhooks/ci`: capture runs (`npm run capture:evidence`) and writes
   `artifacts/visual-evidence/<run_id>/`. The job stops at `analyzing`.
2. Diagnosis and proposals are not run by the backend yet. Run `npm run diagnose:evidence` and
   `npm run repair:proposals`, then post one proposal to `/jobs/{id}/proposal`.
3. A human approves it with `/approval`.
4. `/repair` writes `artifacts/repair-jobs/<job_id>/proposal.json` with the approval from the stored
   record only, runs `npm run repair:execute -- --proposal=... --job-id=...`, and stores the result.
   The CLI reports to `artifacts/repair-executions/<job_id>/repair_execution_report.json`.
   Its exit code is 0 only for `PASSED`, so the backend also reads the JSON summary and the report.

## Evidence files and the AI engine

Per scenario, the run folder holds baseline and defective screenshots, DOM snapshots and measurements.
`model_facing_evidence.json` is the evidence prepared for a model.
**`ground_truth_eval.json` is the answer key: evaluation only, never send it to a model.**
Diagnosis results from the mock provider must stay labelled as mock.

## Limits today

- Capture accepts only `OMNISIGHT_CAPTURE_BASE_URL`, and one capture runs at a time.
- One repair runs at a time, and a job ID can be repaired only once.
- No endpoint accepts a diagnosis from the AI engine yet.
- The dashboard's approval must call `POST /jobs/{id}/approval`; browser-only approvals never reach the backend.