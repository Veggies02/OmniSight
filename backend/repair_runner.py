"""Repair runner: calls Ajay's approved-repair CLI (`npm run repair:execute`) as a subprocess.

How it connects:  approval endpoint -> job service -> RepairRunner.run() -> scripts/run-repair-job.ts

Contract (read from scripts/run-repair-job.ts on feature/ajay-defect-injection):
  * arguments: --proposal=<path inside the repo> --job-id=<id> [--base-commit=<ref>] [--patch=<id>]
  * there is NO approval argument: the CLI reads humanReviewStatus from the proposal file.
    So this runner is the only gate. It refuses to run without an explicit Approval record and
    writes "approved" into the file itself. It never takes "approved" from a caller's proposal.
  * stdout carries one JSON summary (after npm's banner lines); progress goes to stderr
  * the full report is written to artifacts/repair-executions/<jobId>/repair_execution_report.json
  * exit 0 only when finalState == PASSED. Rejection, failure and fatal errors are all exit 1,
    so the exit code alone is never enough: this runner also reads the JSON and the report.
  * the report folder is keyed by job ID, so a second run of the same job would overwrite the
    first report. This runner refuses to run a job ID twice.
"""
import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

from pydantic import BaseModel, Field

DEFAULT_REPAIR_TIMEOUT_SECONDS = 900
JOBS_SUBDIR = Path("artifacts") / "repair-jobs"
EXECUTIONS_SUBDIR = Path("artifacts") / "repair-executions"
REPORT_NAME = "repair_execution_report.json"
_TAIL_CHARS = 2000

# Same rules the CLI enforces, so we fail early with a clear message instead of a CLI error.
_JOB_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_PATCH_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_COMMIT_REF = re.compile(r"^(?!-)[A-Za-z0-9_.-]{1,200}$")


class RepairApproval(BaseModel):
    """Who approved, and when. Must come from the dashboard approval endpoint, never be invented."""

    reviewed_by: str = Field(min_length=1, max_length=200)
    reviewed_at: str = Field(min_length=1, max_length=64, description="ISO 8601 timestamp")


class RepairResult(BaseModel):
    outcome: Literal["passed", "failed", "rejected", "error"]
    passed: bool
    job_id: str
    message: str
    exit_code: Optional[int] = None
    final_state: Optional[str] = None
    failure_reason: Optional[str] = None
    approved: Optional[bool] = None
    build_passed: Optional[bool] = None
    test_passed: Optional[bool] = None
    visual_passed: Optional[bool] = None
    patch_id: Optional[str] = None
    proposal_id: Optional[str] = None
    cleanup: Optional[Dict[str, Any]] = None
    proposal_path: Optional[str] = None
    report_path: Optional[str] = Field(default=None, description="Relative to the repo root")
    duration_seconds: Optional[float] = None
    stdout_tail: Optional[str] = None
    stderr_tail: Optional[str] = None


class RepairPreflightError(Exception):
    """The job was refused before anything ran. `code` lets the API pick an HTTP status."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _tail(text: Optional[str], limit: int = _TAIL_CHARS) -> Optional[str]:
    return text[-limit:] if text else None


def _kill_process_tree(process: "subprocess.Popen[str]") -> None:
    """npm starts node which starts the browser, so kill the whole tree, not just npm."""
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False
            )
        else:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        process.kill()


def _run_process(
    command: Sequence[str], cwd: Path, timeout: float
) -> Tuple[Optional[int], str, str, bool]:
    """Returns (exit_code, stdout, stderr, timed_out). exit_code is None on timeout. No shell."""
    kwargs: Dict[str, Any] = dict(
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kwargs["start_new_session"] = True
    process = subprocess.Popen(list(command), **kwargs)  # noqa: S603 - fixed argument list, no shell
    try:
        out, err = process.communicate(timeout=timeout)
        return process.returncode, out, err, False
    except subprocess.TimeoutExpired:
        _kill_process_tree(process)
        out, err = process.communicate()
        return None, out or "", err or "", True


_JSON_START = re.compile(r"^\{\s*$", re.MULTILINE)


def parse_cli_summary(stdout: str) -> Optional[Dict[str, Any]]:
    """Find the CLI's JSON summary in stdout, which npm prefixes with '> script' banner lines."""
    decoder = json.JSONDecoder()
    for match in reversed(list(_JSON_START.finditer(stdout or ""))):
        try:
            value, _ = decoder.raw_decode(stdout[match.start():])
        except ValueError:
            continue
        if isinstance(value, dict) and "finalState" in value:
            return value
    return None


