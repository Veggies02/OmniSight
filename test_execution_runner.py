"""OmniSight Execution Runner Abstraction - Automated Test Suite.

Milestone M2 Comprehensive Verification:
1. Interface Compliance: `LocalCliRunner` and `WorkerServiceRunner` adhere to `ExecutionRunner`.
2. Schema & Payload Validation: Strict Pydantic v2 validation, path traversal rejection, SHA-256 integrity.
3. LocalCliRunner Hardening:
   - Environment sanitization (stripping LD_PRELOAD, DYLD_*, tokens, credentials).
   - Working-directory boundary verification.
   - Task execution lifecycle (QUEUED -> RUNNING -> COMPLETED / REJECTED / UNSUPPORTED / FAILED).
   - Timeout handling and process-tree cleanup.
   - Task cancellation.
   - Backward compatibility bridge methods.
4. WorkerServiceRunner Remote Adapter:
   - Explicit reporting that the real worker is not yet deployed (pending M3).
   - Request serialization with correlation IDs, idempotency keys, and auth headers.
   - Status polling and cancellation.
   - Transient error retry with exponential backoff.
   - Non-retryable error fail-fast.
   - HMAC-SHA256 webhook signature validation.
   - Mock HTTP server integration test.
5. Runner Factory: Mode selection and environment variable resolution.
"""

from __future__ import annotations

import hashlib
import hmac
import http.server
import json
import os
import signal
import socketserver
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional
from unittest.mock import MagicMock, patch
import urllib.error

import pytest

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
from execution_runner import (
    ExecutionRunner,
    ExecutionServiceError,
    LocalCliRunner,
    WorkerServiceRunner,
    get_execution_runner,
)


# =========================================================================== #
# Task 1 & Schema Validation Tests
# =========================================================================== #
class TestExecutionSchemas:
    """Tests Pydantic validation and security invariant enforcement."""

    def test_valid_evidence_request(self) -> None:
        req = ExecutionTaskRequest(
            task_id="task-001",
            job_id="job-abc",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            target_url="http://127.0.0.1:5173",
            correlation_id="corr-123",
            idempotency_key="idem-456",
        )
        assert req.task_id == "task-001"
        assert req.operation == TaskOperationType.CAPTURE_EVIDENCE
        assert req.target_url == "http://127.0.0.1:5173"

    def test_valid_repair_request_with_refs(self) -> None:
        proposal = ApprovedProposalRef(
            proposal_id="prop-1",
            scenario_id="scenario-cart",
            defect_category="UI_OVERLAP",
            source_file="src/components/Cart.tsx",
            source_file_sha256="a" * 64,
            reviewed_by="security-auditor",
            reviewed_at=datetime.now(timezone.utc).isoformat(),
            patch_id="patch-fix-01",
        )
        worktree = WorktreeRef(
            branch="repair/job-101",
            base_commit="HEAD",
        )
        req = ExecutionTaskRequest(
            task_id="task-002",
            job_id="job-101",
            operation=TaskOperationType.EXECUTE_REPAIR,
            proposal_ref=proposal,
            worktree_ref=worktree,
            correlation_id="corr-789",
            idempotency_key="idem-789",
        )
        assert req.proposal_ref is not None
        assert req.proposal_ref.source_file == "src/components/Cart.tsx"
        assert req.worktree_ref is not None
        assert req.worktree_ref.branch == "repair/job-101"

    def test_reject_path_traversal_in_proposal(self) -> None:
        with pytest.raises(ValueError, match="Path traversal or absolute path"):
            ApprovedProposalRef(
                proposal_id="prop-bad",
                defect_category="UI_DEFECT",
                source_file="../../etc/passwd",
                source_file_sha256="0" * 64,
                reviewed_by="auditor",
                reviewed_at=datetime.now(timezone.utc).isoformat(),
            )

        with pytest.raises(ValueError, match="Path traversal or absolute path"):
            ApprovedProposalRef(
                proposal_id="prop-bad2",
                defect_category="UI_DEFECT",
                source_file="/etc/shadow",
                source_file_sha256="0" * 64,
                reviewed_by="auditor",
                reviewed_at=datetime.now(timezone.utc).isoformat(),
            )

    def test_reject_invalid_sha256(self) -> None:
        with pytest.raises(ValueError):
            ApprovedProposalRef(
                proposal_id="prop-bad-hash",
                defect_category="UI_DEFECT",
                source_file="src/App.tsx",
                source_file_sha256="not-a-valid-sha256",
                reviewed_by="auditor",
                reviewed_at=datetime.now(timezone.utc).isoformat(),
            )

        with pytest.raises(ValueError, match="Invalid SHA-256 hash"):
            ApprovedProposalRef(
                proposal_id="prop-bad-hash2",
                defect_category="UI_DEFECT",
                source_file="src/App.tsx",
                source_file_sha256="g" * 64,
                reviewed_by="auditor",
                reviewed_at=datetime.now(timezone.utc).isoformat(),
            )

    def test_reject_unsafe_branch_names(self) -> None:
        with pytest.raises(ValueError, match="Invalid or unsafe branch name"):
            WorktreeRef(branch="-f")

        with pytest.raises(ValueError, match="Invalid or unsafe branch name"):
            WorktreeRef(branch="branch/../evil")

    def test_reject_unsafe_url_schemes(self) -> None:
        with pytest.raises(ValueError, match="target_url must have http or https scheme"):
            ExecutionTaskRequest(
                task_id="task-bad-url",
                job_id="job-bad",
                operation=TaskOperationType.CAPTURE_EVIDENCE,
                target_url="file:///etc/passwd",
                correlation_id="corr-1",
                idempotency_key="idem-1",
            )

    def test_reject_path_traversal_in_artifacts(self) -> None:
        with pytest.raises(ValueError, match="Path traversal forbidden in artifact relative_uri"):
            ArtifactItem(
                artifact_id="art-bad",
                kind="screenshot",
                relative_uri="../secret/keys.pem",
                description="Malicious artifact",
            )


