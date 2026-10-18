"""Browser runners: the Week 1 MOCK and the REAL Playwright evidence-capture runner.

How it connects:  webhook / POST /jobs  ->  job service (api.py)  ->  BrowserRunner.run()

PlaywrightCliRunner launches Person 1's harness (`npm run capture:evidence`) as a
subprocess from the repository root, records the exit code and output, reads the
manifest the harness writes under artifacts/visual-evidence/<runId>/ and turns every
file it lists into an artifact REFERENCE for the job.

Known limits of the harness today (it takes no arguments):
  * it always inspects the local app at http://127.0.0.1:5173 (it must already be running)
  * it captures its fixed set of seeded-defect scenarios, not an arbitrary website
"""
import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Optional, Protocol, Sequence, Tuple
from urllib.parse import urlparse

from pydantic import BaseModel

from job_schemas import ArtifactDraft, Inspection

DEFAULT_CAPTURE_BASE_URL = "http://127.0.0.1:5173"
DEFAULT_CAPTURE_TIMEOUT_SECONDS = 300
EVIDENCE_SUBDIR = Path("artifacts") / "visual-evidence"
_TAIL_CHARS = 2000


class RunnerResult(BaseModel):
    mode: str
    executed: bool
    message: str
    artifacts: List[ArtifactDraft]
    run_id: Optional[str] = None
    exit_code: Optional[int] = None
    duration_seconds: Optional[float] = None
    scenarios_captured: Optional[int] = None
    total_scenarios: Optional[int] = None
    stdout_tail: Optional[str] = None
    stderr_tail: Optional[str] = None


class RunnerError(Exception):
    """An expected inspection failure. Carries the details so the job can store them."""

    def __init__(
        self,
        message: str,
        inspection: Optional[Inspection] = None,
        artifacts: Optional[List[ArtifactDraft]] = None,
    ) -> None:
        super().__init__(message)
        self.inspection = inspection
        self.artifacts = artifacts or []


class BrowserRunner(Protocol):
    mode: str
    disclaimer: str

    def run(self, job_id: str, website_url: str) -> RunnerResult: ...


# --------------------------------------------------------------------------- #
# Mock runner (default; used by the test suite)
# --------------------------------------------------------------------------- #
class MockBrowserRunner:
    """Returns a clearly labelled placeholder. No browser is launched."""

    mode = "mock"
    disclaimer = (
        "MOCK RESULT ONLY. No real browser was launched; "
        "Playwright integration (Person 1) is pending."
    )

    def run(self, job_id: str, website_url: str) -> RunnerResult:
        return RunnerResult(
            mode=self.mode,
            executed=False,
            message=self.disclaimer,
            artifacts=[
                ArtifactDraft(
                    kind="screenshot",
                    uri=f"mock://artifacts/{job_id}/homepage.png",
                    description="MOCK placeholder. No screenshot was captured.",
                    mock=True,
                )
            ],
        )


# --------------------------------------------------------------------------- #
# Real runner
# --------------------------------------------------------------------------- #
def _tail(text: Optional[str], limit: int = _TAIL_CHARS) -> Optional[str]:
    if not text:
        return None
    return text[-limit:]


_BOX_CHARS = "║╔╗╚╝═"


def _summarise_failure(stderr: str, stdout: str) -> str:
    """Pick the one useful line from process output (skips Playwright's box banner)."""
    lines = [line.strip() for line in (stderr or "").splitlines() + (stdout or "").splitlines()]
    lines = [line for line in lines if line and line[0] not in _BOX_CHARS]
    for line in lines:
        if re.search(r"failed|error", line, re.IGNORECASE):
            return line[:300]
    return (lines[-1] if lines else "no output")[:300]


