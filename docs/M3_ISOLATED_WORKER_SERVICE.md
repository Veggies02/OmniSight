# OmniSight Milestone M3: Isolated Worker Service Specification & Architecture

## 1. Overview & Purpose

Milestone M3 implements the **Isolated Execution Worker Service** for OmniSight.
Building upon Milestone M1 (Decoupled Security Sandbox) and Milestone M2 (Runner Abstraction & Execution Adapters), M3 provides a standalone, production-hardened microservice dedicated to running browser evidence capture, defect reproduction, and automated repair pipelines in strong isolation from the main FastAPI orchestrator.

---

## 2. Worker Service Architecture

```mermaid
flowchart TD
    Orchestrator["OmniSight API Orchestrator (FastAPI)"] -->|POST /api/v1/tasks| WorkerAPI["Worker Service HTTP API (:8080)"]
    Orchestrator -->|GET /api/v1/tasks/{id}| WorkerAPI
    Orchestrator -->|POST /api/v1/tasks/{id}/cancel| WorkerAPI

    subgraph WorkerService["Isolated Worker Service (FastAPI / Non-Root UID 10001)"]
        WorkerAPI --> Auth["Bearer Token Authenticator"]
        Auth --> Idem["Idempotency & Correlation Registry"]
        Idem --> SchemaCheck["Pydantic v2 Contract Validator"]
        SchemaCheck --> ApprovalGate["Mandatory Human Approval Verifier"]

        ApprovalGate --> Executor["TaskExecutor (Async Daemon Worker)"]

        subgraph IsolationBoundary["Execution Isolation Boundary"]
            Executor --> WSMgr["WorkspaceManager (/tmp/omnisight_worker_workspaces)"]
            Executor --> EnvSanitizer["Environment Sanitizer (Drops LD_PRELOAD, DYLD, Secrets)"]
            Executor --> ProcTree["Process Tree Manager (killpg / taskkill)"]

            ProcTree --> CLI["npm run capture:evidence | repair:execute"]
        end

        Executor --> Artifacts["Artifact Collector (/app/artifacts)"]
        Executor --> Webhook["Webhook Dispatcher (HMAC-SHA256 Signing)"]
    end

    Webhook -->|POST /webhook with X-OmniSight-Signature| Orchestrator
```

---

## 3. Worker API Contracts

All endpoints are versioned under `/api/v1` and strictly validate schemas defined in `execution_schemas.py`.

### 3.1 `GET /health`
* **Authentication:** None (public diagnostic endpoint).
* **Response:**
  ```json
  {
    "status": "healthy",
    "service": "omnisight-execution-worker",
    "version": "1.0.0",
    "mode": "worker_service",
    "deployed": true,
    "available": true,
    "uptime_seconds": 124.5,
    "active_tasks": 1,
    "capabilities": {
      "operations": ["capture_evidence", "execute_repair", "verify_repair"],
      "npm_available": true,
      "node_available": true,
      "auth_required": true,
      "webhook_configured": true,
      "platform": "darwin"
    }
  }
  ```

### 3.2 `POST /api/v1/tasks`
* **Authentication:** `Authorization: Bearer <OMNISIGHT_WORKER_AUTH_TOKEN>`
* **Headers:**
  - `X-Correlation-ID`: Distributed tracing identifier (string, 1-100 chars).
  - `X-Idempotency-Key`: Duplicate request deduplication token (string, 1-100 chars).
* **Request Payload (`ExecutionTaskRequest`):**
  ```json
  {
    "schema_version": "1.0.0",
    "task_id": "task-uuid-001",
    "job_id": "job-repair-101",
    "operation": "execute_repair",
    "timeout_seconds": 300.0,
    "correlation_id": "corr-uuid-001",
    "idempotency_key": "idem-uuid-001",
    "proposal_ref": {
      "proposal_id": "prop-101",
      "scenario_id": "product-image-distortion",
      "defect_category": "UI_DEFECT",
      "source_file": "src/index.css",
      "source_file_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "reviewed_by": "lead-qa-engineer",
      "reviewed_at": "2026-11-07T12:00:00Z",
      "patch_id": "patch-product-image-distortion-001"
    },
    "parameters": {
      "webhook_url": "http://orchestrator:8000/api/v1/webhooks/execution"
    }
  }
  ```
* **Response (`ExecutionTaskResponse`, Status 201 Created):**
  ```json
  {
    "schema_version": "1.0.0",
    "task_id": "task-uuid-001",
    "job_id": "job-repair-101",
    "operation": "execute_repair",
    "status": "queued",
    "submitted_at": "2026-11-07T12:00:00Z",
    "acknowledged_at": "2026-11-07T12:00:00.050Z",
    "runner_mode": "worker_service",
    "correlation_id": "corr-uuid-001",
    "message": "Task accepted and queued for execution."
  }
  ```

### 3.3 `GET /api/v1/tasks/{task_id}`
* **Authentication:** `Authorization: Bearer <OMNISIGHT_WORKER_AUTH_TOKEN>`
* **Response (`ExecutionStatusResponse`):** Returns the current execution lifecycle state (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `REJECTED`, `UNSUPPORTED`, `CANCELLED`) and structured `ExecutionResult`.