# =========================================================================== #
# Task 2: LocalCliRunner Tests
# =========================================================================== #
class TestLocalCliRunner:
    """Verifies LocalCliRunner behavior, security restrictions, and lifecycle."""

    def test_interface_compliance(self) -> None:
        runner = LocalCliRunner(repo_root=REPO_ROOT)
        assert isinstance(runner, ExecutionRunner)
        assert runner.mode == RunnerMode.LOCAL_CLI

    def test_environment_sanitization_strips_dangerous_variables(self) -> None:
        runner = LocalCliRunner(repo_root=REPO_ROOT)

        env_before = {
            "PATH": "/usr/bin:/bin",
            "HOME": "/home/user",
            "LD_PRELOAD": "/usr/lib/malicious.so",
            "DYLD_INSERT_LIBRARIES": "/usr/lib/hook.dylib",
            "OMNISIGHT_OPERATOR_TOKEN": "super-secret-token",
            "GITHUB_TOKEN": "ghp_1234567890",
            "CUSTOM_API_SECRET_KEY": "some-secret",
            "CI": "true",
            "VITE_ENABLE_DEFECTS": "true",
        }

        with patch.dict(os.environ, env_before, clear=True):
            clean_env = runner.sanitize_environment()

            # Allowed variables must be present
            assert clean_env.get("PATH") == "/usr/bin:/bin"
            assert clean_env.get("HOME") == "/home/user"
            assert clean_env.get("CI") == "true"
            assert clean_env.get("VITE_ENABLE_DEFECTS") == "true"

            # Dangerous injection & token variables must be eradicated
            assert "LD_PRELOAD" not in clean_env
            assert "DYLD_INSERT_LIBRARIES" not in clean_env
            assert "OMNISIGHT_OPERATOR_TOKEN" not in clean_env
            assert "GITHUB_TOKEN" not in clean_env
            assert "CUSTOM_API_SECRET_KEY" not in clean_env

    def test_environment_sanitization_with_overrides(self) -> None:
        runner = LocalCliRunner(repo_root=REPO_ROOT)
        with patch.dict(os.environ, {"PATH": "/bin"}, clear=True):
            clean_env = runner.sanitize_environment(overrides={"NODE_ENV": "production", "LD_PRELOAD": "bad"})
            assert clean_env.get("NODE_ENV") == "production"
            assert "LD_PRELOAD" not in clean_env

    def test_path_boundary_verification(self) -> None:
        runner = LocalCliRunner(repo_root=REPO_ROOT)

        # Valid paths inside repo
        valid_path = REPO_ROOT / "scripts"
        assert runner._verify_path_boundary(valid_path) == valid_path.resolve()

        # Invalid path outside repo
        outside_path = REPO_ROOT.parent / "some_other_folder"
        with pytest.raises(ValueError, match="escapes repository root"):
            runner._verify_path_boundary(outside_path)

    def test_task_submission_and_successful_execution(self) -> None:
        # Use a mock python command that outputs finalState: PASSED
        mock_cmd = [
            sys.executable,
            "-c",
            "import json; print('npm banner'); print(json.dumps({'finalState': 'PASSED', 'scenarios': 4}))",
        ]
        runner = LocalCliRunner(repo_root=REPO_ROOT, command_override=mock_cmd)

        req = ExecutionTaskRequest(
            task_id="task-test-success",
            job_id="job-succ-1",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            correlation_id="corr-s1",
            idempotency_key="idem-s1",
        )

        submit_resp = runner.submit(req)
        assert submit_resp.status == TaskExecutionStatus.QUEUED
        assert submit_resp.runner_mode == RunnerMode.LOCAL_CLI

        # Wait for thread execution
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            status = runner.get_status(req.task_id)
            if status.status in (TaskExecutionStatus.COMPLETED, TaskExecutionStatus.FAILED):
                break
            time.sleep(0.05)

        final_status = runner.get_status(req.task_id)
        assert final_status.status == TaskExecutionStatus.COMPLETED
        assert final_status.result is not None
        assert final_status.result.passed is True
        assert final_status.result.final_state == "PASSED"
        assert final_status.result.exit_code == 0

    def test_task_execution_handles_rejected_state(self) -> None:
        mock_cmd = [
            sys.executable,
            "-c",
            "import json, sys; print(json.dumps({'finalState': 'REJECTED', 'reason': 'Unknown scenario'})); sys.exit(1)",
        ]
        runner = LocalCliRunner(repo_root=REPO_ROOT, command_override=mock_cmd)

        req = ExecutionTaskRequest(
            task_id="task-test-reject",
            job_id="job-rej-1",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            correlation_id="corr-r1",
            idempotency_key="idem-r1",
        )

        runner.submit(req)

        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            status = runner.get_status(req.task_id)
            if status.status in (TaskExecutionStatus.REJECTED, TaskExecutionStatus.FAILED):
                break
            time.sleep(0.05)

        final_status = runner.get_status(req.task_id)
        assert final_status.status == TaskExecutionStatus.REJECTED
        assert final_status.result is not None
        assert final_status.result.passed is False
        assert final_status.result.final_state == "REJECTED"

    def test_task_timeout_handling_and_process_cleanup(self) -> None:
        # Long running sleep command with tiny timeout
        mock_cmd = [
            sys.executable,
            "-c",
            "import time; time.sleep(10)",
        ]
        runner = LocalCliRunner(repo_root=REPO_ROOT, command_override=mock_cmd)

        req = ExecutionTaskRequest(
            task_id="task-test-timeout",
            job_id="job-time-1",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            timeout_seconds=0.3,
            correlation_id="corr-t1",
            idempotency_key="idem-t1",
        )

        runner.submit(req)

        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            status = runner.get_status(req.task_id)
            if status.status in (TaskExecutionStatus.FAILED, TaskExecutionStatus.COMPLETED):
                break
            time.sleep(0.05)

        final_status = runner.get_status(req.task_id)
        assert final_status.status == TaskExecutionStatus.FAILED
        assert final_status.error is not None
        assert final_status.error.code == "timeout"
        assert final_status.result is not None
        assert final_status.result.passed is False

    def test_task_cancellation(self) -> None:
        mock_cmd = [
            sys.executable,
            "-c",
            "import time; time.sleep(10)",
        ]
        runner = LocalCliRunner(repo_root=REPO_ROOT, command_override=mock_cmd)

        req = ExecutionTaskRequest(
            task_id="task-test-cancel",
            job_id="job-canc-1",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            timeout_seconds=30.0,
            correlation_id="corr-c1",
            idempotency_key="idem-c1",
        )

        runner.submit(req)
        # Give thread a split second to start
        time.sleep(0.1)

        cancel_resp = runner.cancel(req.task_id)
        assert cancel_resp.status == TaskExecutionStatus.CANCELLED

        final_status = runner.get_status(req.task_id)
        assert final_status.status == TaskExecutionStatus.CANCELLED

    def test_cancel_nonexistent_task_raises(self) -> None:
        runner = LocalCliRunner(repo_root=REPO_ROOT)
        with pytest.raises(KeyError, match="not found"):
            runner.cancel("nonexistent-task")

    def test_health_check_reporting(self) -> None:
        runner = LocalCliRunner(repo_root=REPO_ROOT)
        health = runner.health_check()
        assert health["status"] in ("healthy", "degraded")
        assert health["mode"] == "local_cli"
        assert health["available"] is True
        assert "active_tasks" in health
        assert "repo_root" in health

    def test_backward_compatible_run_browser(self) -> None:
        mock_cmd = [sys.executable, "-c", "import json; print(json.dumps({'finalState': 'PASSED'}))"]
        runner = LocalCliRunner(repo_root=REPO_ROOT, command_override=mock_cmd, timeout_seconds=5.0)

        result = runner.run_browser(job_id="compat-job-1", website_url="http://127.0.0.1:5173")
        assert result["mode"] == "local_cli"
        assert result["executed"] is True
        assert result["run_id"] == "compat-job-1"

    def test_backward_compatible_run_repair_refuses_unapproved(self) -> None:
        runner = LocalCliRunner(repo_root=REPO_ROOT)
        with pytest.raises(ExecutionServiceError, match="No human approval record"):
            runner.run_repair(
                job_id="compat-repair-1",
                proposal={"proposalId": "p1"},
                approval=None,
            )


