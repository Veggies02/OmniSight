"""Proposal pipeline: runs Ajay's diagnosis and proposal CLIs for one capture run.

How it connects:  capture finishes -> ProposalPipeline.run(run_id) -> two subprocesses
  1. npm run diagnose:evidence -- --run-id <id> --provider <provider>
  2. npm run repair:proposals  -- --run-id <id>
then it reads artifacts/repair-proposals/<run_id>/repair_proposals.json (a JSON object keyed by scenario id).

Safety rules, each learned from a real run:
  * Step 2 reads whatever diagnoses are already in the run folder and still exits 0, so a FAILED diagnosis
    can look like success. This pipeline stops when step 1 exits non-zero, and it deletes old diagnoses and
    old proposals first so a result is never taken from a previous run.
  * Only the run folder name is passed to the CLIs. It is checked against a strict pattern and must be a
    real folder under artifacts/visual-evidence/. No shell is used.
  * Mock output stays labelled by the CLI itself (is_mock / provider "mock"); this module never relabels it.
  * It never reads ground_truth_eval.json.
"""
import sys
import json
import os
import re
import shutil
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from pydantic import BaseModel

from repair_runner import _run_process, _tail

DEFAULT_PIPELINE_TIMEOUT_SECONDS = 300
EVIDENCE_SUBDIR = Path("artifacts") / "visual-evidence"
PROPOSALS_SUBDIR = Path("artifacts") / "repair-proposals"
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
PROVIDER_RE = re.compile(r"^[a-z][a-z0-9_-]{0,29}$")


class PipelineError(Exception):
    """A pipeline step failed. `code` is stable for the API; `stage` says which step."""

    def __init__(self, code: str, message: str, stage: str) -> None:
        super().__init__(message)
        self.code = code
        self.stage = stage


class PipelineResult(BaseModel):
    run_id: str
    provider: str
    proposals: Dict[str, Dict[str, Any]]
    proposals_path: str  # relative to the repo root
    duration_seconds: float


def _last_line(*texts: Optional[str]) -> Optional[str]:
    for text in texts:
        for line in reversed((text or "").strip().splitlines()):
            if line.strip():
                return line.strip()[:500]
    return None


