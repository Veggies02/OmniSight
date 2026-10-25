"""Tests for RepairRunner.

Most tests use a fake CLI that follows the contract read from Ajay's scripts/run-repair-job.ts
(arguments, JSON summary after an npm-style banner, report file, exit codes). One extra test
launches the REAL CLI through npm; it is skipped automatically when Node or the repo is missing.
Run from the backend/ folder:   pytest -v
"""
import json
import os
import shutil
import sys
import time
from pathlib import Path

import pytest

from repair_runner import (
    RepairApproval,
    RepairPreflightError,
    RepairRunner,
    parse_cli_summary,
)

FAKE_CLI = r'''
import json, os, sys, time
from pathlib import Path

args = {a.split("=", 1)[0]: a.split("=", 1)[1] for a in sys.argv[1:] if "=" in a}
job_id = args["--job-id"]
proposal = json.loads(Path(args["--proposal"]).read_text(encoding="utf-8"))
mode = os.environ.get("FAKE_REPAIR_MODE", "pass")
(Path.cwd() / "seen_args.json").write_text(json.dumps(sys.argv[1:]))
(Path.cwd() / "seen_proposal.json").write_text(json.dumps(proposal))

print("")
print("> omnisight@0.0.0 repair:execute")
print("> tsx scripts/run-repair-job.ts " + " ".join(sys.argv[1:]))
print("")
print(f"[OmniSight Repair CLI] Starting isolated repair job {job_id}...", file=sys.stderr)

if mode == "hang":
    time.sleep(60)
if mode == "fatal":
    print("[OmniSight Repair CLI] Fatal error: Proposal file not found", file=sys.stderr)
    print(json.dumps({"finalState": "FAILED", "approved": False, "failureReason": "Proposal file not found"}, indent=2))
    sys.exit(1)

report_dir = Path.cwd() / "artifacts" / "repair-executions" / job_id
report_dir.mkdir(parents=True, exist_ok=True)
state = {"pass": "PASSED", "exit0_wrong_state": "FAILED"}.get(mode, "FAILED")
approved = mode != "reject"
report = {
    "jobId": "someone-else" if mode == "wrong_job" else job_id,
    "proposalId": proposal["proposalId"],
    "patchId": "patch-product-image-distortion-001",
    "finalState": state,
    "approvalValidation": {"approved": approved},
    "buildExecution": {"passed": mode != "build_fail"},
    "testExecution": {"passed": mode == "pass"},
    "visualValidation": {"passed": mode == "pass"},
    "cleanupStatus": {"cleaned": True, "worktreeRemoved": True, "branchRemoved": True},
    "failureReason": None if state == "PASSED" else ("Human review status is not approved" if mode == "reject" else "Build failed"),
}
if mode != "no_report":
    (report_dir / "repair_execution_report.json").write_text(json.dumps(report))
summary = {
    "jobId": job_id, "proposalId": proposal["proposalId"], "finalState": state, "approved": approved,
    "buildPassed": report["buildExecution"]["passed"], "visualPassed": report["visualValidation"]["passed"],
    "reportPath": str(report_dir / "repair_execution_report.json"), "failureReason": report["failureReason"],
}
print(json.dumps(summary, indent=2))
sys.exit(0 if state == "PASSED" and mode != "exit0_wrong_state" else (0 if mode == "exit0_wrong_state" else 1))
'''

APPROVAL = RepairApproval(reviewed_by="qa-engineer@omnisight.ai", reviewed_at="2026-10-25T09:00:00Z")
PROPOSAL = {"proposalId": "prop-1", "scenarioId": "product-image-distortion", "humanReviewStatus": "pending_review"}


@pytest.fixture()
def repo(tmp_path):
    (tmp_path / "fake_cli.py").write_text(FAKE_CLI)
    return tmp_path


def make_runner(repo, **kwargs):
    return RepairRunner(repo_root=repo, command=[sys.executable, str(repo / "fake_cli.py")], **kwargs)


# ------------------------------------------------------------ happy path
def test_passed_repair_reads_report_and_stores_details(repo):
    result = make_runner(repo).run("job-abc", PROPOSAL, APPROVAL)
    assert result.outcome == "passed" and result.passed is True
    assert result.exit_code == 0 and result.final_state == "PASSED"
    assert (result.build_passed, result.test_passed, result.visual_passed) == (True, True, True)
    assert result.approved is True
    assert result.cleanup["worktreeRemoved"] is True
    assert result.patch_id == "patch-product-image-distortion-001"
    assert result.report_path == "artifacts/repair-executions/job-abc/repair_execution_report.json"
    assert result.proposal_path == "artifacts/repair-jobs/job-abc/proposal.json"
    assert (repo / result.report_path).is_file()
    assert result.duration_seconds is not None