class RepairRunner:
    def __init__(
        self,
        repo_root: Path,
        timeout_seconds: float = DEFAULT_REPAIR_TIMEOUT_SECONDS,
        command: Optional[Sequence[str]] = None,
    ) -> None:
        self.repo_root = Path(repo_root).resolve()
        self.timeout_seconds = timeout_seconds
        # Prefix of the command; the runner appends the --proposal/--job-id arguments.
        self.command = list(command) if command else None
        # One repair at a time: each one runs npm ci, a build and a headless browser.
        self._lock = threading.Lock()

    # -- helpers ------------------------------------------------------------
    def is_busy(self) -> bool:
        """True while a repair is running (the API uses this to answer 409 before claiming a job)."""
        return self._lock.locked()

    def _command_prefix(self) -> List[str]:
        if self.command:
            return self.command
        npm = shutil.which("npm")
        if npm is None:
            raise RepairPreflightError("npm_missing", "npm was not found on PATH; install Node.js or fix PATH.")
        return [npm, "run", "repair:execute", "--"]

    def _rel(self, path: Path) -> str:
        return path.resolve().relative_to(self.repo_root).as_posix()

    def job_dir(self, job_id: str) -> Path:
        return self.repo_root / JOBS_SUBDIR / job_id

    def report_file(self, job_id: str) -> Path:
        return self.repo_root / EXECUTIONS_SUBDIR / job_id / REPORT_NAME

    # -- main entry ---------------------------------------------------------
    def run(
        self,
        job_id: str,
        proposal: Dict[str, Any],
        approval: Optional[RepairApproval],
        base_commit: Optional[str] = None,
        patch_id: Optional[str] = None,
    ) -> RepairResult:
        # ---- pre-flight: refuse before anything is written or launched ----
        if not isinstance(job_id, str) or not _JOB_ID.fullmatch(job_id):
            raise RepairPreflightError("invalid_job_id", "job_id may only contain letters, digits, '-' and '_'.")
        if approval is None:
            raise RepairPreflightError("not_approved", "No human approval record. Repair will not run.")
        if not isinstance(proposal, dict) or not isinstance(proposal.get("proposalId"), str):
            raise RepairPreflightError("invalid_proposal", "Proposal must be an object with a proposalId.")
        if base_commit is not None and not _COMMIT_REF.fullmatch(base_commit):
            raise RepairPreflightError("invalid_argument", f"Invalid base commit ref: {base_commit!r}")
        if patch_id is not None and not _PATCH_ID.fullmatch(patch_id):
            raise RepairPreflightError("invalid_argument", f"Invalid patch id: {patch_id!r}")
        if self.job_dir(job_id).exists() or self.report_file(job_id).parent.exists():
            raise RepairPreflightError(
                "already_ran", f"Job {job_id} already has repair files; a job ID can only be repaired once."
            )
        prefix = self._command_prefix()
        if not self._lock.acquire(blocking=False):
            raise RepairPreflightError("busy", "Another repair is running. Try again when it finishes.")

        try:
            # ---- write the proposal file; approval comes ONLY from the approval record ----
            approved = dict(proposal)
            approved["humanReviewStatus"] = "approved"
            approved["reviewedBy"] = approval.reviewed_by
            approved["reviewedAt"] = approval.reviewed_at
            job_dir = self.job_dir(job_id)
            job_dir.mkdir(parents=True)
            proposal_file = job_dir / "proposal.json"
            proposal_file.write_text(json.dumps(approved, indent=2), encoding="utf-8")
            proposal_rel = self._rel(proposal_file)

            args = [f"--proposal={proposal_rel}", f"--job-id={job_id}"]
            if base_commit:
                args.append(f"--base-commit={base_commit}")
            if patch_id:
                args.append(f"--patch={patch_id}")

            started = time.monotonic()
            exit_code, stdout, stderr, timed_out = _run_process(
                prefix + args, self.repo_root, self.timeout_seconds
            )
            duration = round(time.monotonic() - started, 2)
        finally:
            self._lock.release()

        common: Dict[str, Any] = dict(
            job_id=job_id,
            exit_code=exit_code,
            proposal_path=proposal_rel,
            duration_seconds=duration,
            stdout_tail=_tail(stdout),
            stderr_tail=_tail(stderr),
        )

        def error(message: str, **extra: Any) -> RepairResult:
            return RepairResult(outcome="error", passed=False, message=message, **common, **extra)

        if timed_out:
            return error(f"Repair timed out after {self.timeout_seconds} seconds and was stopped.")

        summary = parse_cli_summary(stdout)
        report_path = self.report_file(job_id)
        report: Optional[Dict[str, Any]] = None
        if report_path.is_file():
            try:
                loaded = json.loads(report_path.read_text(encoding="utf-8"))
                report = loaded if isinstance(loaded, dict) else None
            except (OSError, ValueError):
                report = None

        if report is None:
            # Fatal CLI error (bad proposal file, crash...). No report was written.
            reason = (summary or {}).get("failureReason") or _last_line(stderr) or "no output"
            return error(
                f"Repair CLI exited with code {exit_code} and wrote no report: {reason}",
                final_state=(summary or {}).get("finalState"),
                failure_reason=str(reason)[:500],
                approved=(summary or {}).get("approved"),
            )
        if report.get("jobId") != job_id:
            return error(f"Report jobId {report.get('jobId')!r} does not match job {job_id!r}.")

        final_state = report.get("finalState")
        approval_ok = (report.get("approvalValidation") or {}).get("approved")
        if approval_ok is None and summary:
            approval_ok = summary.get("approved")
        fields: Dict[str, Any] = dict(
            final_state=final_state,
            failure_reason=report.get("failureReason"),
            approved=approval_ok,
            build_passed=(report.get("buildExecution") or {}).get("passed"),
            test_passed=(report.get("testExecution") or {}).get("passed"),
            visual_passed=(report.get("visualValidation") or {}).get("passed"),
            patch_id=report.get("patchId"),
            proposal_id=report.get("proposalId"),
            cleanup=report.get("cleanupStatus"),
            report_path=self._rel(report_path),
        )

        if exit_code == 0 and final_state == "PASSED":
            return RepairResult(
                outcome="passed", passed=True, message=f"Repair {job_id} passed all checks.", **common, **fields
            )
        if exit_code == 0:
            # Contract says exit 0 means PASSED. Anything else means we misread something.
            return error(f"CLI exited 0 but report state is {final_state!r}; treating as an error.", **fields)
        outcome = "rejected" if approval_ok is False else "failed"
        reason = report.get("failureReason") or final_state
        return RepairResult(
            outcome=outcome,
            passed=False,
            message=f"Repair {job_id} {outcome}: {reason}",
            **common,
            **fields,
        )


def _last_line(text: Optional[str]) -> Optional[str]:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    return lines[-1][:300] if lines else None


def repair_runner_from_env() -> RepairRunner:
    """Build the runner from OMNISIGHT_REPO_ROOT / OMNISIGHT_REPAIR_TIMEOUT_SECONDS."""
    repo_root = Path(os.getenv("OMNISIGHT_REPO_ROOT") or Path(__file__).resolve().parent.parent)
    return RepairRunner(
        repo_root=repo_root,
        timeout_seconds=float(os.getenv("OMNISIGHT_REPAIR_TIMEOUT_SECONDS", DEFAULT_REPAIR_TIMEOUT_SECONDS)),
    )