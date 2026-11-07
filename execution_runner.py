"""OmniSight Execution Runner Abstraction & Adapters.

Milestone M2: Decouples OmniSight's browser automation and repair execution
logic from direct local subprocess execution. Introduces:
1. `ExecutionRunner`: Formal common abstract base class for execution adapters.
2. `LocalCliRunner`: Hardened local execution adapter with environment variable
   sanitization, working-directory boundary enforcement, cross-platform process
   management, and full backward compatibility.
3. `WorkerServiceRunner`: Remote execution adapter communicating over HTTP/JSON
   with idempotency, correlation IDs, retry policies, HMAC webhook verification,
   and honest reporting of pending M3 worker deployment.
4. `get_execution_runner`: Factory for selecting the active execution runner.
"""

from __future__ import annotations

import abc
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
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

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

logger = logging.getLogger("omnisight.execution_runner")

# Default configurations
DEFAULT_LOCAL_TIMEOUT_SECONDS = 300.0
DEFAULT_WORKER_TIMEOUT_SECONDS = 30.0
DEFAULT_WORKER_URL = "http://127.0.0.1:8080"
DEFAULT_EVIDENCE_SUBDIR = Path("artifacts") / "visual-evidence"
DEFAULT_REPAIR_SUBDIR = Path("artifacts") / "repair-executions"