# =========================================================================== #
# Task 3: WorkerServiceRunner Tests
# =========================================================================== #
class TestWorkerServiceRunner:
    """Verifies WorkerServiceRunner behavior, retries, headers, and honesty."""

    def test_interface_compliance(self) -> None:
        runner = WorkerServiceRunner(worker_base_url="http://127.0.0.1:9999")
        assert isinstance(runner, ExecutionRunner)
        assert runner.mode == RunnerMode.WORKER_SERVICE

    def test_health_check_truthfully_reports_pending_m3_worker_deployment(self) -> None:
        runner = WorkerServiceRunner(worker_base_url="http://127.0.0.1:9999")
        health = runner.health_check(probe=False)

        assert health["status"] == "pending_m3_worker_deployment"
        assert health["mode"] == "worker_service"
        assert health["deployed"] is False
        assert health["available"] is False
        assert "Milestone M3 pending" in health["message"]

    @patch("urllib.request.urlopen")
    def test_submit_dispatches_proper_request_and_headers(self, mock_urlopen: MagicMock) -> None:
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "schema_version": "1.0.0",
            "task_id": "remote-task-1",
            "job_id": "job-r1",
            "operation": "capture_evidence",
            "status": "queued",
            "submitted_at": "2026-11-07T12:00:00Z",
            "acknowledged_at": "2026-11-07T12:00:01Z",
            "runner_mode": "worker_service",
            "correlation_id": "corr-remote-1",
        }).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        runner = WorkerServiceRunner(
            worker_base_url="http://execution-worker.internal:8080",
            auth_token="test-bearer-token",
        )

        req = ExecutionTaskRequest(
            task_id="remote-task-1",
            job_id="job-r1",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            correlation_id="corr-remote-1",
            idempotency_key="idem-remote-1",
        )

        ack = runner.submit(req)
        assert ack.task_id == "remote-task-1"
        assert ack.status == TaskExecutionStatus.QUEUED
        assert ack.runner_mode == RunnerMode.WORKER_SERVICE

        # Verify dispatched HTTP request
        mock_urlopen.assert_called_once()
        sent_req = mock_urlopen.call_args[0][0]
        assert sent_req.full_url == "http://execution-worker.internal:8080/api/v1/tasks"
        assert sent_req.get_header("Authorization") == "Bearer test-bearer-token"
        assert sent_req.get_header("X-correlation-id") == "corr-remote-1"
        assert sent_req.get_header("X-idempotency-key") == "idem-remote-1"
        assert sent_req.get_header("Content-type") == "application/json"

    @patch("urllib.request.urlopen")
    def test_get_status_dispatches_get(self, mock_urlopen: MagicMock) -> None:
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "schema_version": "1.0.0",
            "task_id": "remote-task-2",
            "job_id": "job-r2",
            "operation": "execute_repair",
            "status": "completed",
            "submitted_at": "2026-11-07T12:00:00Z",
            "completed_at": "2026-11-07T12:01:00Z",
            "runner_mode": "worker_service",
            "correlation_id": "corr-remote-2",
            "result": {
                "passed": True,
                "final_state": "PASSED",
                "exit_code": 0,
                "message": "Remote repair succeeded",
                "duration_seconds": 60.0,
            },
        }).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        runner = WorkerServiceRunner(worker_base_url="http://execution-worker.internal:8080")
        status = runner.get_status("remote-task-2")

        assert status.task_id == "remote-task-2"
        assert status.status == TaskExecutionStatus.COMPLETED
        assert status.result is not None
        assert status.result.passed is True

    @patch("urllib.request.urlopen")
    def test_cancel_dispatches_post(self, mock_urlopen: MagicMock) -> None:
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "schema_version": "1.0.0",
            "task_id": "remote-task-3",
            "job_id": "job-r3",
            "operation": "capture_evidence",
            "status": "cancelled",
            "submitted_at": "2026-11-07T12:00:00Z",
            "completed_at": "2026-11-07T12:00:30Z",
            "runner_mode": "worker_service",
            "correlation_id": "corr-remote-3",
        }).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        runner = WorkerServiceRunner(worker_base_url="http://execution-worker.internal:8080")
        cancel_resp = runner.cancel("remote-task-3")

        assert cancel_resp.status == TaskExecutionStatus.CANCELLED
        sent_req = mock_urlopen.call_args[0][0]
        assert sent_req.full_url == "http://execution-worker.internal:8080/api/v1/tasks/remote-task-3/cancel"

    @patch("urllib.request.urlopen")
    def test_non_retryable_client_error_fails_immediately(self, mock_urlopen: MagicMock) -> None:
        # Simulate HTTP 400 Bad Request
        fp = MagicMock()
        fp.read.return_value = b'{"error": "Invalid payload format"}'
        err = urllib.error.HTTPError(
            url="http://test/api/v1/tasks",
            code=400,
            msg="Bad Request",
            hdrs={},
            fp=fp,
        )
        mock_urlopen.side_effect = err

        runner = WorkerServiceRunner(
            worker_base_url="http://test",
            max_retries=3,
        )

        req = ExecutionTaskRequest(
            task_id="task-400",
            job_id="job-400",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            correlation_id="c1",
            idempotency_key="i1",
        )

        with pytest.raises(ExecutionServiceError) as exc_info:
            runner.submit(req)

        assert exc_info.value.status_code == 400
        assert exc_info.value.retryable is False
        # Must only call once (no retry for 400)
        assert mock_urlopen.call_count == 1

    @patch("time.sleep")
    @patch("urllib.request.urlopen")
    def test_transient_server_error_retries_with_backoff(
        self, mock_urlopen: MagicMock, mock_sleep: MagicMock
    ) -> None:
        fp = MagicMock()
        fp.read.return_value = b"Internal Server Error"
        err500 = urllib.error.HTTPError(
            url="http://test/api/v1/tasks",
            code=500,
            msg="Server Error",
            hdrs={},
            fp=fp,
        )

        # Fail twice with 500, then succeed on 3rd attempt
        mock_success = MagicMock()
        mock_success.read.return_value = json.dumps({
            "schema_version": "1.0.0",
            "task_id": "task-retry",
            "job_id": "job-r",
            "operation": "capture_evidence",
            "status": "queued",
            "submitted_at": "2026-11-07T12:00:00Z",
            "runner_mode": "worker_service",
            "correlation_id": "c1",
        }).encode("utf-8")
        mock_success.__enter__.return_value = mock_success

        mock_urlopen.side_effect = [err500, err500, mock_success]

        runner = WorkerServiceRunner(
            worker_base_url="http://test",
            max_retries=3,
            retry_backoff_factor=0.1,
        )

        req = ExecutionTaskRequest(
            task_id="task-retry",
            job_id="job-r",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            correlation_id="c1",
            idempotency_key="i1",
        )

        ack = runner.submit(req)
        assert ack.status == TaskExecutionStatus.QUEUED
        assert mock_urlopen.call_count == 3
        assert mock_sleep.call_count == 2

    def test_webhook_signature_verification(self) -> None:
        secret = "super-secret-hmac-key"
        payload = b'{"event": "task.completed", "task_id": "task-01"}'

        # Compute valid signature
        valid_digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()

        runner = WorkerServiceRunner(webhook_secret=secret)

        # Test raw hex
        assert runner.verify_webhook_signature(payload, valid_digest) is True
        # Test sha256= prefix
        assert runner.verify_webhook_signature(payload, f"sha256={valid_digest}") is True
        # Test invalid signature
        assert runner.verify_webhook_signature(payload, "invalid-hex-digest") is False
        # Test tampered payload
        tampered = b'{"event": "task.tampered"}'
        assert runner.verify_webhook_signature(tampered, valid_digest) is False

    def test_webhook_signature_without_secret_raises(self) -> None:
        runner = WorkerServiceRunner(webhook_secret=None)
        with pytest.raises(ValueError, match="No webhook secret"):
            runner.verify_webhook_signature(b"data", "sig", secret=None)


