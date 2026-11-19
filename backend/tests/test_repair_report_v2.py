"""Repair report v2: branch and commit SHA after a validated repair, and the UNSUPPORTED result.

Uses a fake CLI that writes reports with the field names Ajay confirmed (finalState, branch,
commitSha, commit_sha, patchId, failureReason, cleanupStatus, buildExecution, testExecution,
visualValidation, approvalValidation). These reports are constructed; replace them with the
genuine report files from artifacts/integration-handoff/ once they are in the repo.
"""
import json
import sys

import pytest

from repair_runner import RepairApproval, RepairRunner

SHA = "a" * 40
FAKE_CLI = r'''
import json, os, sys
from pathlib import Path

args = {a.split("=", 1)[0]: a.split("=", 1)[1] for a in sys.argv[1:] if "=" in a}
job_id = args["--job-id"]
proposal = json.loads(Path(args["--proposal"]).read_text(encoding="utf-8"))
mode = os.environ.get("FAKE_V2_MODE", "pass")
SHA = "a" * 40

report = {
    "jobId": job_id, "proposalId": proposal["proposalId"], "patchId": "patch-mobile-nav-overflow-001",
    "approvalValidation": {"approved": True},
    "cleanupStatus": {"worktreeRemoved": True, "branchRemoved": False},
}
if mode == "pass":
    report.update(finalState="PASSED", branch="omnisight-repair/" + job_id, commitSha=SHA, commit_sha=SHA,
                  buildExecution={"passed": True}, testExecution={"passed": True}, visualValidation={"passed": True})
elif mode == "pass_snake_only":
    report.update(finalState="PASSED", branch="omnisight-repair/" + job_id, commit_sha=SHA,
                  buildExecution={"passed": True}, testExecution={"passed": True}, visualValidation={"passed": True})
elif mode in ("unsupported", "unsupported_exit0"):
    report.update(finalState="UNSUPPORTED", patchId=None, failureReason="No registered patch available for this scenario.",
                  cleanupStatus={"worktreeRemoved": True, "branchRemoved": True})
elif mode == "failed":
    report.update(finalState="FAILED", failureReason="Build failed", branch=None, commitSha=None,
                  buildExecution={"passed": False}, testExecution={"passed": False}, visualValidation={"passed": False})

d = Path.cwd() / "artifacts" / "repair-executions" / job_id
d.mkdir(parents=True, exist_ok=True)
(d / "repair_execution_report.json").write_text(json.dumps(report))
print("\n> omnisight@0.0.0 repair:execute\n")
print(json.dumps({"jobId": job_id, "finalState": report["finalState"], "approved": True,
                  "failureReason": report.get("failureReason")}, indent=2))
sys.exit(0 if mode in ("pass", "pass_snake_only", "unsupported_exit0") else 1)
'''
APPROVAL = RepairApproval(reviewed_by="qa-engineer@omnisight.ai", reviewed_at="2026-11-07T09:00:00Z")
PROPOSAL = {"proposalId": "prop-9", "scenarioId": "mobile-nav-overflow", "humanReviewStatus": "pending_review"}


@pytest.fixture()
def runner(tmp_path, monkeypatch):
    (tmp_path / "fake_cli.py").write_text(FAKE_CLI)
    return RepairRunner(repo_root=tmp_path, command=[sys.executable, str(tmp_path / "fake_cli.py")])


def run(runner, mode, monkeypatch, job="job-1"):
    monkeypatch.setenv("FAKE_V2_MODE", mode)
    return runner.run(job, PROPOSAL, APPROVAL)


def test_passed_repair_carries_branch_and_commit(runner, monkeypatch):
    r = run(runner, "pass", monkeypatch)
    assert r.outcome == "passed" and r.passed is True
    assert r.branch == "omnisight-repair/job-1"
    assert r.commit_sha == SHA


def test_commit_sha_is_read_from_the_snake_case_field_too(runner, monkeypatch):
    r = run(runner, "pass_snake_only", monkeypatch)
    assert r.passed is True and r.commit_sha == SHA


def test_unsupported_is_its_own_outcome_and_branch_is_absent(runner, monkeypatch):
    r = run(runner, "unsupported", monkeypatch)
    assert r.outcome == "unsupported" and r.passed is False
    assert r.final_state == "UNSUPPORTED" and r.exit_code == 1
    assert "No registered patch" in r.failure_reason
    assert r.branch is None and r.commit_sha is None
    assert r.patch_id is None


def test_unsupported_is_not_reported_as_failed_or_rejected(runner, monkeypatch):
    r = run(runner, "unsupported", monkeypatch)
    assert r.outcome not in ("failed", "rejected", "error")


def test_exit_zero_with_unsupported_state_is_treated_as_an_error(runner, monkeypatch):
    r = run(runner, "unsupported_exit0", monkeypatch)
    assert r.outcome == "error" and r.passed is False


def test_failed_repair_has_no_branch_or_commit(runner, monkeypatch):
    r = run(runner, "failed", monkeypatch)
    assert r.outcome == "failed"
    assert r.branch is None and r.commit_sha is None