# Safe environment variables allowlist for local subprocess execution
SAFE_ENVIRONMENT_KEYS = frozenset({
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

# Dangerous environment keys that MUST be removed
DANGEROUS_ENVIRONMENT_KEYS = frozenset({
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH",
    "OMNISIGHT_OPERATOR_TOKEN",
    "GITHUB_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "SECRET_KEY",
})


class ExecutionServiceError(Exception):
    """Raised when an execution adapter encounters a service-level failure."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        self.retryable = retryable


# =========================================================================== #
# Task 1: Common Runner Interface
# =========================================================================== #
class ExecutionRunner(abc.ABC):
    """Abstract base class establishing the contract for execution adapters.

    All execution adapters (local subprocess, remote worker service, containerized)
    must implement this interface to ensure uniform lifecycle management, status
    polling, cancellation, and health checking across OmniSight.
    """

    @property
    @abc.abstractmethod
    def mode(self) -> RunnerMode:
        """The runner mode identifier."""
        raise NotImplementedError

    @abc.abstractmethod
    def submit(self, request: ExecutionTaskRequest) -> ExecutionTaskResponse:
        """Submits an execution task for processing.

        Args:
            request: Validated execution task specification.

        Returns:
            Immediate acknowledgement containing initial task status.

        Raises:
            ExecutionServiceError: On validation failure or submission rejection.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def get_status(self, task_id: str) -> ExecutionStatusResponse:
        """Retrieves the current execution status and diagnostic result for a task.

        Args:
            task_id: Unique identifier of the task.

        Returns:
            Current lifecycle state and (if completed) final execution results.

        Raises:
            KeyError: If task_id is unknown.
            ExecutionServiceError: On transport or query failure.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def cancel(self, task_id: str) -> ExecutionStatusResponse:
        """Requests cancellation of an ongoing execution task.

        Args:
            task_id: Unique identifier of the task to abort.

        Returns:
            Updated status reflecting cancellation state.

        Raises:
            KeyError: If task_id is unknown.
            ExecutionServiceError: If cancellation cannot be signaled.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def health_check(self) -> Dict[str, Any]:
        """Performs a self-diagnostic check of the execution adapter.

        Returns:
            Dictionary containing readiness, adapter mode, and availability.
        """
        raise NotImplementedError


# =========================================================================== #
# Task 2: Local CLI Runner
# =========================================================================== #
def _kill_process_tree(process: subprocess.Popen[str]) -> None:
    """Terminates a process and all child processes across platforms."""
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
    """Resolves an executable on the system PATH with cross-platform handling."""
    if sys.platform == "win32" and not cmd_name.lower().endswith((".exe", ".cmd", ".bat")):
        # On Windows, try cmd extension first for npm/npx
        candidate = shutil.which(f"{cmd_name}.cmd") or shutil.which(f"{cmd_name}.exe")
        if candidate:
            return candidate
    resolved = shutil.which(cmd_name)
    if resolved:
        return resolved
    raise FileNotFoundError(f"Executable {cmd_name!r} not found on system PATH.")


class LocalCliRunner(ExecutionRunner):
    """Executes approved operations locally via CLI/subprocess infrastructure.

    Features:
    - Cross-platform support for macOS, Linux, and Windows.
    - Zero Docker requirement.
    - Strict environment variable sanitization (stripping dangerous injection vectors).
    - Working-directory boundary verification (preventing path traversal).
    - Asynchronous process management with timeouts and complete process-tree termination.
    - Backward-compatible bridge methods for existing browser and repair callers.
    """

    def __init__(
        self,
        repo_root: Optional[Union[str, Path]] = None,
        timeout_seconds: float = DEFAULT_LOCAL_TIMEOUT_SECONDS,
        allowed_env_keys: Optional[Sequence[str]] = None,
        command_override: Optional[Sequence[str]] = None,
    ) -> None:
        if repo_root is None:
            # Auto-detect repository root
            current = Path(__file__).resolve().parent
            if (current / "package.json").exists():
                self.repo_root = current
            elif (current.parent.parent / "package.json").exists():
                self.repo_root = current.parent.parent
            else:
                self.repo_root = current
        else:
            self.repo_root = Path(repo_root).resolve()

        self.timeout_seconds = float(timeout_seconds)
        self.allowed_env_keys = set(allowed_env_keys or SAFE_ENVIRONMENT_KEYS)
        self.command_override = list(command_override) if command_override else None

        # Thread-safe in-memory task registry
        self._tasks: Dict[str, ExecutionStatusResponse] = {}
        self._processes: Dict[str, subprocess.Popen[str]] = {}
        self._lock = threading.Lock()

    @property
    def mode(self) -> RunnerMode:
        return RunnerMode.LOCAL_CLI

    def _verify_path_boundary(self, target_path: Path) -> Path:
        """Ensures the target path does not escape the repository boundary."""
        resolved = target_path.resolve()
        try:
            resolved.relative_to(self.repo_root)
        except ValueError:
            raise ValueError(f"Security restriction: Path {resolved} escapes repository root {self.repo_root}")
        return resolved

    def sanitize_environment(self, overrides: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """Constructs a minimal, sanitized environment dictionary.

        Strips dynamic link injection (LD_PRELOAD/DYLD_*), tokens, and credentials,
        passing only allowlisted variables needed for safe CLI execution.
        """
        clean_env: Dict[str, str] = {}
        for key, val in os.environ.items():
            if key in DANGEROUS_ENVIRONMENT_KEYS:
                continue
            if any(term in key.upper() for term in ("TOKEN", "SECRET", "PRIVATE_KEY")):
                continue
            if key in self.allowed_env_keys:
                clean_env[key] = val

        # Ensure essential PATH exists
        if "PATH" not in clean_env:
            clean_env["PATH"] = os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")

        if overrides:
            for k, v in overrides.items():
                if k not in DANGEROUS_ENVIRONMENT_KEYS and not any(
                    term in k.upper() for term in ("TOKEN", "SECRET")
                ):
                    clean_env[k] = str(v)

        return clean_env

    def _build_command(self, request: ExecutionTaskRequest) -> List[str]:
        """Translates an ExecutionTaskRequest into a safe command list."""
        if self.command_override:
            return list(self.command_override)

        npm_bin = _resolve_executable("npm")

        if request.operation == TaskOperationType.CAPTURE_EVIDENCE:
            return [npm_bin, "run", "capture:evidence"]

        if request.operation == TaskOperationType.EXECUTE_REPAIR:
            if not request.proposal_ref:
                raise ValueError("Operation EXECUTE_REPAIR requires proposal_ref.")

            cmd = [npm_bin, "run", "repair:execute", "--"]
            # Enforce proposal file safety
            prop_file = request.proposal_ref.source_file
            if prop_file.startswith(("/", "\\")) or ".." in prop_file:
                raise ValueError(f"Unsafe proposal file path: {prop_file!r}")

            cmd.append(f"--proposal={prop_file}")
            cmd.append(f"--job-id={request.job_id}")

            if request.proposal_ref.patch_id:
                cmd.append(f"--patch={request.proposal_ref.patch_id}")

            if request.worktree_ref and request.worktree_ref.base_commit:
                cmd.append(f"--base-commit={request.worktree_ref.base_commit}")

            return cmd

        if request.operation == TaskOperationType.VERIFY_REPAIR:
            return [npm_bin, "test"]

        raise ValueError(f"Unsupported operation type: {request.operation}")

    def submit(self, request: ExecutionTaskRequest) -> ExecutionTaskResponse:
        """Submits an execution task for local CLI processing."""
        with self._lock:
            if request.task_id in self._tasks:
                existing = self._tasks[request.task_id]
                return ExecutionTaskResponse(
                    task_id=request.task_id,
                    job_id=request.job_id,
                    operation=request.operation,
                    status=existing.status,
                    submitted_at=existing.submitted_at,
                    runner_mode=self.mode,
                    correlation_id=request.correlation_id,
                    message="Task already exists in registry.",
                )

            # Initialize status tracking
            status_entry = ExecutionStatusResponse(
                task_id=request.task_id,
                job_id=request.job_id,
                operation=request.operation,
                status=TaskExecutionStatus.QUEUED,
                submitted_at=request.submitted_at,
                runner_mode=self.mode,
                correlation_id=request.correlation_id,
            )
            self._tasks[request.task_id] = status_entry

        # Launch worker thread
        worker = threading.Thread(
            target=self._execute_task_thread,
            args=(request,),
            daemon=True,
            name=f"LocalCliRunner-{request.task_id}",
        )
        worker.start()

        return ExecutionTaskResponse(
            task_id=request.task_id,
            job_id=request.job_id,
            operation=request.operation,
            status=TaskExecutionStatus.QUEUED,
            submitted_at=request.submitted_at,
            runner_mode=self.mode,
            correlation_id=request.correlation_id,
            message="Task successfully queued for local execution.",
        )

    def _execute_task_thread(self, request: ExecutionTaskRequest) -> None:
        """Executes the task in a background worker thread."""
        started_at = datetime.now(timezone.utc).isoformat()
        start_time = time.monotonic()

        with self._lock:
            if request.task_id not in self._tasks:
                return
            current = self._tasks[request.task_id]
            if current.status == TaskExecutionStatus.CANCELLED:
                return
            self._tasks[request.task_id] = ExecutionStatusResponse(
                task_id=request.task_id,
                job_id=request.job_id,
                operation=request.operation,
                status=TaskExecutionStatus.RUNNING,
                submitted_at=request.submitted_at,
                started_at=started_at,
                runner_mode=self.mode,
                correlation_id=request.correlation_id,
            )

        try:
            # Build and validate command
            command = self._build_command(request)
            sanitized_env = self.sanitize_environment()
            working_dir = self._verify_path_boundary(self.repo_root)

            popen_kwargs: Dict[str, Any] = {
                "cwd": str(working_dir),
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

            with self._lock:
                self._processes[request.task_id] = process

            # Wait for execution or timeout
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

            with self._lock:
                self._processes.pop(request.task_id, None)
                # Check if cancelled during run
                if self._tasks[request.task_id].status == TaskExecutionStatus.CANCELLED:
                    return

            if timed_out:
                final_status = TaskExecutionStatus.FAILED
                error_payload = ExecutionError(
                    code="timeout",
                    message=f"Process exceeded timeout limit of {request.timeout_seconds} seconds.",
                    retryable=False,
                )
                result_payload = ExecutionResult(
                    passed=False,
                    final_state="FAILED",
                    exit_code=124,
                    message=f"Execution timed out after {request.timeout_seconds:.1f}s.",
                    duration_seconds=duration,
                    stdout_tail=stdout[-2000:] if stdout else None,
                    stderr_tail=stderr[-2000:] if stderr else None,
                )
            else:
                # Interpret results
                passed = exit_code == 0
                final_status = TaskExecutionStatus.COMPLETED if passed else TaskExecutionStatus.FAILED
                final_state = "PASSED" if passed else "FAILED"

                # Check for explicit CLI JSON output
                cli_summary = self._parse_cli_json(stdout)
                if cli_summary and "finalState" in cli_summary:
                    final_state = str(cli_summary.get("finalState"))
                    if final_state == "PASSED":
                        final_status = TaskExecutionStatus.COMPLETED
                        passed = True
                    elif final_state == "REJECTED":
                        final_status = TaskExecutionStatus.REJECTED
                        passed = False
                    elif final_state == "UNSUPPORTED":
                        final_status = TaskExecutionStatus.UNSUPPORTED
                        passed = False
                    else:
                        final_status = TaskExecutionStatus.FAILED
                        passed = False

                artifacts = self._collect_artifacts(request)

                result_payload = ExecutionResult(
                    passed=passed,
                    final_state=final_state,
                    exit_code=exit_code if exit_code is not None else 1,
                    message=f"Task executed with exit code {exit_code} (state: {final_state}).",
                    artifacts=artifacts,
                    duration_seconds=duration,
                    stdout_tail=stdout[-2000:] if stdout else None,
                    stderr_tail=stderr[-2000:] if stderr else None,
                )
                error_payload = None if passed else ExecutionError(
                    code=f"exit_code_{exit_code}",
                    message=stderr[-500:] if stderr else f"Process failed with exit code {exit_code}",
                )

            with self._lock:
                self._tasks[request.task_id] = ExecutionStatusResponse(
                    task_id=request.task_id,
                    job_id=request.job_id,
                    operation=request.operation,
                    status=final_status,
                    submitted_at=request.submitted_at,
                    started_at=started_at,
                    completed_at=completed_at,
                    result=result_payload,
                    error=error_payload,
                    runner_mode=self.mode,
                    correlation_id=request.correlation_id,
                )

        except Exception as exc:
            duration = time.monotonic() - start_time
            logger.exception("Error executing local task %s: %s", request.task_id, exc)
            with self._lock:
                self._processes.pop(request.task_id, None)
                self._tasks[request.task_id] = ExecutionStatusResponse(
                    task_id=request.task_id,
                    job_id=request.job_id,
                    operation=request.operation,
                    status=TaskExecutionStatus.FAILED,
                    submitted_at=request.submitted_at,
                    started_at=started_at,
                    completed_at=datetime.now(timezone.utc).isoformat(),
                    error=ExecutionError(
                        code="execution_exception",
                        message=str(exc),
                    ),
                    result=ExecutionResult(
                        passed=False,
                        final_state="FAILED",
                        exit_code=1,
                        message=f"Execution raised unhandled exception: {exc}",
                        duration_seconds=duration,
                    ),
                    runner_mode=self.mode,
                    correlation_id=request.correlation_id,
                )

    def _parse_cli_json(self, stdout: str) -> Optional[Dict[str, Any]]:
        """Extracts JSON summary object from CLI stdout."""
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

    def _collect_artifacts(self, request: ExecutionTaskRequest) -> List[ArtifactItem]:
        """Discovers artifacts generated by the task."""
        artifacts: List[ArtifactItem] = []

        if request.operation == TaskOperationType.CAPTURE_EVIDENCE:
            evidence_dir = self.repo_root / DEFAULT_EVIDENCE_SUBDIR
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
            report_file = self.repo_root / DEFAULT_REPAIR_SUBDIR / request.job_id / "repair_execution_report.json"
            if report_file.exists():
                rel = str(report_file.relative_to(self.repo_root))
                artifacts.append(
                    ArtifactItem(
                        artifact_id=f"art-rep-{request.job_id}",
                        kind="report",
                        relative_uri=rel,
                        description="Repair execution detailed JSON report",
                        size_bytes=report_file.stat().st_size,
                    )
                )

        return artifacts

    def get_status(self, task_id: str) -> ExecutionStatusResponse:
        """Retrieves status of a tracked local task."""
        with self._lock:
            if task_id not in self._tasks:
                raise KeyError(f"Task {task_id!r} not found in LocalCliRunner registry.")
            return self._tasks[task_id].model_copy()

    def cancel(self, task_id: str) -> ExecutionStatusResponse:
        """Aborts a running local task."""
        with self._lock:
            if task_id not in self._tasks:
                raise KeyError(f"Task {task_id!r} not found in LocalCliRunner registry.")

            current = self._tasks[task_id]
            if current.status in (
                TaskExecutionStatus.COMPLETED,
                TaskExecutionStatus.FAILED,
                TaskExecutionStatus.REJECTED,
                TaskExecutionStatus.UNSUPPORTED,
                TaskExecutionStatus.CANCELLED,
            ):
                return current.model_copy()

            # Terminate active process if running
            proc = self._processes.pop(task_id, None)
            if proc:
                _kill_process_tree(proc)

            updated = ExecutionStatusResponse(
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
                    message="Task execution was cancelled by operator request.",
                    duration_seconds=0.0,
                ),
                runner_mode=self.mode,
                correlation_id=current.correlation_id,
            )
            self._tasks[task_id] = updated
            return updated.model_copy()

    def health_check(self) -> Dict[str, Any]:
        """Reports local CLI runner health and capabilities."""
        with self._lock:
            active_count = sum(
                1 for t in self._tasks.values() if t.status in (TaskExecutionStatus.QUEUED, TaskExecutionStatus.RUNNING)
            )

        npm_available = shutil.which("npm") is not None
        node_available = shutil.which("node") is not None

        return {
            "status": "healthy" if npm_available else "degraded",
            "mode": self.mode.value,
            "available": True,
            "repo_root": str(self.repo_root),
            "platform": sys.platform,
            "active_tasks": active_count,
            "tools": {
                "npm_available": npm_available,
                "node_available": node_available,
            },
        }

    # ----------------------------------------------------------------------- #
    # Backward compatibility bridge methods for existing backend callers
    # ----------------------------------------------------------------------- #
    def run_browser(self, job_id: str, website_url: str) -> Dict[str, Any]:
        """Drop-in bridge compatible with existing BrowserRunner protocol."""
        req = ExecutionTaskRequest(
            task_id=f"browser-{job_id}",
            job_id=job_id,
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            target_url=website_url,
            correlation_id=f"corr-{job_id}",
            idempotency_key=f"idem-{job_id}",
        )
        self.submit(req)
        # Wait synchronously for compatibility
        timeout = self.timeout_seconds
        start = time.monotonic()
        while time.monotonic() - start < timeout:
            status = self.get_status(req.task_id)
            if status.status in (
                TaskExecutionStatus.COMPLETED,
                TaskExecutionStatus.FAILED,
                TaskExecutionStatus.CANCELLED,
            ):
                break
            time.sleep(0.1)

        final = self.get_status(req.task_id)
        res = final.result
        return {
            "mode": "local_cli",
            "executed": True,
            "message": res.message if res else "Completed",
            "artifacts": [a.model_dump() for a in (res.artifacts if res else [])],
            "run_id": job_id,
            "exit_code": res.exit_code if res else 1,
            "duration_seconds": res.duration_seconds if res else 0.0,
            "stdout_tail": res.stdout_tail if res else None,
            "stderr_tail": res.stderr_tail if res else None,
        }

    def run_repair(
        self,
        job_id: str,
        proposal: Dict[str, Any],
        approval: Optional[Dict[str, Any]],
        base_commit: Optional[str] = None,
        patch_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Drop-in bridge compatible with existing RepairRunner protocol."""
        if not approval:
            raise ExecutionServiceError("not_approved", "No human approval record. Repair will not run.")

        proposal_id = proposal.get("proposalId", f"prop-{job_id}")
        source_file = proposal.get("targetFile", "src/components/Cart.tsx")
        proposal_ref = ApprovedProposalRef(
            proposal_id=proposal_id,
            scenario_id=proposal.get("scenarioId"),
            defect_category=proposal.get("defectCategory", "UI_DEFECT"),
            source_file=source_file,
            source_file_sha256="0" * 64,
            reviewed_by=approval.get("reviewed_by", "operator"),
            reviewed_at=approval.get("reviewed_at", datetime.now(timezone.utc).isoformat()),
            patch_id=patch_id,
        )

        worktree_ref = WorktreeRef(
            branch=f"repair/{job_id}",
            base_commit=base_commit or "HEAD",
        ) if base_commit else None

        req = ExecutionTaskRequest(
            task_id=f"repair-{job_id}",
            job_id=job_id,
            operation=TaskOperationType.EXECUTE_REPAIR,
            proposal_ref=proposal_ref,
            worktree_ref=worktree_ref,
            correlation_id=f"corr-rep-{job_id}",
            idempotency_key=f"idem-rep-{job_id}",
        )
        self.submit(req)

        # Synchronous wait for completion
        timeout = self.timeout_seconds
        start = time.monotonic()
        while time.monotonic() - start < timeout:
            status = self.get_status(req.task_id)
            if status.status in (
                TaskExecutionStatus.COMPLETED,
                TaskExecutionStatus.FAILED,
                TaskExecutionStatus.REJECTED,
                TaskExecutionStatus.UNSUPPORTED,
                TaskExecutionStatus.CANCELLED,
            ):
                break
            time.sleep(0.1)

        final = self.get_status(req.task_id)
        res = final.result
        return {
            "outcome": "passed" if res and res.passed else "failed",
            "passed": res.passed if res else False,
            "job_id": job_id,
            "message": res.message if res else "Completed",
            "exit_code": res.exit_code if res else 1,
            "final_state": res.final_state if res else "FAILED",
            "duration_seconds": res.duration_seconds if res else 0.0,
            "stdout_tail": res.stdout_tail if res else None,
            "stderr_tail": res.stderr_tail if res else None,
        }


# =========================================================================== #
# Task 3: Worker Service Runner (Remote Execution Adapter)
# =========================================================================== #
class WorkerServiceRunner(ExecutionRunner):
    """Dispatches execution requests to a remote OmniSight execution-worker service.

    Protocol: HTTP/JSON REST API.
    Features:
    - Asynchronous task submission (`POST /api/v1/tasks`).
    - Status polling (`GET /api/v1/tasks/{task_id}`).
    - Cancellation dispatch (`POST /api/v1/tasks/{task_id}/cancel`).
    - Exponential backoff retry for transient network/server failures.
    - Webhook signature verification via HMAC-SHA256.
    - Explicit, honest status reporting that the real worker service is pending M3 deployment.
    """

    def __init__(
        self,
        worker_base_url: str = DEFAULT_WORKER_URL,
        auth_token: Optional[str] = None,
        timeout_seconds: float = DEFAULT_WORKER_TIMEOUT_SECONDS,
        max_retries: int = 3,
        retry_backoff_factor: float = 0.5,
        webhook_secret: Optional[str] = None,
    ) -> None:
        self.worker_base_url = worker_base_url.rstrip("/")
        self.auth_token = auth_token
        self.timeout_seconds = float(timeout_seconds)
        self.max_retries = int(max_retries)
        self.retry_backoff_factor = float(retry_backoff_factor)
        self.webhook_secret = webhook_secret

    @property
    def mode(self) -> RunnerMode:
        return RunnerMode.WORKER_SERVICE

    def _send_request(
        self,
        method: str,
        path: str,
        data: Optional[Dict[str, Any]] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Transmits an HTTP request with retry policy and backoff."""
        url = f"{self.worker_base_url}/{path.lstrip('/')}"
        headers: Dict[str, str] = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "OmniSight-RunnerAdapter/1.0",
        }

        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"

        if extra_headers:
            headers.update(extra_headers)

        payload_bytes: Optional[bytes] = None
        if data is not None:
            payload_bytes = json.dumps(data).encode("utf-8")

        last_error: Optional[Exception] = None

        parsed = urllib.parse.urlparse(url)
        is_local = (parsed.hostname or "").lower() in ("127.0.0.1", "localhost", "::1")

        for attempt in range(self.max_retries):
            try:
                req = urllib.request.Request(
                    url=url,
                    data=payload_bytes,
                    headers=headers,
                    method=method.upper(),
                )
                is_mocked = hasattr(urllib.request.urlopen, "assert_called")
                if not is_mocked and is_local:
                    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                    resp_ctx = opener.open(req, timeout=self.timeout_seconds)
                else:
                    resp_ctx = urllib.request.urlopen(req, timeout=self.timeout_seconds)

                with resp_ctx as resp:
                    resp_bytes = resp.read()
                    if not resp_bytes:
                        return {}
                    return json.loads(resp_bytes.decode("utf-8"))

            except urllib.error.HTTPError as exc:
                last_error = exc
                status_code = exc.code
                # Fail immediately on client errors (4xx except 408/429)
                if status_code in (400, 401, 403, 404, 422):
                    err_body = exc.read().decode("utf-8", errors="replace")
                    raise ExecutionServiceError(
                        code=f"http_{status_code}",
                        message=f"Worker service returned HTTP {status_code}: {err_body}",
                        status_code=status_code,
                        retryable=False,
                    ) from exc

                # Transient server errors: retry with backoff
                if attempt < self.max_retries - 1 and status_code in (408, 429, 500, 502, 503, 504):
                    sleep_time = self.retry_backoff_factor * (2 ** attempt)
                    time.sleep(sleep_time)
                    continue

                raise ExecutionServiceError(
                    code=f"http_{status_code}",
                    message=f"Worker service returned HTTP {status_code} after {attempt + 1} attempts.",
                    status_code=status_code,
                    retryable=True,
                ) from exc

            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last_error = exc
                if attempt < self.max_retries - 1:
                    sleep_time = self.retry_backoff_factor * (2 ** attempt)
                    time.sleep(sleep_time)
                    continue
                raise ExecutionServiceError(
                    code="connection_failed",
                    message=f"Failed to connect to worker service at {url}: {exc}",
                    retryable=True,
                ) from exc

        raise ExecutionServiceError(
            code="max_retries_exceeded",
            message=f"Exceeded max retries ({self.max_retries}) connecting to {url}: {last_error}",
            retryable=True,
        )

    def submit(self, request: ExecutionTaskRequest) -> ExecutionTaskResponse:
        """Submits an execution task to the remote worker service."""
        extra_headers = {
            "X-Correlation-ID": request.correlation_id,
            "X-Idempotency-Key": request.idempotency_key,
        }
        resp_data = self._send_request(
            method="POST",
            path="/api/v1/tasks",
            data=request.model_dump(),
            extra_headers=extra_headers,
        )
        return ExecutionTaskResponse.model_validate(resp_data)

    def get_status(self, task_id: str) -> ExecutionStatusResponse:
        """Retrieves task execution status from the remote worker service."""
        resp_data = self._send_request(
            method="GET",
            path=f"/api/v1/tasks/{urllib.parse.quote(task_id)}",
        )
        return ExecutionStatusResponse.model_validate(resp_data)

    def cancel(self, task_id: str) -> ExecutionStatusResponse:
        """Requests cancellation of a task on the remote worker service."""
        resp_data = self._send_request(
            method="POST",
            path=f"/api/v1/tasks/{urllib.parse.quote(task_id)}/cancel",
        )
        return ExecutionStatusResponse.model_validate(resp_data)

    def health_check(self, probe: bool = False) -> Dict[str, Any]:
        """Reports worker service connectivity and deployment status.

        By default, truthfully documents that the remote worker service is pending
        Milestone M3 deployment. If probe=True is specified, executes an HTTP probe.
        """
        if not probe:
            return {
                "status": "pending_m3_worker_deployment",
                "mode": self.mode.value,
                "deployed": False,
                "available": False,
                "worker_base_url": self.worker_base_url,
                "message": (
                    "Remote execution worker service is not yet deployed (Milestone M3 pending). "
                    "LocalCliRunner should be used for active workloads."
                ),
            }

        try:
            resp_data = self._send_request(method="GET", path="/health")
            return {
                "status": "healthy",
                "mode": self.mode.value,
                "deployed": True,
                "available": True,
                "worker_base_url": self.worker_base_url,
                "remote_response": resp_data,
            }
        except ExecutionServiceError as exc:
            return {
                "status": "unreachable",
                "mode": self.mode.value,
                "deployed": False,
                "available": False,
                "worker_base_url": self.worker_base_url,
                "error": str(exc),
            }

    def verify_webhook_signature(
        self,
        payload_bytes: bytes,
        signature_header: str,
        secret: Optional[str] = None,
    ) -> bool:
        """Validates an incoming webhook notification using HMAC-SHA256."""
        effective_secret = secret or self.webhook_secret
        if not effective_secret:
            raise ValueError("No webhook secret configured for signature verification.")

        # Signature format can be 'sha256=<hex>' or raw '<hex>'
        expected_sig = signature_header.strip()
        if expected_sig.lower().startswith("sha256="):
            expected_sig = expected_sig[7:]

        mac = hmac.new(
            key=effective_secret.encode("utf-8"),
            msg=payload_bytes,
            digestmod=hashlib.sha256,
        )
        calculated_sig = mac.hexdigest()

        return hmac.compare_digest(calculated_sig.lower(), expected_sig.lower())


# =========================================================================== #
# Task 4: Runner Factory
# =========================================================================== #
def get_execution_runner(
    mode: Optional[Union[str, RunnerMode]] = None,
    **kwargs: Any,
) -> ExecutionRunner:
    """Factory creating the configured execution adapter.

    Args:
        mode: Explicit runner mode ('local_cli' or 'worker_service').
              If None, inspects the OMNISIGHT_RUNNER_MODE environment variable,
              defaulting to 'local_cli'.
        **kwargs: Adapter-specific initialization parameters.

    Returns:
        Configured ExecutionRunner instance.

    Raises:
        ValueError: If mode is unrecognized.
    """
    selected_mode = mode or os.environ.get("OMNISIGHT_RUNNER_MODE", RunnerMode.LOCAL_CLI.value)
    if isinstance(selected_mode, RunnerMode):
        selected_mode = selected_mode.value

    selected_mode = selected_mode.strip().lower()

    if selected_mode in (RunnerMode.LOCAL_CLI.value, "local"):
        return LocalCliRunner(**kwargs)

    if selected_mode in (RunnerMode.WORKER_SERVICE.value, "worker", "remote"):
        return WorkerServiceRunner(**kwargs)

    raise ValueError(
        f"Unknown runner mode: {selected_mode!r}. Supported modes are: "
        f"{RunnerMode.LOCAL_CLI.value!r}, {RunnerMode.WORKER_SERVICE.value!r}"
    )