class ProposalPipeline:
    def __init__(
        self,
        repo_root: Path,
        timeout_seconds: float = DEFAULT_PIPELINE_TIMEOUT_SECONDS,
        provider: str = "mock",
        diagnose_command: Optional[Sequence[str]] = None,
        proposals_command: Optional[Sequence[str]] = None,
    ) -> None:
        if not PROVIDER_RE.match(provider):
            raise ValueError(f"Invalid diagnosis provider: {provider!r}")
        self.repo_root = Path(repo_root).resolve()
        self.timeout_seconds = timeout_seconds
        self.provider = provider
        self.diagnose_command = list(diagnose_command) if diagnose_command else None
        self.proposals_command = list(proposals_command) if proposals_command else None
        self._lock = threading.Lock()  # one pipeline at a time: each step starts node

    # -- helpers ------------------------------------------------------------
    def _npm(self, script: str) -> List[str]:
        npm = shutil.which("npm")
        if npm is None:
            raise PipelineError("npm_missing", "npm was not found on PATH; install Node.js or fix PATH.", "setup")
        return [npm, "run", script, "--"]

    def _inside(self, path: Path, root: Path) -> bool:
        try:
            path.resolve().relative_to(root.resolve())
            return True
        except ValueError:
            return False

    def _clear(self, folder: Path, stage: str) -> None:
        if not folder.exists() and not folder.is_symlink():
            return
        if folder.is_symlink() or not self._inside(folder, self.repo_root / "artifacts"):
            raise PipelineError("unsafe_path", f"Refusing to delete {folder.name}: not a plain folder under artifacts/.", stage)
        shutil.rmtree(folder)

    def _step(self, prefix: Sequence[str], args: Sequence[str], stage: str, label: str) -> None:
        exit_code, out, err, timed_out = _run_process(list(prefix) + list(args), self.repo_root, self.timeout_seconds)
        if timed_out:
            raise PipelineError(f"{stage}_timeout", f"{label} timed out after {self.timeout_seconds} seconds and was stopped.", stage)
        if exit_code != 0:
            reason = _last_line(err, out) or "no output"
            raise PipelineError(f"{stage}_failed", f"{label} failed (exit {exit_code}): {reason}", stage)

    # -- main entry ---------------------------------------------------------
    def run(self, run_id: str) -> PipelineResult:
        if not isinstance(run_id, str) or not RUN_ID_RE.match(run_id):
            raise PipelineError("invalid_run_id", "The capture run id has characters that are not allowed.", "setup")
        run_dir = self.repo_root / EVIDENCE_SUBDIR / run_id
        if not run_dir.is_dir() or not self._inside(run_dir, self.repo_root / EVIDENCE_SUBDIR):
            raise PipelineError("no_evidence", f"No capture folder for run {run_id}.", "setup")
        if not (run_dir / "model_facing_evidence.json").is_file():
            raise PipelineError("no_evidence", "The capture has no model_facing_evidence.json.", "setup")
        diagnose_prefix = self.diagnose_command or self._npm("diagnose:evidence")
        proposals_prefix = self.proposals_command or self._npm("repair:proposals")

        with self._lock:
            started = time.monotonic()
            self._clear(run_dir / "diagnoses", "diagnosis")
            self._clear(self.repo_root / PROPOSALS_SUBDIR / run_id, "proposals")

            self._step(diagnose_prefix, ["--run-id", run_id, "--provider", self.provider], "diagnosis", "Diagnosis")
            if not (run_dir / "diagnoses" / "diagnoses-manifest.json").is_file():
                raise PipelineError("diagnosis_no_output", "Diagnosis finished but wrote no diagnoses-manifest.json.", "diagnosis")

            self._step(proposals_prefix, ["--run-id", run_id], "proposals", "Proposal generation")
            proposals_file = self.repo_root / PROPOSALS_SUBDIR / run_id / "repair_proposals.json"
            if not proposals_file.is_file():
                raise PipelineError("proposals_missing", "Proposal generation finished but wrote no repair_proposals.json.", "proposals")
            try:
                data = json.loads(proposals_file.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise PipelineError("proposals_invalid", f"repair_proposals.json could not be read: {exc}", "proposals")
            if not isinstance(data, dict):
                raise PipelineError("proposals_invalid", "repair_proposals.json is not a JSON object keyed by scenario id.", "proposals")
            proposals: Dict[str, Dict[str, Any]] = {}
            for scenario_id, proposal in data.items():
                if not isinstance(proposal, dict):
                    raise PipelineError("proposals_invalid", f"Proposal for '{scenario_id}' is not an object.", "proposals")
                declared = proposal.get("scenarioId")
                if declared is not None and declared != scenario_id:
                    raise PipelineError("proposals_invalid", f"Proposal key '{scenario_id}' does not match its scenarioId '{declared}'.", "proposals")
                proposals[scenario_id] = proposal
            return PipelineResult(
                run_id=run_id,
                provider=self.provider,
                proposals=proposals,
                proposals_path=proposals_file.resolve().relative_to(self.repo_root).as_posix(),
                duration_seconds=round(time.monotonic() - started, 3),
            )


def proposal_pipeline_from_env(repo_root: Path) -> Optional[ProposalPipeline]:
    """OFF unless OMNISIGHT_AUTO_PROPOSALS is 1, true or yes, so a stock setup behaves as before.
    OMNISIGHT_DIAGNOSIS_PROVIDER (default mock) and OMNISIGHT_PIPELINE_TIMEOUT_SECONDS (default 300, per step)
    tune it. A bad provider name fails at startup instead of at the first job."""
    if os.getenv("OMNISIGHT_AUTO_PROPOSALS", "").strip().lower() not in ("1", "true", "yes"):
        return None
    
    diagnose_command = None
    if os.getenv("OMNISIGHT_DIAGNOSIS_ENGINE", "").strip().lower() == "python":
        diagnose_command = [sys.executable, str(Path(__file__).resolve().with_name("diagnose_wrapper.py"))]
    return ProposalPipeline(
        repo_root=repo_root,
        provider=os.getenv("OMNISIGHT_DIAGNOSIS_PROVIDER", "mock").strip().lower(),
        timeout_seconds=float(os.getenv("OMNISIGHT_PIPELINE_TIMEOUT_SECONDS", DEFAULT_PIPELINE_TIMEOUT_SECONDS)),
        diagnose_command=diagnose_command,
    )
