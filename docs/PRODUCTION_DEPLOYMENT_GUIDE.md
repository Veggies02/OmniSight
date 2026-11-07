# OmniSight Production Deployment & Operations Guide

**Milestone:** M3.3 (Production Readiness & Reliability Engineering)  
**Author:** DevSecOps & Production Reliability Engineering  
**Target:** OmniSight Execution Worker & Isolated Subprocess Infrastructure  
**Status:** Approved for Production Deployment

---

## 1. Architectural Topology

OmniSight separates interactive web operations from potentially dangerous execution workloads across three distinct security domains:

```
[ Human Reviewer / Web UI ]
            │ (Signs approved proposals via Ed25519 Private Key)
            ▼
[ OmniSight Orchestrator Backend ]  (main.py / FastAPI)
            │ (Dispatches validated task requests via HTTP/JSON)
            ▼
┌─────────────────────────────────────────────────────────────┐
│ Docker Execution Worker Host                                │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Container: omnisight-execution-worker               │   │
│   │                                                     │   │
│   │  • Non-root execution: UID 10001, GID 10001         │   │
│   │  • Read-only root filesystem (read_only: true)       │   │
│   │  • Drop all capabilities (cap_drop: ALL)            │   │
│   │  • No new privileges (no-new-privileges: true)      │   │
│   │  • Seccomp BPF syscall filter (26 blocked calls)    │   │
│   │  • cgroup v2 limits: 2.0 CPUs, 2GB RAM, 100 PIDs    │   │
│   │  • Outbound network isolation                       │   │
│   │  • Tmpfs: /tmp (256MB), /run (64MB)                 │   │
│   │  • Dedicated 0700 ephemeral workspaces              │   │
│   │  • Possesses ONLY Public Verification Keys          │   │
│   │    (Private signing keys strictly forbidden)        │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Secrets & Environment Configuration

### Required Environment Variables (Production)

| Variable | Description | Required | Sensitive | Allowed in Worker? |
|---|---|---|---|---|
| `OMNISIGHT_ENVIRONMENT` | Set to `production` for strict secret and security enforcement. | **YES** | No | Yes |
| `OMNISIGHT_WORKER_AUTH_TOKEN` | High-entropy Bearer token for worker REST API authorization. Must NOT use default fallback. | **YES** | **YES** | Yes |
| `OMNISIGHT_WEBHOOK_SECRET` | HMAC-SHA256 shared secret for webhook signing. Must NOT use default fallback. | **YES** | **YES** | Yes |
| `OMNISIGHT_APPROVAL_PUBLIC_KEY_HEX` | 64-hex-character Ed25519 public key of the authoritative signing station. | **YES** | No | Yes |
| `OMNISIGHT_APPROVAL_KEY_ID` | Key identifier corresponding to the authoritative public key. | **YES** | No | Yes |
| `OMNISIGHT_REVOKED_KEY_IDS` | Comma-separated list of revoked signing key IDs. | Optional | No | Yes |
| `OMNISIGHT_APPROVAL_PRIVATE_KEY_HEX` | 64-hex raw private key used ONLY by the Review Station. | **STATION ONLY** | **CRITICAL** | **FORBIDDEN (Fails closed)** |

> [!CAUTION]
> **Secret Boundary Invariant:** `OMNISIGHT_APPROVAL_PRIVATE_KEY_HEX` must **NEVER** enter the execution worker environment or container. Worker service startup will immediately abort (`RuntimeError: CRITICAL SECURITY VIOLATION`) if a private signing key is detected in the worker environment.

---

## 3. Deployment Commands

### Production Deployment
```bash
# 1. Ensure production secrets are exported
export OMNISIGHT_ENVIRONMENT=production
export OMNISIGHT_WORKER_AUTH_TOKEN="$(openssl rand -hex 32)"
export OMNISIGHT_WEBHOOK_SECRET="$(openssl rand -hex 32)"
export OMNISIGHT_APPROVAL_PUBLIC_KEY_HEX="<64-hex-public-key>"
export OMNISIGHT_APPROVAL_KEY_ID="omnisight-prod-root-v1"

# 2. Build and launch with production compose configuration
docker compose -f docker-compose.worker.yml up -d --build

# 3. Verify health and security readiness
curl -f http://127.0.0.1:8080/health
curl -f http://127.0.0.1:8080/metrics
```

### Development Deployment
```bash
# Launch with development overrides (unrestricted, debug logging, dev auth tokens)
docker compose -f docker-compose.worker.yml -f docker-compose.worker.dev.yml up
```

---

## 4. Observability & Monitoring

### Structured JSON Logging
Set `LOG_FORMAT=json` in production to stream single-line JSON logs to stdout:
```json
{
  "timestamp": "2026-11-07T16:55:00.123456+00:00",
  "level": "INFO",
  "logger": "omnisight.worker_service",
  "message": "Received new task task-101 (operation=capture_evidence)",
  "service": "omnisight-execution-worker",
  "correlation_id": "corr-uuid-8b3e819b",
  "task_id": "task-101"
}
```

### Metrics Telemetry Endpoints
- `GET /metrics` and `GET /api/v1/metrics`:
  - `total_requests`: Cumulative API requests processed.
  - `tasks`: Submitted, completed, failed, cancelled, timed out, and latency distribution (min, avg, max).
  - `security_events`: Counters for auth failures, replay attack blocks, invalid signatures, revoked key blocks, and oversized payload rejections.
  - `resources`: Process resident set size (`memory_rss_mb`) and active threads.

---

## 5. Reliability, Draining & Disaster Recovery

### Graceful Draining
When the container receives `SIGTERM` (e.g. during rolling update or `docker stop`):
1. Worker enters `draining` state (`app.state.is_draining = True`).
2. `/health` reports `"status": "draining"` and `"available": false`.
3. New task submissions (`POST /api/v1/tasks`) are rejected with `HTTP 503 Service Unavailable`.
4. Active tasks are granted up to a 3-second grace window to finish, after which lingering processes receive `SIGTERM -> SIGKILL`.
5. Workspaces are cleaned up and the container exits cleanly.

### Startup Workspace Janitor
On worker container restart, `WorkspaceManager.cleanup_abandoned_workspaces(max_age_seconds=3600.0)` scans the workspace mount point and reclaims any orphaned workspace directories from aborted or crashed runs.

### Task Retryability Runbook
- **`CAPTURE_EVIDENCE` / `INSPECT`:** Safe to retry automatically without human intervention.
- **`EXECUTE_REPAIR`:** **DO NOT RETRY AUTOMATICALLY.** The approval nonce was recorded in the replay cache to prevent replay attacks. A failed repair requires human review and generation of a fresh approval payload.

