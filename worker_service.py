"""OmniSight Isolated Execution Worker Service.

Milestone M3: Dedicated, container-ready execution worker service exposing
versioned HTTP endpoints matching the contracts established in Milestone M2.

Key Capabilities:
1. Versioned REST API (`POST /api/v1/tasks`, `GET /api/v1/tasks/{task_id}`, `POST /api/v1/tasks/{task_id}/cancel`).
2. Strict Pydantic v2 validation using `execution_schemas.py`.
3. Bearer token authorization (`OMNISIGHT_WORKER_AUTH_TOKEN`).
4. Idempotency key tracking and correlation ID propagation.
5. Thread-safe task state registry with non-blocking async execution.
6. Isolated temporary workspace provisioning and automatic cleanup.
7. Mandatory human approval verification for repair execution.
8. Asynchronous webhook delivery with HMAC-SHA256 signing and replay protection.
9. Cross-platform process tree termination and timeout management.
10. Seccomp-BPF worker security integration on supported Linux kernels.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional, Set, Tuple, Union

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Security, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

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
from crypto_approval import ApprovalVerifier

logger = logging.getLogger("omnisight.worker_service")

# Default service configuration
DEFAULT_WORKER_PORT = 8080
DEFAULT_TIMEOUT_SECONDS = 300.0
WEBHOOK_MAX_RETRIES = 3
WEBHOOK_REPLAY_WINDOW_SECONDS = 300.0  # 5 minutes replay window

# Safe environment variables allowlist for execution subprocesses
SAFE_WORKER_ENV_KEYS = frozenset({
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SYSTEMROOT",
    "COMSPEC",
    "PATHEXT",
    "LANG",
    "LC_ALL",
    "NODE_ENV",
    "CI",
    "VITE_ENABLE_DEFECTS",
    "PLAYWRIGHT_BROWSERS_PATH",
})

# Dangerous environment keys that MUST be scrubbed from worker processes
DANGEROUS_WORKER_ENV_KEYS = frozenset({
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH",
    "OMNISIGHT_OPERATOR_TOKEN",
    "OMNISIGHT_WORKER_AUTH_TOKEN",
    "OMNISIGHT_WEBHOOK_SECRET",
    "GITHUB_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "SECRET_KEY",
})


# =========================================================================== #
# Helper Utilities: Process Tree Management & Executable Resolution
# =========================================================================== #
def _kill_process_tree(process: subprocess.Popen[str]) -> None:
    """Terminates a process and all its descendants cleanly across platforms."""
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                check=False,
            )
        else:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            process.kill()
        except OSError:
            pass


def _resolve_executable(cmd_name: str) -> str:
    """Finds an executable on system PATH with cross-platform extension resolution."""
    if sys.platform == "win32" and not cmd_name.lower().endswith((".exe", ".cmd", ".bat")):
        candidate = shutil.which(f"{cmd_name}.cmd") or shutil.which(f"{cmd_name}.exe")
        if candidate:
            return candidate
    resolved = shutil.which(cmd_name)
    if resolved:
        return resolved
    raise FileNotFoundError(f"Required executable {cmd_name!r} not found on system PATH.")


# =========================================================================== #
# Task State Registry & Workspace Manager
# =========================================================================== #
class WorkspaceManager:
    """Manages ephemeral execution directories isolated from the host filesystem."""

    def __init__(self, base_dir: Optional[Path] = None) -> None:
        if base_dir:
            self.base_dir = Path(base_dir).resolve()
            self.base_dir.mkdir(parents=True, exist_ok=True)
        else:
            self.base_dir = Path(tempfile.gettempdir()) / "omnisight_worker_workspaces"
            self.base_dir.mkdir(parents=True, exist_ok=True)

    def create_workspace(self, task_id: str) -> Path:
        """Provisions an isolated workspace directory with 0700 permissions for a task."""
        safe_task_id = re.sub(r"[^A-Za-z0-9_-]", "_", str(task_id))
        if not safe_task_id:
            safe_task_id = "default_task"
        workspace = (self.base_dir / safe_task_id).resolve()
        try:
            workspace.relative_to(self.base_dir.resolve())
        except ValueError:
            raise ValueError(f"Task ID {task_id!r} escapes workspace root boundary.")

        workspace.mkdir(parents=True, exist_ok=True)
        try:
            workspace.chmod(0o700)
        except OSError:
            pass
        return workspace

    def cleanup_workspace(self, task_id: Union[str, Path]) -> None:
        """Removes the ephemeral workspace and all temporary artifacts."""
        if isinstance(task_id, Path):
            workspace = task_id.resolve()
        else:
            safe_task_id = re.sub(r"[^A-Za-z0-9_-]", "_", str(task_id))
            workspace = (self.base_dir / safe_task_id).resolve()

        try:
            workspace.relative_to(self.base_dir.resolve())
        except ValueError:
            return

        if workspace.exists():
            try:
                shutil.rmtree(workspace, ignore_errors=True)
            except OSError as exc:
                logger.warning("Failed to remove workspace %s: %s", workspace, exc)

    def verify_boundary(self, target: Path, workspace: Path) -> Path:
        """Verifies that target does not escape the allocated workspace boundary."""
        resolved = target.resolve()
        try:
            resolved.relative_to(workspace.resolve())
        except ValueError:
            raise ValueError(f"Path {resolved} escapes allocated workspace {workspace}")
        return resolved


class WorkerTaskRegistry:
    """Thread-safe state manager for tracked worker tasks and active processes."""

    def __init__(self, max_tasks: int = 1000) -> None:
        self._tasks: Dict[str, ExecutionStatusResponse] = {}
        self._idempotency_map: Dict[str, str] = {}  # idempotency_key -> task_id
        self._processes: Dict[str, subprocess.Popen[str]] = {}
        self._workspaces: Dict[str, Path] = {}
        self._max_tasks = max_tasks
        self._lock = threading.Lock()

    def register_task(
        self, request: ExecutionTaskRequest
    ) -> Tuple[ExecutionStatusResponse, bool]:
        """Registers a task specification or retrieves an existing idempotent task.

        Returns:
            Tuple of (status_response, is_new_submission).
        """
        with self._lock:
            # Check idempotency map first
            if request.idempotency_key in self._idempotency_map:
                existing_task_id = self._idempotency_map[request.idempotency_key]
                if existing_task_id in self._tasks:
                    logger.info(
                        "[REGISTRY] Idempotent hit: key %r mapped to task %r",
                        request.idempotency_key,
                        existing_task_id,
                    )
                    return self._tasks[existing_task_id].model_copy(), False

            # Check direct task_id collision
            if request.task_id in self._tasks:
                logger.info(
                    "[REGISTRY] Task ID %r already registered in registry",
                    request.task_id,
                )
                return self._tasks[request.task_id].model_copy(), False

            # Capacity bounding: prune oldest terminal tasks if registry exceeds capacity
            if len(self._tasks) >= self._max_tasks:
                terminal_statuses = {
                    TaskExecutionStatus.COMPLETED,
                    TaskExecutionStatus.FAILED,
                    TaskExecutionStatus.CANCELLED,
                    TaskExecutionStatus.REJECTED,
                    TaskExecutionStatus.UNSUPPORTED,
                }
                to_prune = [
                    tid for tid, t in self._tasks.items()
                    if t.status in terminal_statuses
                ]
                for tid in to_prune[: len(to_prune) // 2 + 1]:
                    self._tasks.pop(tid, None)
                    self._idempotency_map = {
                        k: v for k, v in self._idempotency_map.items() if v != tid
                    }

            # New task registration
            initial_status = ExecutionStatusResponse(
                task_id=request.task_id,
                job_id=request.job_id,
                operation=request.operation,
                status=TaskExecutionStatus.QUEUED,
                submitted_at=request.submitted_at,
                runner_mode=RunnerMode.WORKER_SERVICE,
                correlation_id=request.correlation_id,
            )

            self._tasks[request.task_id] = initial_status
            self._idempotency_map[request.idempotency_key] = request.task_id
            return initial_status.model_copy(), True

    def get_task(self, task_id: str) -> Optional[ExecutionStatusResponse]:
        """Retrieves task status if present in the registry."""
        with self._lock:
            task = self._tasks.get(task_id)
            return task.model_copy() if task else None

    def update_task_status(
        self,
        task_id: str,
        status: TaskExecutionStatus,
        started_at: Optional[str] = None,
        completed_at: Optional[str] = None,
        result: Optional[ExecutionResult] = None,
        error: Optional[ExecutionError] = None,
    ) -> Optional[ExecutionStatusResponse]:
        """Updates the status and results of a registered task."""
        with self._lock:
            if task_id not in self._tasks:
                return None
            current = self._tasks[task_id]
            # Cancelled tasks must never be overwritten by background lifecycle threads
            if current.status == TaskExecutionStatus.CANCELLED:
                return current.model_copy()
            updated = ExecutionStatusResponse(
                task_id=current.task_id,
                job_id=current.job_id,
                operation=current.operation,
                status=status,
                submitted_at=current.submitted_at,
                started_at=started_at or current.started_at,
                completed_at=completed_at or current.completed_at,
                result=result or current.result,
                error=error or current.error,
                runner_mode=current.runner_mode,
                correlation_id=current.correlation_id,
            )
            self._tasks[task_id] = updated
            return updated.model_copy()

    def set_process(self, task_id: str, process: subprocess.Popen[str]) -> None:
        """Associates an active process with a task ID."""
        with self._lock:
            self._processes[task_id] = process

    def remove_process(self, task_id: str) -> Optional[subprocess.Popen[str]]:
        """Disassociates and returns the active process for a task ID."""
        with self._lock:
            return self._processes.pop(task_id, None)

    def set_workspace(self, task_id: str, workspace: Path) -> None:
        """Stores workspace path reference for cleanup."""
        with self._lock:
            self._workspaces[task_id] = workspace

    def get_workspace(self, task_id: str) -> Optional[Path]:
        """Gets workspace path for a task."""
        with self._lock:
            return self._workspaces.get(task_id)

    def cancel_task(self, task_id: str) -> Optional[ExecutionStatusResponse]:
        """Terminates any active process and marks the task as CANCELLED."""
        with self._lock:
            if task_id not in self._tasks:
                return None

            current = self._tasks[task_id]
            if current.status in (
                TaskExecutionStatus.COMPLETED,
                TaskExecutionStatus.FAILED,
                TaskExecutionStatus.REJECTED,
                TaskExecutionStatus.UNSUPPORTED,
                TaskExecutionStatus.CANCELLED,
            ):
                return current.model_copy()

            proc = self._processes.pop(task_id, None)
            if proc:
                _kill_process_tree(proc)

            cancelled = ExecutionStatusResponse(
                task_id=current.task_id,
                job_id=current.job_id,
                operation=current.operation,
                status=TaskExecutionStatus.CANCELLED,
                submitted_at=current.submitted_at,
                started_at=current.started_at,
                completed_at=datetime.now(timezone.utc).isoformat(),
                result=ExecutionResult(
                    passed=False,
                    final_state="CANCELLED",
                    exit_code=130,
                    message="Task cancelled by operator request.",
                    duration_seconds=0.0,
                ),
                runner_mode=current.runner_mode,
                correlation_id=current.correlation_id,
            )
            self._tasks[task_id] = cancelled
            return cancelled.model_copy()

    def list_tasks(self) -> List[ExecutionStatusResponse]:
        """Returns snapshot of all tracked tasks."""
        with self._lock:
            return [t.model_copy() for t in self._tasks.values()]

    def count_active(self) -> int:
        """Returns number of queued or currently executing tasks."""
        with self._lock:
            return sum(
                1
                for t in self._tasks.values()
                if t.status in (TaskExecutionStatus.QUEUED, TaskExecutionStatus.RUNNING)
            )


# =========================================================================== #
# Webhook Dispatcher with HMAC-SHA256 Signing
# =========================================================================== #
class WebhookDispatcher:
    """Delivers asynchronous status events to orchestrators with HMAC signatures."""

    def __init__(self, secret: Optional[str] = None) -> None:
        self.secret = secret

    def sign_payload(self, payload_bytes: bytes, secret: str) -> str:
        """Calculates HMAC-SHA256 digest string."""
        return hmac.new(
            key=secret.encode("utf-8"),
            msg=payload_bytes,
            digestmod=hashlib.sha256,
        ).hexdigest()

    def verify_signature(self, payload_bytes: bytes, signature: str, secret: str) -> bool:
        """Constant-time signature verification with support for 'sha256=' prefix."""
        sig = signature.strip()
        if sig.lower().startswith("sha256="):
            sig = sig[7:]
        expected = self.sign_payload(payload_bytes, secret)
        return hmac.compare_digest(sig.lower(), expected.lower())

    def dispatch(
        self,
        event: StatusWebhookEvent,
        target_url: str,
        secret: Optional[str] = None,
        max_retries: int = WEBHOOK_MAX_RETRIES,
    ) -> bool:
        """Dispatches signed webhook event with exponential backoff retry.

        Secrets are never leaked in log output.
        """
        effective_secret = secret or self.secret
        payload_data = event.model_dump()
        payload_bytes = json.dumps(payload_data).encode("utf-8")

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "OmniSight-Worker-Webhook/1.0",
            "X-Correlation-ID": event.job_id,
            "X-Timestamp": event.timestamp,
        }

        if effective_secret:
            sig = self.sign_payload(payload_bytes, effective_secret)
            headers["X-OmniSight-Signature"] = f"sha256={sig}"

        for attempt in range(max_retries):
            try:
                req = urllib.request.Request(
                    url=target_url,
                    data=payload_bytes,
                    headers=headers,
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=10.0) as resp:
                    if resp.status in (200, 201, 202, 204):
                        logger.info(
                            "[WEBHOOK] Event %s (type=%s, task=%s) successfully delivered to %s",
                            event.event_id,
                            event.event_type,
                            event.task_id,
                            target_url,
                        )
                        return True
            except Exception as exc:
                logger.warning(
                    "[WEBHOOK] Attempt %d/%d failed to deliver webhook %s to %s: %s",
                    attempt + 1,
                    max_retries,
                    event.event_id,
                    target_url,
                    exc,
                )
                if attempt < max_retries - 1:
                    time.sleep(0.5 * (2 ** attempt))

        logger.error(
            "[WEBHOOK] Permanent failure delivering webhook event %s to %s",
            event.event_id,
            target_url,
        )
        return False


# =========================================================================== #
# Worker Task Executor
# =========================================================================== #
class TaskExecutor:
    """Executes validated tasks within isolated workspaces."""

    def __init__(
        self,
        registry: WorkerTaskRegistry,
        workspace_mgr: WorkspaceManager,
        webhook_dispatcher: WebhookDispatcher,
        repo_root: Optional[Path] = None,
        command_override: Optional[Sequence[str]] = None,
        approval_verifier: Optional[ApprovalVerifier] = None,
    ) -> None:
        self.registry = registry
        self.workspace_mgr = workspace_mgr
        self.webhook_dispatcher = webhook_dispatcher
        self.repo_root = Path(repo_root).resolve() if repo_root else Path.cwd().resolve()
        self.command_override = list(command_override) if command_override else None
        self.approval_verifier = approval_verifier

    def sanitize_environment(
        self, extra_env: Optional[Dict[str, str]] = None
    ) -> Dict[str, str]:
        """Filters environment variables down to allowlisted safe variables."""
        clean_env: Dict[str, str] = {}
        for key, val in os.environ.items():
            if key in DANGEROUS_WORKER_ENV_KEYS:
                continue
            if any(term in key.upper() for term in ("TOKEN", "SECRET", "PRIVATE_KEY")):
                continue
            if key in SAFE_WORKER_ENV_KEYS:
                clean_env[key] = val

        if "PATH" not in clean_env:
            clean_env["PATH"] = os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")

        if extra_env:
            for k, v in extra_env.items():
                if k not in DANGEROUS_WORKER_ENV_KEYS and not any(
                    term in k.upper() for term in ("TOKEN", "SECRET")
                ):
                    clean_env[k] = str(v)

        return clean_env

    def _build_command(self, request: ExecutionTaskRequest) -> List[str]:
        """Translates an ExecutionTaskRequest into a strictly pre-defined command list."""
        if self.command_override:
            return list(self.command_override)

        npm_bin = _resolve_executable("npm")

        if request.operation == TaskOperationType.CAPTURE_EVIDENCE:
            return [npm_bin, "run", "capture:evidence"]

        if request.operation == TaskOperationType.EXECUTE_REPAIR:
            if not request.proposal_ref:
                raise ValueError("Operation EXECUTE_REPAIR requires approved proposal_ref.")

            cmd = [npm_bin, "run", "repair:execute", "--"]
            source_file = request.proposal_ref.source_file
            if source_file.startswith(("/", "\\")) or ".." in source_file:
                raise ValueError(f"Unsafe source file path: {source_file!r}")

            cmd.append(f"--proposal={source_file}")
            cmd.append(f"--job-id={request.job_id}")

            if request.proposal_ref.patch_id:
                cmd.append(f"--patch={request.proposal_ref.patch_id}")

            if request.worktree_ref and request.worktree_ref.base_commit:
                cmd.append(f"--base-commit={request.worktree_ref.base_commit}")

            return cmd

        if request.operation == TaskOperationType.VERIFY_REPAIR:
            return [npm_bin, "test"]

        raise ValueError(f"Unsupported operation type: {request.operation}")

    def execute_async(self, request: ExecutionTaskRequest) -> None:
        """Launches task execution in a background daemon thread."""
        thread = threading.Thread(
            target=self._run_task_lifecycle,
            args=(request,),
            daemon=True,
            name=f"WorkerExecutor-{request.task_id}",
        )
        thread.start()

    def _run_task_lifecycle(self, request: ExecutionTaskRequest) -> None:
        """Orchestrates complete task lifecycle: prepare, execute, collect, notify, clean."""
        # Check if task was cancelled before lifecycle thread started
        current = self.registry.get_task(request.task_id)
        if current and current.status == TaskExecutionStatus.CANCELLED:
            logger.info("[WORKER] Task %s was cancelled before execution started", request.task_id)
            return

        started_at = datetime.now(timezone.utc).isoformat()
        start_time = time.monotonic()

        # Update state to RUNNING
        updated_status = self.registry.update_task_status(
            task_id=request.task_id,
            status=TaskExecutionStatus.RUNNING,
            started_at=started_at,
        )
        if updated_status and updated_status.status == TaskExecutionStatus.CANCELLED:
            logger.info("[WORKER] Task %s was cancelled during start transition", request.task_id)
            return

        # Notify webhook: task.started if webhook configured
        webhook_url = request.parameters.get("webhook_url") or os.environ.get("OMNISIGHT_WEBHOOK_URL")
        if webhook_url:
            start_event = StatusWebhookEvent(
                event_id=f"evt-{request.task_id}-start",
                task_id=request.task_id,
                job_id=request.job_id,
                event_type="task.started",
                status=TaskExecutionStatus.RUNNING,
                timestamp=started_at,
            )
            threading.Thread(
                target=self.webhook_dispatcher.dispatch,
                args=(start_event, webhook_url),
                daemon=True,
            ).start()

        workspace = self.workspace_mgr.create_workspace(request.task_id)
        self.registry.set_workspace(request.task_id, workspace)

        try:
            if request.operation == TaskOperationType.EXECUTE_REPAIR and self.approval_verifier:
                is_valid, reason = self.approval_verifier.verify(request.proposal_ref)
                if not is_valid:
                    raise ValueError(f"TaskExecutor rejected unapproved repair: {reason}")

            command = self._build_command(request)
            sanitized_env = self.sanitize_environment({
                "OMNISIGHT_WORKSPACE": str(workspace),
                "TMPDIR": str(workspace),
                "TASK_ID": request.task_id,
            })

            popen_kwargs: Dict[str, Any] = {
                "cwd": str(self.repo_root),
                "env": sanitized_env,
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "text": True,
                "encoding": "utf-8",
                "errors": "replace",
            }

            if sys.platform == "win32":
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
            else:
                popen_kwargs["start_new_session"] = True

            process = subprocess.Popen(command, **popen_kwargs)  # noqa: S603
            self.registry.set_process(request.task_id, process)

            timed_out = False
            stdout, stderr = "", ""
            try:
                stdout, stderr = process.communicate(timeout=request.timeout_seconds)
                exit_code = process.returncode
            except subprocess.TimeoutExpired:
                timed_out = True
                _kill_process_tree(process)
                stdout, stderr = process.communicate()
                exit_code = -1

            duration = time.monotonic() - start_time
            completed_at = datetime.now(timezone.utc).isoformat()
            self.registry.remove_process(request.task_id)

            # Check if task was cancelled while running
            current = self.registry.get_task(request.task_id)
            if current and current.status == TaskExecutionStatus.CANCELLED:
                logger.info("[WORKER] Task %s was cancelled during execution", request.task_id)
                return

            if timed_out:
                final_status = TaskExecutionStatus.FAILED
                error_payload = ExecutionError(
                    code="timeout",
                    message=f"Task timed out after {request.timeout_seconds:.1f} seconds.",
                    retryable=False,
                )
                result_payload = ExecutionResult(
                    passed=False,
                    final_state="FAILED",
                    exit_code=124,
                    message=f"Process exceeded timeout limit ({request.timeout_seconds}s).",
                    duration_seconds=duration,
                    stdout_tail=stdout[-2000:] if stdout else None,
                    stderr_tail=stderr[-2000:] if stderr else None,
                )
            else:
                passed = exit_code == 0
                final_status = TaskExecutionStatus.COMPLETED if passed else TaskExecutionStatus.FAILED
                final_state = "PASSED" if passed else "FAILED"

                # Check for explicit CLI JSON summary
                cli_summary = self._parse_cli_json(stdout)
                if cli_summary and "finalState" in cli_summary:
                    parsed_state = str(cli_summary.get("finalState"))
                    if parsed_state == "PASSED":
                        final_status = TaskExecutionStatus.COMPLETED
                        passed = True
                        final_state = "PASSED"
                    elif parsed_state == "REJECTED":
                        final_status = TaskExecutionStatus.REJECTED
                        passed = False
                        final_state = "REJECTED"
                    elif parsed_state == "UNSUPPORTED":
                        final_status = TaskExecutionStatus.UNSUPPORTED
                        passed = False
                        final_state = "UNSUPPORTED"
                    else:
                        final_status = TaskExecutionStatus.FAILED
                        passed = False
                        final_state = "FAILED"

                artifacts = self._discover_artifacts(request)

                result_payload = ExecutionResult(
                    passed=passed,
                    final_state=final_state,
                    exit_code=exit_code if exit_code is not None else 1,
                    message=f"Execution finished with exit code {exit_code} (state: {final_state}).",
                    artifacts=artifacts,
                    duration_seconds=duration,
                    stdout_tail=stdout[-2000:] if stdout else None,
                    stderr_tail=stderr[-2000:] if stderr else None,
                )
                error_payload = None if passed else ExecutionError(
                    code=f"exit_code_{exit_code}",
                    message=stderr[-500:] if stderr else f"Process failed with exit code {exit_code}",
                )

            # Update registry
            self.registry.update_task_status(
                task_id=request.task_id,
                status=final_status,
                completed_at=completed_at,
                result=result_payload,
                error=error_payload,
            )

            # Notify webhook: task.completed or task.failed
            if webhook_url:
                completed_event = StatusWebhookEvent(
                    event_id=f"evt-{request.task_id}-done",
                    task_id=request.task_id,
                    job_id=request.job_id,
                    event_type=f"task.{final_status.value}",
                    status=final_status,
                    timestamp=completed_at,
                    result=result_payload,
                    error=error_payload,
                )
                threading.Thread(
                    target=self.webhook_dispatcher.dispatch,
                    args=(completed_event, webhook_url),
                    daemon=True,
                ).start()

        except Exception as exc:
            duration = time.monotonic() - start_time
            logger.exception("[WORKER] Unhandled exception in task %s: %s", request.task_id, exc)
            self.registry.remove_process(request.task_id)
            self.registry.update_task_status(
                task_id=request.task_id,
                status=TaskExecutionStatus.FAILED,
                completed_at=datetime.now(timezone.utc).isoformat(),
                error=ExecutionError(code="internal_worker_error", message=str(exc)),
                result=ExecutionResult(
                    passed=False,
                    final_state="FAILED",
                    exit_code=1,
                    message=f"Execution failed due to internal error: {exc}",
                    duration_seconds=duration,
                ),
            )
        finally:
            self.workspace_mgr.cleanup_workspace(request.task_id)

    def _parse_cli_json(self, stdout: str) -> Optional[Dict[str, Any]]:
        """Finds any JSON dictionary in stdout containing 'finalState'."""
        if not stdout:
            return None
        decoder = json.JSONDecoder()
        brace_positions = [i for i, ch in enumerate(stdout) if ch == "{"]
        for idx in reversed(brace_positions):
            try:
                data, _ = decoder.raw_decode(stdout[idx:])
                if isinstance(data, dict) and "finalState" in data:
                    return data
            except ValueError:
                continue
        return None

    def _discover_artifacts(self, request: ExecutionTaskRequest) -> List[ArtifactItem]:
        """Discovers artifacts generated by the task execution."""
        artifacts: List[ArtifactItem] = []
        if request.operation == TaskOperationType.CAPTURE_EVIDENCE:
            evidence_dir = self.repo_root / "artifacts" / "visual-evidence"
            if evidence_dir.exists():
                for item in evidence_dir.glob("*/*"):
                    if item.is_file():
                        rel = str(item.relative_to(self.repo_root))
                        artifacts.append(
                            ArtifactItem(
                                artifact_id=f"art-{len(artifacts)+1}",
                                kind="screenshot" if item.suffix in (".png", ".jpg") else "dom_snapshot",
                                relative_uri=rel,
                                description=f"Captured evidence: {item.name}",
                                size_bytes=item.stat().st_size,
                            )
                        )
        elif request.operation == TaskOperationType.EXECUTE_REPAIR:
            rep_file = (
                self.repo_root
                / "artifacts"
                / "repair-executions"
                / request.job_id
                / "repair_execution_report.json"
            )
            if rep_file.exists():
                rel = str(rep_file.relative_to(self.repo_root))
                artifacts.append(
                    ArtifactItem(
                        artifact_id=f"art-rep-{request.job_id}",
                        kind="report",
                        relative_uri=rel,
                        description="Repair execution detailed JSON report",
                        size_bytes=rep_file.stat().st_size,
                    )
                )
        return artifacts


# =========================================================================== #
# FastAPI Worker Application Factory
# =========================================================================== #
bearer_security = HTTPBearer(auto_error=False)


def create_worker_app(
    auth_token: Optional[str] = None,
    webhook_secret: Optional[str] = None,
    repo_root: Optional[Path] = None,
    command_override: Optional[Sequence[str]] = None,
    enforce_seccomp: bool = False,
    approval_verifier: Optional[ApprovalVerifier] = None,
) -> FastAPI:
    """Creates the OmniSight Isolated Execution Worker FastAPI application."""
    effective_token = auth_token or os.environ.get("OMNISIGHT_WORKER_AUTH_TOKEN")
    effective_secret = webhook_secret or os.environ.get("OMNISIGHT_WEBHOOK_SECRET")
    effective_verifier = approval_verifier or ApprovalVerifier.from_env()

    registry = WorkerTaskRegistry()
    workspace_mgr = WorkspaceManager()
    webhook_dispatcher = WebhookDispatcher(secret=effective_secret)
    executor = TaskExecutor(
        registry=registry,
        workspace_mgr=workspace_mgr,
        webhook_dispatcher=webhook_dispatcher,
        repo_root=repo_root,
        command_override=command_override,
        approval_verifier=effective_verifier,
    )

    @asynccontextmanager
    async def worker_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        logger.info("[WORKER-LIFESPAN] Starting OmniSight Execution Worker Service...")
        app.state.registry = registry
        app.state.workspace_mgr = workspace_mgr
        app.state.executor = executor
        app.state.webhook_dispatcher = webhook_dispatcher
        app.state.approval_verifier = effective_verifier
        app.state.start_time = time.time()

        # Optional Linux Seccomp Sandbox Initialization
        if enforce_seccomp and sys.platform.startswith("linux"):
            try:
                from security_sandbox import initialize_worker_security_sandbox

                res = initialize_worker_security_sandbox(enforce=True)
                logger.info("[WORKER-LIFESPAN] Worker seccomp sandbox active: %s", res)
            except Exception as exc:
                logger.critical("[WORKER-LIFESPAN] Fatal seccomp initialization failure: %s", exc)
                raise

        yield

        logger.info("[WORKER-LIFESPAN] Shutting down OmniSight Execution Worker Service.")

    app = FastAPI(
        title="OmniSight Isolated Execution Worker Service",
        version="1.0.0",
        description="Dedicated execution worker service providing isolated task processing.",
        lifespan=worker_lifespan,
    )

    MAX_REQUEST_BODY_SIZE = 2 * 1024 * 1024  # 2MB maximum payload size

    @app.middleware("http")
    async def limit_request_size(request: Request, call_next: Any) -> Any:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > MAX_REQUEST_BODY_SIZE:
                    return JSONResponse(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        content={"detail": "Request payload exceeds maximum allowed size (2MB)."},
                    )
            except ValueError:
                pass
        return await call_next(request)

    # ----------------------------------------------------------------------- #
    # Authentication Dependency
    # ----------------------------------------------------------------------- #
    def verify_auth(
        credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_security),
    ) -> None:
        """Enforces Bearer token authentication when OMNISIGHT_WORKER_AUTH_TOKEN is configured."""
        if not effective_token:
            return  # No authentication required if token not configured

        if not credentials or not credentials.credentials:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing Authorization: Bearer <token> header.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Constant-time comparison to prevent timing attacks
        if not hmac.compare_digest(credentials.credentials, effective_token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid worker authentication token.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # ----------------------------------------------------------------------- #
    # Endpoints
    # ----------------------------------------------------------------------- #
    @app.get("/health", tags=["Diagnostic"])
    def health_check() -> Dict[str, Any]:
        """Reports worker service operational health, capabilities, and active tasks."""
        uptime = time.time() - getattr(app.state, "start_time", time.time())
        npm_available = shutil.which("npm") is not None
        node_available = shutil.which("node") is not None

        return {
            "status": "healthy" if npm_available else "degraded",
            "service": "omnisight-execution-worker",
            "version": "1.0.0",
            "mode": RunnerMode.WORKER_SERVICE.value,
            "deployed": True,
            "available": True,
            "uptime_seconds": round(uptime, 2),
            "active_tasks": registry.count_active(),
            "capabilities": {
                "operations": [op.value for op in TaskOperationType],
                "npm_available": npm_available,
                "node_available": node_available,
                "auth_required": bool(effective_token),
                "webhook_configured": bool(effective_secret),
                "platform": sys.platform,
            },
        }

    @app.post(
        "/api/v1/tasks",
        status_code=status.HTTP_201_CREATED,
        response_model=ExecutionTaskResponse,
        tags=["Execution Tasks"],
    )
    def submit_task(
        request: ExecutionTaskRequest,
        x_correlation_id: Optional[str] = Header(None),
        x_idempotency_key: Optional[str] = Header(None),
        _: None = Depends(verify_auth),
    ) -> ExecutionTaskResponse:
        """Submits an execution task for asynchronous processing.

        Strictly enforces:
        1. Human approval for repair operations (`EXECUTE_REPAIR`).
        2. Cryptographic proposal pinning and source path validation.
        3. Idempotent deduplication via idempotency keys.
        """
        # Enforce repair safety invariants
        if request.operation == TaskOperationType.EXECUTE_REPAIR:
            if not request.proposal_ref:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="EXECUTE_REPAIR operation strictly requires an approved proposal_ref.",
                )
            if not request.proposal_ref.reviewed_by or not request.proposal_ref.reviewed_at:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Human approval verification failed: reviewed_by and reviewed_at must be populated.",
                )

            # Cryptographic Human Approval Verification Gate
            is_valid, reason = effective_verifier.verify(request.proposal_ref)
            if not is_valid:
                logger.warning(
                    "[APPROVAL-GATE] Cryptographic approval verification rejected for task %s: %s",
                    request.task_id,
                    reason,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cryptographic human approval verification failed: {reason}",
                )

        # Correlation ID & Idempotency propagation
        corr_id = x_correlation_id or request.correlation_id
        idem_key = x_idempotency_key or request.idempotency_key
        request_copy = request.model_copy(
            update={"correlation_id": corr_id, "idempotency_key": idem_key}
        )

        task_status, is_new = registry.register_task(request_copy)

        if is_new:
            logger.info(
                "[WORKER-API] Received new task %s (operation=%s, job=%s, corr=%s)",
                request_copy.task_id,
                request_copy.operation.value,
                request_copy.job_id,
                corr_id,
            )
            executor.execute_async(request_copy)

        return ExecutionTaskResponse(
            schema_version="1.0.0",
            task_id=task_status.task_id,
            job_id=task_status.job_id,
            operation=task_status.operation,
            status=task_status.status,
            submitted_at=task_status.submitted_at,
            runner_mode=RunnerMode.WORKER_SERVICE,
            correlation_id=corr_id,
            message="Task accepted and queued for execution." if is_new else "Existing task returned via idempotency key.",
        )

    @app.get(
        "/api/v1/tasks/{task_id}",
        response_model=ExecutionStatusResponse,
        tags=["Execution Tasks"],
    )
    def get_task_status(
        task_id: str,
        _: None = Depends(verify_auth),
    ) -> ExecutionStatusResponse:
        """Retrieves current execution state and results for a task."""
        status_entry = registry.get_task(task_id)
        if not status_entry:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Task {task_id!r} not found in worker registry.",
            )
        return status_entry

    @app.post(
        "/api/v1/tasks/{task_id}/cancel",
        response_model=ExecutionStatusResponse,
        tags=["Execution Tasks"],
    )
    def cancel_task(
        task_id: str,
        _: None = Depends(verify_auth),
    ) -> ExecutionStatusResponse:
        """Aborts an active task and terminates its underlying process tree."""
        status_entry = registry.cancel_task(task_id)
        if not status_entry:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Task {task_id!r} not found in worker registry.",
            )
        return status_entry

    @app.get(
        "/api/v1/tasks",
        response_model=List[ExecutionStatusResponse],
        tags=["Execution Tasks"],
    )
    def list_all_tasks(
        _: None = Depends(verify_auth),
    ) -> List[ExecutionStatusResponse]:
        """Lists all tasks tracked by this worker instance."""
        return registry.list_tasks()

    return app


# Default application instance for Uvicorn
app = create_worker_app()

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("OMNISIGHT_WORKER_HOST", "0.0.0.0")
    port = int(os.environ.get("OMNISIGHT_WORKER_PORT", str(DEFAULT_WORKER_PORT)))
    uvicorn.run("worker_service:app", host=host, port=port, reload=False)