def test_runner_passes_the_expected_cli_arguments(repo):
    make_runner(repo).run("job-abc", PROPOSAL, APPROVAL, base_commit="HEAD", patch_id="patch-x-001")
    assert json.loads((repo / "seen_args.json").read_text()) == [
        "--proposal=artifacts/repair-jobs/job-abc/proposal.json",
        "--job-id=job-abc",
        "--base-commit=HEAD",
        "--patch=patch-x-001",
    ]


# ------------------------------------------------------ the approval gate
def test_runner_writes_approval_from_the_record_not_from_the_proposal(repo):
    sneaky = dict(PROPOSAL, humanReviewStatus="approved", reviewedBy="attacker")
    make_runner(repo).run("job-abc", sneaky, APPROVAL)
    seen = json.loads((repo / "seen_proposal.json").read_text())
    assert seen["humanReviewStatus"] == "approved"
    assert seen["reviewedBy"] == "qa-engineer@omnisight.ai"
    assert seen["reviewedAt"] == "2026-10-25T09:00:00Z"


def test_no_approval_record_means_nothing_runs(repo):
    runner = make_runner(repo)
    with pytest.raises(RepairPreflightError) as caught:
        runner.run("job-abc", PROPOSAL, None)
    assert caught.value.code == "not_approved"
    assert not (repo / "artifacts").exists()  # nothing written, nothing launched
    assert not (repo / "seen_args.json").exists()


def test_the_callers_proposal_is_not_modified(repo):
    original = dict(PROPOSAL)
    make_runner(repo).run("job-abc", PROPOSAL, APPROVAL)
    assert PROPOSAL == original


# ---------------------------------------------------------- pre-flight
@pytest.mark.parametrize("bad", ["../escape", "a/b", "a b", "a.b", "", "x" * 101])
def test_unsafe_job_ids_are_refused(repo, bad):
    with pytest.raises(RepairPreflightError) as caught:
        make_runner(repo).run(bad, PROPOSAL, APPROVAL)
    assert caught.value.code == "invalid_job_id"


@pytest.mark.parametrize("kwargs", [{"base_commit": "--all"}, {"base_commit": "HEAD main"}, {"patch_id": "a b"}])
def test_unsafe_cli_arguments_are_refused(repo, kwargs):
    with pytest.raises(RepairPreflightError) as caught:
        make_runner(repo).run("job-abc", PROPOSAL, APPROVAL, **kwargs)
    assert caught.value.code == "invalid_argument"


def test_proposal_without_an_id_is_refused(repo):
    with pytest.raises(RepairPreflightError) as caught:
        make_runner(repo).run("job-abc", {"scenarioId": "x"}, APPROVAL)
    assert caught.value.code == "invalid_proposal"


def test_a_job_cannot_be_repaired_twice(repo):
    runner = make_runner(repo)
    runner.run("job-abc", PROPOSAL, APPROVAL)
    first_report = (repo / "artifacts/repair-executions/job-abc/repair_execution_report.json").read_text()
    with pytest.raises(RepairPreflightError) as caught:
        runner.run("job-abc", PROPOSAL, APPROVAL)
    assert caught.value.code == "already_ran"
    assert (repo / "artifacts/repair-executions/job-abc/repair_execution_report.json").read_text() == first_report


def test_missing_npm_is_reported_before_anything_is_written(repo, monkeypatch):
    monkeypatch.setattr("repair_runner.shutil.which", lambda name: None)
    runner = RepairRunner(repo_root=repo)  # default command
    with pytest.raises(RepairPreflightError) as caught:
        runner.run("job-abc", PROPOSAL, APPROVAL)
    assert caught.value.code == "npm_missing"
    assert not (repo / "artifacts").exists()


def test_a_second_repair_while_one_is_running_is_refused(repo):
    runner = make_runner(repo)
    assert runner._lock.acquire(blocking=False)
    try:
        with pytest.raises(RepairPreflightError) as caught:
            runner.run("job-abc", PROPOSAL, APPROVAL)
        assert caught.value.code == "busy"
    finally:
        runner._lock.release()


