"""OmniSight Isolated Execution Worker - Automated Security & Integration Test Suite.

Milestone M3 Comprehensive Verification:
1. REST API & Endpoint Contracts (POST /api/v1/tasks, GET /api/v1/tasks/{task_id}, POST /api/v1/tasks/{task_id}/cancel).
2. Bearer Token Authentication & Authorization.
3. Schema & Path Traversal Protections (Pydantic v2 validation).
4. Mandatory Human Approval Verification for Repair Operations.
5. Idempotent Deduplication & Correlation ID Propagation.
6. Execution Lifecycle State Tracking (QUEUED -> RUNNING -> COMPLETED / REJECTED / UNSUPPORTED / FAILED / CANCELLED).
7. Task Cancellation & Process Tree Termination.
8. Execution Timeout Enforcement.
9. Workspace Provisioning & Ephemeral Filesystem Isolation.
10. Environment Variable Sanitization (stripping LD_PRELOAD, DYLD_*, secrets).
11. Webhook Dispatching, HMAC-SHA256 Signing & Replay Protection.
12. Container Security Configuration Invariants (Dockerfile.worker, docker-compose.worker.yml, seccomp profile).
13. WorkerServiceRunner Client Integration.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional
from unittest.mock import MagicMock, patch
import urllib.parse
import urllib.request

import pytest
from fastapi.testclient import TestClient

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from execution_schemas import (
    ApprovedProposalRef,
    ArtifactItem,
    ExecutionError,
    ExecutionResult,
    ExecutionStatusResponse,
    ExecutionTaskRequest,
    ExecutionTaskResponse,
    RunnerMode,
    StatusWebhookEvent,
    TaskExecutionStatus,
    TaskOperationType,
    WorktreeRef,
)
from worker_service import (
    TaskExecutor,
    WebhookDispatcher,
    WorkerTaskRegistry,
    WorkspaceManager,
    create_worker_app,
)
from execution_runner import (
    ExecutionRunner,
    ExecutionServiceError,
    WorkerServiceRunner,
)

AUTH_TOKEN = "test-worker-secret-bearer-token"
WEBHOOK_SECRET = "test-webhook-hmac-secret-key"


@pytest.fixture
def test_app() -> Any:
    """Creates a worker application instance configured for testing."""
    return create_worker_app(
        auth_token=AUTH_TOKEN,
        webhook_secret=WEBHOOK_SECRET,
        repo_root=REPO_ROOT,
        command_override=[sys.executable, "-c", "import json; print(json.dumps({'finalState': 'PASSED'}))"],
    )


@pytest.fixture
def client(test_app: Any) -> Generator[TestClient, None, None]:
    """TestClient configured for the worker application."""
    with TestClient(test_app) as tc:
        yield tc


# =========================================================================== #
# 1. Authentication & Authorization Tests
# =========================================================================== #
class TestWorkerAuthentication:
    """Verifies Bearer token enforcement and access controls."""

    def test_health_check_does_not_require_auth(self, client: TestClient) -> None:
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service"] == "omnisight-execution-worker"
        assert data["mode"] == "worker_service"
        assert data["deployed"] is True

    def test_task_submission_without_auth_fails(self, client: TestClient) -> None:
        payload = {
            "task_id": "auth-task-1",
            "job_id": "auth-job-1",
            "operation": "capture_evidence",
            "correlation_id": "corr-1",
            "idempotency_key": "idem-1",
        }
        resp = client.post("/api/v1/tasks", json=payload)
        assert resp.status_code == 401
        assert "Authorization: Bearer" in resp.json()["detail"]

    def test_task_submission_with_invalid_token_fails(self, client: TestClient) -> None:
        payload = {
            "task_id": "auth-task-2",
            "job_id": "auth-job-2",
            "operation": "capture_evidence",
            "correlation_id": "corr-2",
            "idempotency_key": "idem-2",
        }
        resp = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": "Bearer wrong-token-value"},
        )
        assert resp.status_code == 401
        assert "Invalid worker authentication token" in resp.json()["detail"]

    def test_task_submission_with_valid_token_succeeds(self, client: TestClient) -> None:
        payload = {
            "task_id": "auth-task-3",
            "job_id": "auth-job-3",
            "operation": "capture_evidence",
            "correlation_id": "corr-3",
            "idempotency_key": "idem-3",
        }
        resp = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["task_id"] == "auth-task-3"
        assert data["status"] == "queued"
        assert data["runner_mode"] == "worker_service"

    def test_status_endpoint_enforces_auth(self, client: TestClient) -> None:
        resp = client.get("/api/v1/tasks/any-task-id")
        assert resp.status_code == 401

    def test_cancel_endpoint_enforces_auth(self, client: TestClient) -> None:
        resp = client.post("/api/v1/tasks/any-task-id/cancel")
        assert resp.status_code == 401


# =========================================================================== #
# 2. Schema Validation & Path Traversal Protections
# =========================================================================== #
class TestWorkerSchemaValidation:
    """Verifies strict input sanitization, schema enforcement, and traversal rejection."""

    def test_reject_missing_required_fields(self, client: TestClient) -> None:
        resp = client.post(
            "/api/v1/tasks",
            json={"task_id": "t1"},
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert resp.status_code == 422

    def test_reject_unsupported_operation_type(self, client: TestClient) -> None:
        payload = {
            "task_id": "t-bad-op",
            "job_id": "j-bad-op",
            "operation": "arbitrary_shell_command",
            "correlation_id": "c1",
            "idempotency_key": "i1",
        }
        resp = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert resp.status_code == 422

    def test_reject_path_traversal_in_proposal_source(self, client: TestClient) -> None:
        payload = {
            "task_id": "t-trav-1",
            "job_id": "j-trav-1",
            "operation": "execute_repair",
            "correlation_id": "c1",
            "idempotency_key": "i1",
            "proposal_ref": {
                "proposal_id": "p1",
                "defect_category": "UI",
                "source_file": "../../etc/passwd",
                "source_file_sha256": "0" * 64,
                "reviewed_by": "auditor",
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
            },
        }
        resp = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert resp.status_code == 422
        assert "Path traversal or absolute path forbidden" in str(resp.json())

    def test_reject_unsafe_worktree_branch(self, client: TestClient) -> None:
        payload = {
            "task_id": "t-branch-bad",
            "job_id": "j-branch-bad",
            "operation": "capture_evidence",
            "correlation_id": "c1",
            "idempotency_key": "i1",
            "worktree_ref": {
                "branch": "-f",
                "base_commit": "HEAD",
            },
        }
        resp = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert resp.status_code == 422


# =========================================================================== #
# 3. Mandatory Human Approval Enforcement
# =========================================================================== #
class TestHumanApprovalEnforcement:
    """Verifies that repair operations can never execute without verified human approval."""

    def test_repair_without_proposal_ref_fails_closed(self, client: TestClient) -> None:
        payload = {
            "task_id": "repair-no-ref",
            "job_id": "repair-job-no-ref",
            "operation": "execute_repair",
            "correlation_id": "c1",
            "idempotency_key": "i1",
        }
        resp = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert resp.status_code == 400
        assert "strictly requires an approved proposal_ref" in resp.json()["detail"]

    def test_repair_with_valid_approval_succeeds(self, client: TestClient) -> None:
        payload = {
            "task_id": "repair-approved-1",
            "job_id": "repair-job-app-1",
            "operation": "execute_repair",
            "correlation_id": "c-app-1",
            "idempotency_key": "i-app-1",
            "proposal_ref": {
                "proposal_id": "prop-101",
                "defect_category": "UI_DEFECT",
                "source_file": "src/components/Cart.tsx",
                "source_file_sha256": "0" * 64,
                "reviewed_by": "qa-engineer-lead",
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
                "patch_id": "patch-cart-01",
            },
        }
        resp = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "queued"


# =========================================================================== #
# 4. Idempotency & Duplicate Task Handling
# =========================================================================== #
class TestWorkerIdempotency:
    """Verifies that duplicate task submissions return consistent results."""

    def test_idempotent_duplicate_submission_returns_existing_task(
        self, client: TestClient
    ) -> None:
        payload = {
            "task_id": "idem-task-1",
            "job_id": "idem-job-1",
            "operation": "capture_evidence",
            "correlation_id": "corr-idem-1",
            "idempotency_key": "idempotency-token-unique-123",
        }

        # First submission
        resp1 = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert resp1.status_code == 201
        assert resp1.json()["task_id"] == "idem-task-1"
        assert "queued" in resp1.json()["message"]

        # Duplicate submission with same idempotency key
        resp2 = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert resp2.status_code == 201
        assert resp2.json()["task_id"] == "idem-task-1"
        assert "idempotency" in resp2.json()["message"].lower()

    def test_correlation_id_propagated_throughout_lifecycle(
        self, client: TestClient
    ) -> None:
        corr_id = "trace-uuid-987654321"
        payload = {
            "task_id": "corr-task-1",
            "job_id": "corr-job-1",
            "operation": "capture_evidence",
            "correlation_id": corr_id,
            "idempotency_key": "idem-corr-1",
        }
        resp = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={
                "Authorization": f"Bearer {AUTH_TOKEN}",
                "X-Correlation-ID": corr_id,
            },
        )
        assert resp.status_code == 201
        assert resp.json()["correlation_id"] == corr_id

        # Verify status endpoint retains correlation ID
        status_resp = client.get(
            f"/api/v1/tasks/{payload['task_id']}",
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert status_resp.status_code == 200
        assert status_resp.json()["correlation_id"] == corr_id


# =========================================================================== #
# 5. Execution Lifecycle States & CLI Interpretation
# =========================================================================== #
class TestWorkerExecutionLifecycle:
    """Verifies state progression and interpretation of CLI outcomes."""

    def test_successful_task_execution_to_completed(self) -> None:
        mock_cmd = [
            sys.executable,
            "-c",
            "import json; print('npm banner'); print(json.dumps({'finalState': 'PASSED'}))",
        ]
        app = create_worker_app(
            auth_token=AUTH_TOKEN,
            repo_root=REPO_ROOT,
            command_override=mock_cmd,
        )

        with TestClient(app) as tc:
            req_data = {
                "task_id": "life-task-pass",
                "job_id": "life-job-pass",
                "operation": "capture_evidence",
                "correlation_id": "c1",
                "idempotency_key": "i-pass",
            }
            resp = tc.post(
                "/api/v1/tasks",
                json=req_data,
                headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
            )
            assert resp.status_code == 201

            # Poll until completed
            deadline = time.monotonic() + 5.0
            while time.monotonic() < deadline:
                stat = tc.get(
                    f"/api/v1/tasks/{req_data['task_id']}",
                    headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
                ).json()
                if stat["status"] == "completed":
                    break
                time.sleep(0.05)

            final_stat = tc.get(
                f"/api/v1/tasks/{req_data['task_id']}",
                headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
            ).json()
            assert final_stat["status"] == "completed"
            assert final_stat["result"]["passed"] is True
            assert final_stat["result"]["final_state"] == "PASSED"

    def test_rejected_task_state_interpretation(self) -> None:
        mock_cmd = [
            sys.executable,
            "-c",
            "import json, sys; print(json.dumps({'finalState': 'REJECTED'})); sys.exit(1)",
        ]
        app = create_worker_app(
            auth_token=AUTH_TOKEN,
            repo_root=REPO_ROOT,
            command_override=mock_cmd,
        )

        with TestClient(app) as tc:
            req_data = {
                "task_id": "life-task-rej",
                "job_id": "life-job-rej",
                "operation": "capture_evidence",
                "correlation_id": "c1",
                "idempotency_key": "i-rej",
            }
            tc.post(
                "/api/v1/tasks",
                json=req_data,
                headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
            )

            deadline = time.monotonic() + 5.0
            while time.monotonic() < deadline:
                stat = tc.get(
                    f"/api/v1/tasks/{req_data['task_id']}",
                    headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
                ).json()
                if stat["status"] in ("rejected", "failed"):
                    break
                time.sleep(0.05)

            final_stat = tc.get(
                f"/api/v1/tasks/{req_data['task_id']}",
                headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
            ).json()
            assert final_stat["status"] == "rejected"
            assert final_stat["result"]["final_state"] == "REJECTED"


# =========================================================================== #
# 6. Cancellation & Timeout Enforcement
# =========================================================================== #
class TestWorkerCancellationAndTimeout:
    """Verifies task aborts and resource cleanup on cancellation/timeout."""

    def test_task_cancellation(self) -> None:
        mock_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
        app = create_worker_app(
            auth_token=AUTH_TOKEN,
            repo_root=REPO_ROOT,
            command_override=mock_cmd,
        )

        with TestClient(app) as tc:
            req_data = {
                "task_id": "task-to-cancel",
                "job_id": "job-to-cancel",
                "operation": "capture_evidence",
                "correlation_id": "c1",
                "idempotency_key": "i-canc",
            }
            tc.post(
                "/api/v1/tasks",
                json=req_data,
                headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
            )
            time.sleep(0.1)

            cancel_resp = tc.post(
                f"/api/v1/tasks/{req_data['task_id']}/cancel",
                headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
            )
            assert cancel_resp.status_code == 200
            assert cancel_resp.json()["status"] == "cancelled"

            stat = tc.get(
                f"/api/v1/tasks/{req_data['task_id']}",
                headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
            ).json()
            assert stat["status"] == "cancelled"

    def test_task_timeout_enforcement(self) -> None:
        mock_cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
        app = create_worker_app(
            auth_token=AUTH_TOKEN,
            repo_root=REPO_ROOT,
            command_override=mock_cmd,
        )

        with TestClient(app) as tc:
            req_data = {
                "task_id": "task-timeout-1",
                "job_id": "job-timeout-1",
                "operation": "capture_evidence",
                "timeout_seconds": 0.3,
                "correlation_id": "c1",
                "idempotency_key": "i-tout",
            }
            tc.post(
                "/api/v1/tasks",
                json=req_data,
                headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
            )

            deadline = time.monotonic() + 5.0
            while time.monotonic() < deadline:
                stat = tc.get(
                    f"/api/v1/tasks/{req_data['task_id']}",
                    headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
                ).json()
                if stat["status"] in ("failed", "completed"):
                    break
                time.sleep(0.05)

            final_stat = tc.get(
                f"/api/v1/tasks/{req_data['task_id']}",
                headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
            ).json()
            assert final_stat["status"] == "failed"
            assert final_stat["error"]["code"] == "timeout"


# =========================================================================== #
# 7. Workspace Isolation & Environment Sanitization
# =========================================================================== #
class TestWorkspaceAndEnvironmentHardening:
    """Verifies filesystem boundary restrictions and environment scrubbing."""

    def test_workspace_creation_and_cleanup(self) -> None:
        mgr = WorkspaceManager()
        ws = mgr.create_workspace("test-ws-task-1")
        assert ws.exists()
        assert "test-ws-task-1" in str(ws)

        # Boundary check
        inside_file = ws / "sub" / "output.txt"
        inside_file.parent.mkdir(parents=True, exist_ok=True)
        inside_file.write_text("ok")
        assert mgr.verify_boundary(inside_file, ws) == inside_file.resolve()

        # Outside boundary rejection
        outside = Path(tempfile.gettempdir()) / "outside.txt"
        with pytest.raises(ValueError, match="escapes allocated workspace"):
            mgr.verify_boundary(outside, ws)

        # Cleanup
        mgr.cleanup_workspace("test-ws-task-1")
        assert not ws.exists()

    def test_environment_sanitization_removes_dangerous_variables(self) -> None:
        registry = WorkerTaskRegistry()
        ws_mgr = WorkspaceManager()
        dispatcher = WebhookDispatcher()
        executor = TaskExecutor(registry, ws_mgr, dispatcher, repo_root=REPO_ROOT)

        env_dirty = {
            "PATH": "/usr/bin:/bin",
            "HOME": "/app",
            "LD_PRELOAD": "/evil/hook.so",
            "DYLD_INSERT_LIBRARIES": "/evil/hook.dylib",
            "OMNISIGHT_WORKER_AUTH_TOKEN": "secret-auth-token",
            "OMNISIGHT_WEBHOOK_SECRET": "secret-signing-key",
            "CI": "true",
            "VITE_ENABLE_DEFECTS": "true",
        }

        with patch.dict(os.environ, env_dirty, clear=True):
            clean = executor.sanitize_environment()
            assert clean.get("PATH") == "/usr/bin:/bin"
            assert clean.get("CI") == "true"
            assert clean.get("VITE_ENABLE_DEFECTS") == "true"

            assert "LD_PRELOAD" not in clean
            assert "DYLD_INSERT_LIBRARIES" not in clean
            assert "OMNISIGHT_WORKER_AUTH_TOKEN" not in clean
            assert "OMNISIGHT_WEBHOOK_SECRET" not in clean


# =========================================================================== #
# 8. Webhook Dispatching & HMAC Signature Verification
# =========================================================================== #
class TestWebhookSecurity:
    """Verifies HMAC-SHA256 event signing and replay protection."""

    def test_webhook_signing_and_verification(self) -> None:
        secret = "super-secret-hmac-test-key"
        dispatcher = WebhookDispatcher(secret=secret)

        event = StatusWebhookEvent(
            event_id="evt-test-1",
            task_id="task-test-1",
            job_id="job-test-1",
            event_type="task.completed",
            status=TaskExecutionStatus.COMPLETED,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

        payload_bytes = json.dumps(event.model_dump()).encode("utf-8")
        sig = dispatcher.sign_payload(payload_bytes, secret)

        # Verify valid signature
        assert dispatcher.verify_signature(payload_bytes, sig, secret) is True
        assert dispatcher.verify_signature(payload_bytes, f"sha256={sig}", secret) is True

        # Verify tampered payload fails
        tampered = json.dumps({"event_id": "tampered"}).encode("utf-8")
        assert dispatcher.verify_signature(tampered, sig, secret) is False

        # Verify wrong secret fails
        assert dispatcher.verify_signature(payload_bytes, sig, "wrong-secret") is False


# =========================================================================== #
# 9. Container Security Configuration Invariant Tests
# =========================================================================== #
class TestContainerSecurityInvariants:
    """Statically verifies hardened Dockerfile, entrypoint, and compose configs."""

    def test_dockerfile_worker_security_invariants(self) -> None:
        dockerfile = REPO_ROOT / "Dockerfile.worker"
        assert dockerfile.exists(), "Dockerfile.worker must exist"
        content = dockerfile.read_text(encoding="utf-8")

        # Multi-stage build
        assert "AS builder" in content
        assert "AS runtime" in content

        # Dedicated non-root user (UID/GID 10001)
        assert "groupadd -g 10001 -r omnisight" in content
        assert "useradd -u 10001 -r -g omnisight" in content
        assert "USER omnisight:omnisight" in content

        # Compiler hardening flags in builder
        assert "-fstack-protector-strong" in content
        assert "-D_FORTIFY_SOURCE=2" in content

        # Hardened entrypoint
        assert 'ENTRYPOINT ["/worker_entrypoint.sh"]' in content

    def test_worker_entrypoint_security_invariants(self) -> None:
        entrypoint = REPO_ROOT / "worker_entrypoint.sh"
        assert entrypoint.exists(), "worker_entrypoint.sh must exist"
        content = entrypoint.read_text(encoding="utf-8")

        # Non-root enforcement
        assert 'CURRENT_UID="$(id -u)"' in content
        assert '"$CURRENT_UID" -eq 0' in content
        assert "Root execution strictly forbidden" in content

        # Signal propagation with PID 1 replacement
        assert 'exec "$@"' in content

    def test_docker_compose_worker_security_invariants(self) -> None:
        compose_file = REPO_ROOT / "docker-compose.worker.yml"
        assert compose_file.exists(), "docker-compose.worker.yml must exist"
        content = compose_file.read_text(encoding="utf-8")

        # Read-only root filesystem
        assert "read_only: true" in content

        # Drop all capabilities
        assert "cap_drop:" in content
        assert "- ALL" in content

        # Prevent privilege escalation
        assert '"no-new-privileges:true"' in content

        # Unprivileged user
        assert 'user: "10001:10001"' in content

        # Seccomp profile specification
        assert "seccomp:./seccomp_worker_profile.json" in content

        # Resource limits
        assert "cpus: \"2.0\"" in content
        assert "memory: 2048M" in content
        assert "pids: 100" in content

    def test_seccomp_worker_profile_invariants(self) -> None:
        profile_file = REPO_ROOT / "seccomp_worker_profile.json"
        assert profile_file.exists(), "seccomp_worker_profile.json must exist"
        data = json.loads(profile_file.read_text(encoding="utf-8"))

        # Fail-closed default action
        assert data["defaultAction"] == "SCMP_ACT_ERRNO"

        # Explicitly blocked syscalls
        blocked = []
        for rule in data["syscalls"]:
            if rule["action"] == "SCMP_ACT_ERRNO":
                blocked.extend(rule["names"])

        assert "ptrace" in blocked
        assert "bpf" in blocked
        assert "mount" in blocked
        assert "kexec_load" in blocked
        assert "init_module" in blocked


# =========================================================================== #
# 10. WorkerServiceRunner Client Integration Tests
# =========================================================================== #
class TestWorkerServiceRunnerIntegration:
    """Verifies that WorkerServiceRunner interacts cleanly with the worker API."""

    def test_worker_service_runner_e2e_with_client(self, client: TestClient) -> None:
        # Custom transport patch directing urllib calls through TestClient
        def fake_urlopen(req: Any, timeout: float = 30.0) -> Any:
            method = req.get_method()
            url = req.full_url
            path = urllib.parse.urlparse(url).path
            headers = dict(req.header_items())

            body_data = req.data
            json_body = json.loads(body_data.decode("utf-8")) if body_data else None

            if method == "POST":
                resp = client.post(path, json=json_body, headers=headers)
            elif method == "GET":
                resp = client.get(path, headers=headers)
            else:
                resp = client.request(method, path, json=json_body, headers=headers)

            mock_resp = MagicMock()
            mock_resp.status = resp.status_code
            mock_resp.read.return_value = resp.content
            mock_resp.__enter__.return_value = mock_resp
            return mock_resp

        runner = WorkerServiceRunner(
            worker_base_url="http://test-worker:8080",
            auth_token=AUTH_TOKEN,
        )

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            task_req = ExecutionTaskRequest(
                task_id="e2e-task-1",
                job_id="e2e-job-1",
                operation=TaskOperationType.CAPTURE_EVIDENCE,
                correlation_id="corr-e2e-1",
                idempotency_key="idem-e2e-1",
            )

            # Submit task
            ack = runner.submit(task_req)
            assert ack.task_id == "e2e-task-1"
            assert ack.status == TaskExecutionStatus.QUEUED

            # Query status
            status_resp = runner.get_status("e2e-task-1")
            assert status_resp.task_id == "e2e-task-1"
            assert status_resp.status in (
                TaskExecutionStatus.QUEUED,
                TaskExecutionStatus.RUNNING,
                TaskExecutionStatus.COMPLETED,
            )

            # Cancel task
            cancel_resp = runner.cancel("e2e-task-1")
            assert cancel_resp.task_id == "e2e-task-1"
            assert cancel_resp.status in (
                TaskExecutionStatus.CANCELLED,
                TaskExecutionStatus.COMPLETED,
            )