def _normalise_origin(url: str) -> Tuple[str, str, int]:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host == "localhost":
        host = "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return parsed.scheme.lower(), host, port


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
    """Returns (exit_code, stdout, stderr, timed_out). exit_code is None on timeout."""
    kwargs = dict(
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


class PlaywrightCliRunner:
    mode = "playwright"
    disclaimer = "Real Playwright evidence capture (npm run capture:evidence) runs in the background."

    def __init__(
        self,
        repo_root: Path,
        base_url: str = DEFAULT_CAPTURE_BASE_URL,
        timeout_seconds: float = DEFAULT_CAPTURE_TIMEOUT_SECONDS,
        command: Optional[Sequence[str]] = None,
        check_app: bool = True,
    ) -> None:
        self.repo_root = Path(repo_root).resolve()
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self.command = list(command) if command else None
        self.check_app = check_app
        # One capture at a time: the harness shares one dev server and one output folder.
        self._lock = threading.Lock()

    # -- helpers ------------------------------------------------------------
    def _resolve_command(self) -> List[str]:
        if self.command:
            return self.command
        npm = shutil.which("npm")
        if npm is None:
            raise RunnerError("npm was not found on PATH; install Node.js or fix PATH.")
        return [npm, "run", "capture:evidence"]

    def _check_app_reachable(self) -> None:
        try:
            urllib.request.urlopen(self.base_url, timeout=5).close()
        except urllib.error.HTTPError:
            return  # the server answered, so it is up
        except (urllib.error.URLError, OSError) as exc:
            raise RunnerError(
                f"App is not reachable at {self.base_url} ({exc}). "
                "Start it first in another terminal with: npm run dev"
            ) from exc

    def _inside(self, base: Path, candidate: Path) -> bool:
        try:
            candidate.resolve().relative_to(base.resolve())
            return True
        except ValueError:
            return False

    def _uri(self, path: Path) -> str:
        return path.resolve().relative_to(self.repo_root).as_posix()

    def _collect_artifacts(self, run_dir: Path, manifest: dict) -> List[ArtifactDraft]:
        def ref(path: Path, kind: str, description: str) -> ArtifactDraft:
            if not self._inside(run_dir, path):
                raise RunnerError(f"Manifest references a path outside the run folder: {path}")
            if not path.is_file():
                raise RunnerError(f"Manifest references a file that does not exist: {path}")
            return ArtifactDraft(kind=kind, uri=self._uri(path), description=description)

        artifacts = [
            ref(run_dir / "manifest.json", "other", "Run manifest"),
            ref(run_dir / "model_facing_evidence.json", "other", "Evidence prepared for the AI model"),
            ref(
                run_dir / "ground_truth_eval.json",
                "other",
                "EVALUATION ONLY: contains the answer key. Never send this to the AI model.",
            ),
        ]
        for scenario_id, scenario in (manifest.get("scenarios") or {}).items():
            for side in ("baseline", "defective"):
                part = scenario.get(side) or {}
                for key, kind, label in (
                    ("screenshotPath", "screenshot", "screenshot"),
                    ("domPath", "dom_snapshot", "DOM snapshot"),
                    ("measurementsPath", "other", "measurements"),
                ):
                    if part.get(key):
                        artifacts.append(
                            ref(run_dir / part[key], kind, f"{scenario_id} {side} {label}")
                        )
        return artifacts

    # -- main entry ---------------------------------------------------------
    def run(self, job_id: str, website_url: str) -> RunnerResult:
        if _normalise_origin(website_url) != _normalise_origin(self.base_url):
            raise RunnerError(
                f"The capture harness only supports {self.base_url} today (it takes no "
                f"arguments), but the job asks for {website_url}."
            )
        if self.check_app:
            self._check_app_reachable()
        command = self._resolve_command()

        with self._lock:
            started = time.monotonic()
            exit_code, stdout, stderr, timed_out = _run_process(
                command, self.repo_root, self.timeout_seconds
            )
            duration = round(time.monotonic() - started, 2)

        run_match = re.search(r"Run ID:\s*([A-Za-z0-9._\-]+)\)?", stdout)
        run_id = run_match.group(1) if run_match else None
        common = dict(
            run_id=run_id,
            exit_code=exit_code,
            duration_seconds=duration,
            stdout_tail=_tail(stdout),
            stderr_tail=_tail(stderr),
        )

        def failure(message: str, executed: bool = False, **extra) -> RunnerError:
            return RunnerError(
                message,
                Inspection(mode="playwright", executed=executed, message=message, **common, **extra),
            )

        if timed_out:
            raise failure(f"Capture timed out after {self.timeout_seconds} seconds and was stopped.")
        if exit_code != 0:
            raise failure(
                f"Capture process exited with code {exit_code}: {_summarise_failure(stderr, stdout)}"
            )
        if not run_id:
            raise failure("Capture finished but its output did not contain a run ID.")

        run_dir = self.repo_root / EVIDENCE_SUBDIR / run_id
        manifest_path = run_dir / "manifest.json"
        if not manifest_path.is_file():
            raise failure(f"Capture finished but no manifest was written at {manifest_path}.")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise failure(f"Manifest could not be read: {exc}") from exc

        captured = manifest.get("scenariosCaptured")
        total = manifest.get("totalScenarios")
        counts = dict(scenarios_captured=captured, total_scenarios=total)

        try:
            artifacts = self._collect_artifacts(run_dir, manifest)
        except RunnerError as exc:
            raise failure(str(exc), executed=True, **counts) from exc

        if manifest.get("success") is not True:
            message = f"Capture incomplete: {captured}/{total} scenarios captured."
            error = failure(message, executed=True, **counts)
            error.artifacts = artifacts  # keep partial evidence for debugging
            raise error

        return RunnerResult(
            mode=self.mode,
            executed=True,
            message=f"Captured {captured}/{total} scenarios in real Playwright run {run_id}.",
            artifacts=artifacts,
            scenarios_captured=captured,
            total_scenarios=total,
            **common,
        )


# --------------------------------------------------------------------------- #
# Factory
# --------------------------------------------------------------------------- #
def runner_from_env(name: Optional[str] = None) -> BrowserRunner:
    """Pick the runner from OMNISIGHT_RUNNER (default: mock). Fails fast on a bad value."""
    chosen = (name or os.getenv("OMNISIGHT_RUNNER") or "mock").strip().lower()
    if chosen == "mock":
        return MockBrowserRunner()
    if chosen == "playwright":
        repo_root = Path(os.getenv("OMNISIGHT_REPO_ROOT") or Path(__file__).resolve().parent.parent)
        return PlaywrightCliRunner(
            repo_root=repo_root,
            base_url=os.getenv("OMNISIGHT_CAPTURE_BASE_URL", DEFAULT_CAPTURE_BASE_URL),
            timeout_seconds=float(
                os.getenv("OMNISIGHT_CAPTURE_TIMEOUT_SECONDS", DEFAULT_CAPTURE_TIMEOUT_SECONDS)
            ),
        )
    raise ValueError(
        f"Unsupported OMNISIGHT_RUNNER '{chosen}'. Use 'mock' or 'playwright'."
    )