# ------------------------------------------------- execution outcomes
def test_failed_repair_keeps_the_reason_and_per_stage_results(repo, monkeypatch):
    monkeypatch.setenv("FAKE_REPAIR_MODE", "build_fail")
    result = make_runner(repo).run("job-abc", PROPOSAL, APPROVAL)
    assert result.outcome == "failed" and result.passed is False
    assert result.exit_code == 1 and result.final_state == "FAILED"
    assert result.build_passed is False
    assert result.failure_reason == "Build failed"
    assert result.cleanup["worktreeRemoved"] is True


def test_cli_rejection_is_distinguished_from_failure(repo, monkeypatch):
    monkeypatch.setenv("FAKE_REPAIR_MODE", "reject")
    result = make_runner(repo).run("job-abc", PROPOSAL, APPROVAL)
    assert result.outcome == "rejected" and result.approved is False
    assert result.exit_code == 1


def test_fatal_cli_error_without_a_report_is_an_error_with_the_reason(repo, monkeypatch):
    monkeypatch.setenv("FAKE_REPAIR_MODE", "fatal")
    result = make_runner(repo).run("job-abc", PROPOSAL, APPROVAL)
    assert result.outcome == "error" and result.passed is False
    assert result.report_path is None
    assert "Proposal file not found" in result.message
    assert "Proposal file not found" in result.failure_reason


def test_report_for_a_different_job_is_not_trusted(repo, monkeypatch):
    monkeypatch.setenv("FAKE_REPAIR_MODE", "wrong_job")
    result = make_runner(repo).run("job-abc", PROPOSAL, APPROVAL)
    assert result.outcome == "error" and result.passed is False


def test_exit_zero_with_a_non_passed_report_is_never_reported_as_passed(repo, monkeypatch):
    monkeypatch.setenv("FAKE_REPAIR_MODE", "exit0_wrong_state")
    result = make_runner(repo).run("job-abc", PROPOSAL, APPROVAL)
    assert result.outcome == "error" and result.passed is False


def test_hung_repair_times_out_and_is_stopped(repo, monkeypatch):
    monkeypatch.setenv("FAKE_REPAIR_MODE", "hang")
    started = time.monotonic()
    result = make_runner(repo, timeout_seconds=1).run("job-abc", PROPOSAL, APPROVAL)
    assert result.outcome == "error" and result.exit_code is None
    assert "timed out" in result.message
    assert time.monotonic() - started < 20


# ------------------------------------------------------- stdout parsing
def test_summary_is_found_after_npm_banner_lines():
    out = '\n> omnisight@0.0.0 repair:execute\n> tsx scripts/run-repair-job.ts --job-id=x\n\n{\n  "finalState": "PASSED",\n  "approved": true\n}\n'
    assert parse_cli_summary(out) == {"finalState": "PASSED", "approved": True}


@pytest.mark.parametrize("out", ["", "no json here", "{\n  broken", '{\n  "other": 1\n}'])
def test_unparseable_stdout_gives_none(out):
    assert parse_cli_summary(out) is None


# --------------------------------------------- the REAL CLI (skipped if absent)
REAL_ROOT = Path(os.getenv("OMNISIGHT_REPO_ROOT") or Path(__file__).resolve().parents[2])


@pytest.mark.skipif(
    not (REAL_ROOT / "scripts" / "run-repair-job.ts").is_file()
    or not (REAL_ROOT / "node_modules").is_dir()
    or shutil.which("npm") is None,
    reason="real repair CLI, node_modules or npm not available",
)
def test_real_cli_launches_and_a_bad_proposal_never_reports_passed():
    """Proves npm -> tsx -> CLI launches from Python and stdout parsing works on the real output.
    The proposal is deliberately invalid, so the CLI must refuse it and the job must not pass."""
    job_id = f"pytest-real-cli-{int(time.time())}"
    runner = RepairRunner(repo_root=REAL_ROOT, timeout_seconds=120)
    try:
        result = runner.run(job_id, {"proposalId": "pytest-invalid-proposal"}, APPROVAL)
    finally:
        for sub in ("artifacts/repair-jobs", "artifacts/repair-executions"):
            shutil.rmtree(REAL_ROOT / sub / job_id, ignore_errors=True)
    assert result.passed is False
    assert result.outcome in ("error", "rejected", "failed")
    assert result.exit_code == 1, result.stderr_tail
    assert result.final_state == "FAILED", result.stdout_tail
    assert result.failure_reason or result.message