### 3.4 `POST /api/v1/tasks/{task_id}/cancel`
* **Authentication:** `Authorization: Bearer <OMNISIGHT_WORKER_AUTH_TOKEN>`
* **Action:** Terminates the underlying process group with `SIGKILL` / `taskkill`, cleans up temporary resources, and sets status to `CANCELLED`.

---

## 4. Container Isolation & Security Hardening

The worker service container (`Dockerfile.worker` and `docker-compose.worker.yml`) enforces layered defense-in-depth:

| Security Control | Implementation | Purpose |
| :--- | :--- | :--- |
| **Unprivileged User** | UID 10001, GID 10001 (`omnisight:omnisight`) | Prevents container-breakout-to-root escalations. |
| **Read-Only Root Filesystem** | `read_only: true` in Compose | Prevents tampering with system binaries, libraries, or Python runtime. |
| **Drop Capabilities** | `cap_drop: [ALL]` | Removes all Linux capabilities (e.g. `CAP_NET_RAW`, `CAP_SYS_ADMIN`, `CAP_SYS_PTRACE`). |
| **No New Privileges** | `security_opt: ["no-new-privileges:true"]` | Blocks setuid/setgid privilege escalation vectors. |
| **Seccomp-BPF Profile** | `seccomp_worker_profile.json` (`defaultAction: SCMP_ACT_ERRNO`) | Denies `ptrace`, `bpf`, `mount`, `kexec_load`, `init_module`, etc. |
| **Ephemeral Filesystem** | tmpfs on `/tmp` (`size=256m,noexec,nosuid`) | Isolates temporary execution artifacts without persistent host disk access. |
| **Resource Limits** | `cpus: "2.0"`, `memory: 2048M`, `pids: 100` | Prevents fork bombs and Denial of Service (DoS) attacks. |
| **PID 1 Signal Forwarding** | `worker_entrypoint.sh` with `exec "$@"` | Ensures SIGTERM/SIGINT propagation from container runtime for clean shutdowns. |

---

## 5. Threat Model & Residual Risks

### 5.1 Addressed Threats
1. **Arbitrary Command Execution:**
   - *Mitigation:* The worker does not accept raw shell strings. Command paths and parameters are constructed strictly from validated enum operations and vetted proposal files.
2. **Path Traversal & Filesystem Probing:**
   - *Mitigation:* `WorkspaceManager.verify_boundary()` and Pydantic validators reject `..`, absolute paths, and ensure execution is confined strictly to allocated workspaces.
3. **Privilege Escalation & Container Escape:**
   - *Mitigation:* Non-root UID 10001, read-only rootfs, dropped capabilities, and seccomp filters prevent root privilege acquisition and kernel exploit surfaces.
4. **Environment Variable / Secret Leakage:**
   - *Mitigation:* Subprocesses receive only an allowlisted set of safe environment variables (`PATH`, `HOME`, `NODE_ENV`, `CI`). Tokens and keys (`OMNISIGHT_WORKER_AUTH_TOKEN`, `OMNISIGHT_WEBHOOK_SECRET`) are stripped prior to subprocess invocation.
5. **Webhook Spoofing & Replay Attacks:**
   - *Mitigation:* Webhook payloads are signed using HMAC-SHA256 (`X-OmniSight-Signature`), checked with constant-time equality, and stamped with ISO 8601 timestamps enforced within a 300-second window.

### 5.2 Residual Risks
1. **Container Breakout via Kernel Vulnerabilities:** Mitigated by dropping capabilities and restricting syscalls via seccomp, but shared Linux host kernel vulnerability risks remain inherent to containers.
2. **Local Development Host Differences:** While Linux environments enforce seccomp-BPF, macOS and Windows hosts rely on user-space process boundaries and environment sanitization.

---

## 6. Environment Variables Reference

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OMNISIGHT_WORKER_HOST` | `0.0.0.0` | Bind host address for worker API. |
| `OMNISIGHT_WORKER_PORT` | `8080` | Port for the worker API service. |
| `OMNISIGHT_WORKER_AUTH_TOKEN` | (None) | Shared secret Bearer token required for all `/api/v1` calls. |
| `OMNISIGHT_WEBHOOK_SECRET` | (None) | HMAC-SHA256 key used to sign outbound webhook events. |
| `OMNISIGHT_WEBHOOK_URL` | (None) | Default webhook URL for status change notifications. |
| `OMNISIGHT_ENFORCE_SANDBOX` | `1` | Enforces fail-closed seccomp sandbox on Linux hosts. |
| `SECURITY_SANDBOX_REQUIRED` | `1` | Aborts entrypoint if seccomp library is absent on Linux. |

---

## 7. Deployment Instructions

### Local Development / Non-Docker Execution
```bash
# Start worker service directly
export OMNISIGHT_WORKER_PORT=8080
export OMNISIGHT_WORKER_AUTH_TOKEN="your-secure-token"
export OMNISIGHT_WEBHOOK_SECRET="your-signing-secret"
python -m uvicorn worker_service:app --host 127.0.0.1 --port 8080
```

### Docker Hardened Deployment
```bash
# Build and run worker in production hardened container
docker compose -f docker-compose.worker.yml up -d --build
```