# =========================================================================== #
# Task 4 & Mock HTTP Server Integration Tests
# =========================================================================== #
class _MockWorkerHandler(http.server.BaseHTTPRequestHandler):
    """Minimal HTTP handler simulating OmniSight Execution Worker API."""

    def log_message(self, format: str, *args: Any) -> None:
        pass  # Suppress stderr logging during tests

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "worker-online", "version": "1.0.0"}).encode())
        elif self.path.startswith("/api/v1/tasks/"):
            task_id = self.path.split("/")[-1]
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "schema_version": "1.0.0",
                "task_id": task_id,
                "job_id": "job-mock",
                "operation": "capture_evidence",
                "status": "completed",
                "submitted_at": "2026-11-07T12:00:00Z",
                "runner_mode": "worker_service",
                "correlation_id": "c-mock",
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:
        if self.path == "/api/v1/tasks":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            payload = json.loads(body.decode())
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "schema_version": "1.0.0",
                "task_id": payload["task_id"],
                "job_id": payload["job_id"],
                "operation": payload["operation"],
                "status": "queued",
                "submitted_at": payload.get("submitted_at", "2026-11-07T12:00:00Z"),
                "runner_mode": "worker_service",
                "correlation_id": payload["correlation_id"],
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()


@pytest.fixture(scope="module")
def mock_worker_server() -> Generator[str, None, None]:
    """Spins up a lightweight mock HTTP worker server in a background thread."""
    try:
        server = socketserver.TCPServer(("127.0.0.1", 0), _MockWorkerHandler)
    except OSError as exc:
        pytest.skip(f"Local TCP socket binding not permitted in this sandbox: {exc}")
        return

    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    yield f"http://127.0.0.1:{port}"

    server.shutdown()
    server.server_close()


class TestWorkerServiceHttpIntegration:
    """End-to-end integration tests using the live mock HTTP worker service."""

    def test_mock_worker_health_probe(self, mock_worker_server: str) -> None:
        runner = WorkerServiceRunner(worker_base_url=mock_worker_server)
        try:
            health = runner.health_check(probe=True)
        except ExecutionServiceError as exc:
            if "Operation not permitted" in str(exc) or "connection_failed" in exc.code:
                pytest.skip(f"Local socket connect blocked by sandbox: {exc}")
            raise

        if health.get("status") == "unreachable" and "Operation not permitted" in str(health.get("error", "")):
            pytest.skip("Local socket connect blocked by sandbox policy")

        assert health["status"] == "healthy"
        assert health["deployed"] is True
        assert health["available"] is True
        assert health["remote_response"]["status"] == "worker-online"

    def test_mock_worker_task_submission_and_status(self, mock_worker_server: str) -> None:
        runner = WorkerServiceRunner(worker_base_url=mock_worker_server)

        req = ExecutionTaskRequest(
            task_id="task-live-mock-1",
            job_id="job-live-mock-1",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            correlation_id="corr-live-1",
            idempotency_key="idem-live-1",
        )

        try:
            ack = runner.submit(req)
        except ExecutionServiceError as exc:
            if "Operation not permitted" in str(exc) or "connection_failed" in exc.code:
                pytest.skip(f"Local socket connect blocked by sandbox: {exc}")
            raise
        assert ack.task_id == "task-live-mock-1"
        assert ack.status == TaskExecutionStatus.QUEUED

        status = runner.get_status("task-live-mock-1")
        assert status.task_id == "task-live-mock-1"
        assert status.status == TaskExecutionStatus.COMPLETED


# =========================================================================== #
# Runner Factory Tests
# =========================================================================== #
class TestRunnerFactory:
    """Verifies factory instantiation and configuration resolution."""

    def test_factory_returns_local_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            runner = get_execution_runner()
            assert isinstance(runner, LocalCliRunner)
            assert runner.mode == RunnerMode.LOCAL_CLI

    def test_factory_returns_worker_via_explicit_mode(self) -> None:
        runner = get_execution_runner(mode="worker_service")
        assert isinstance(runner, WorkerServiceRunner)
        assert runner.mode == RunnerMode.WORKER_SERVICE

    def test_factory_returns_worker_via_enum(self) -> None:
        runner = get_execution_runner(mode=RunnerMode.WORKER_SERVICE)
        assert isinstance(runner, WorkerServiceRunner)

    def test_factory_respects_env_variable(self) -> None:
        with patch.dict(os.environ, {"OMNISIGHT_RUNNER_MODE": "worker_service"}):
            runner = get_execution_runner()
            assert isinstance(runner, WorkerServiceRunner)

    def test_factory_raises_on_invalid_mode(self) -> None:
        with pytest.raises(ValueError, match="Unknown runner mode"):
            get_execution_runner(mode="hyper_execution_v3")
