"""Scenarios (contract v2, part 5): approval is bound to one exact proposal through its digest."""
import json
import sys

import pytest
from fastapi.testclient import TestClient

from api import create_app
from job_store import JobStore
from proposal_digest import proposal_digest
from repair_runner import RepairRunner
from scenario_logic import repair_job_id
from test_repair_report_v2 import FAKE_CLI
from test_scenario_flow import HEADERS, job, repair, scenario
from test_scenarios import FakePipeline, FakeRunner, proposal

GOOD, OTHER = "mobile-nav-overflow", "product-image-distortion"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("OMNISIGHT_AUTO_PROPOSALS", raising=False)
    monkeypatch.delenv("FAKE_V2_MODE", raising=False)
    monkeypatch.delenv("OMNISIGHT_REQUIRE_APPROVAL_DIGEST", raising=False)


def make(tmp_path, proposals=None):
    (tmp_path / "fake_cli.py").write_text(FAKE_CLI)
    runner = RepairRunner(repo_root=tmp_path, command=[sys.executable, str(tmp_path / "fake_cli.py")])
    app = create_app(
        db_path=tmp_path / "jobs.db", runner=FakeRunner(), repair_runner=runner, operator_token="s3cret",
        proposal_pipeline=FakePipeline(proposals=proposals or {GOOD: proposal(GOOD), OTHER: proposal(OTHER)}),
    )
    client = TestClient(app)
    job_id = client.post("/jobs", json={"website_url": "http://127.0.0.1:5173"}).json()["job_id"]
    return client, job_id, runner


def post(client, job_id, sid, **body):
    body.setdefault("reviewed_by", "qa@omnisight.ai")
    return client.post(f"/jobs/{job_id}/scenarios/{sid}/approval", json=body, headers=HEADERS)


def shown_digest(client, job_id, sid=GOOD):
    return scenario(client, job_id, sid)["proposal_digest"]


def test_the_scenario_shows_the_digest_of_its_stored_proposal(tmp_path):
    client, job_id, _ = make(tmp_path)
    s = scenario(client, job_id, GOOD)
    assert s["proposal_digest"] == proposal_digest(s["proposal"]) and len(s["proposal_digest"]) == 64
    assert job(client, job_id)["scenarios"][0]["proposal_digest"]
    assert shown_digest(client, job_id, GOOD) != shown_digest(client, job_id, OTHER)


def test_a_matching_digest_approves_and_is_stored_with_the_approval(tmp_path):
    client, job_id, _ = make(tmp_path)
    d = shown_digest(client, job_id)
    r = post(client, job_id, GOOD, patch_digest_sha256=d.upper())
    assert r.status_code == 200
    a = r.json()["approval"]
    assert a["patch_digest_sha256"] == d and a["digest_verified"] is True and a["proposal_id"] == f"prop-{GOOD}"
    assert a["reviewed_by"] == "qa@omnisight.ai" and a["reviewed_at"]


def test_a_missing_digest_is_refused_and_nothing_is_approved(tmp_path):
    client, job_id, _ = make(tmp_path)
    r = post(client, job_id, GOOD)
    assert r.status_code == 422 and "patch_digest_sha256" in r.json()["detail"]
    s = scenario(client, job_id, GOOD)
    assert s["review_status"] == "pending_review" and s["approval"] is None


@pytest.mark.parametrize("bad", ["nope", "0" * 63, "z" * 64])
def test_a_malformed_digest_is_refused(tmp_path, bad):
    client, job_id, _ = make(tmp_path)
    assert post(client, job_id, GOOD, patch_digest_sha256=bad).status_code == 422


def test_an_altered_digest_is_refused(tmp_path):
    client, job_id, _ = make(tmp_path)
    r = post(client, job_id, GOOD, patch_digest_sha256="0" * 64)
    assert r.status_code == 409
    assert scenario(client, job_id, GOOD)["review_status"] == "pending_review"


def test_the_digest_of_another_scenarios_proposal_is_refused(tmp_path):
    client, job_id, _ = make(tmp_path)
    assert post(client, job_id, GOOD, patch_digest_sha256=shown_digest(client, job_id, OTHER)).status_code == 409


def test_a_stale_digest_is_refused_after_the_stored_proposal_changed(tmp_path):
    client, job_id, _ = make(tmp_path)
    shown = shown_digest(client, job_id)
    store = JobStore(tmp_path / "jobs.db")
    changed = scenario(client, job_id, GOOD)["proposal"]
    changed["proposedCorrection"] = {"patchId": "something-else"}
    with store._connect() as db:
        db.execute("UPDATE scenarios SET proposal = ? WHERE job_id = ? AND scenario_id = ?", (json.dumps(changed), job_id, GOOD))
    r = post(client, job_id, GOOD, patch_digest_sha256=shown)
    assert r.status_code == 409 and "changed" in r.json()["detail"]


def test_binding_fields_in_the_proposal_must_fit_the_scenario_and_run(tmp_path):
    bad = {GOOD: proposal(GOOD, registeredPatchId="patch-low-contrast-text-003"), OTHER: proposal(OTHER, runId="run-OTHER")}
    client, job_id, _ = make(tmp_path, bad)
    for sid in (GOOD, OTHER):
        assert post(client, job_id, sid, patch_digest_sha256=shown_digest(client, job_id, sid)).status_code == 409


def test_a_proposal_bound_to_this_run_and_patch_is_accepted_and_the_binding_is_stored(tmp_path):
    good = proposal(GOOD, runId="run-1", attemptId="attempt-1-abc", registeredPatchId="patch-mobile-nav-overflow-004")
    client, job_id, _ = make(tmp_path, {GOOD: good})
    r = post(client, job_id, GOOD, patch_digest_sha256=shown_digest(client, job_id))
    assert r.status_code == 200
    a = r.json()["approval"]
    assert (a["run_id"], a["attempt_id"], a["registered_patch_id"]) == ("run-1", "attempt-1-abc", "patch-mobile-nav-overflow-004")


def test_the_repair_cli_gets_the_verified_digest_as_approval_digest(tmp_path):
    client, job_id, runner = make(tmp_path)
    d = shown_digest(client, job_id)
    assert post(client, job_id, GOOD, patch_digest_sha256=d).status_code == 200
    assert repair(client, job_id, GOOD).status_code == 202
    assert scenario(client, job_id, GOOD)["repair_state"] == "passed"
    written = json.loads((runner.job_dir(repair_job_id(job_id, GOOD)) / "proposal.json").read_text())
    assert written["approvalDigest"] == d and written["proposalDigest"] == d
    assert written["humanReviewStatus"] == "approved" and written["reviewedBy"] == "qa@omnisight.ai"
    assert proposal_digest(written) == d  # approving added nothing the digest covers


def test_a_proposal_changed_after_approval_is_never_repaired(tmp_path):
    client, job_id, runner = make(tmp_path)
    assert post(client, job_id, GOOD, patch_digest_sha256=shown_digest(client, job_id)).status_code == 200
    store = JobStore(tmp_path / "jobs.db")
    changed = scenario(client, job_id, GOOD)["proposal"]
    changed["proposedCorrection"] = {"patchId": "tampered"}
    with store._connect() as db:
        db.execute("UPDATE scenarios SET proposal = ? WHERE job_id = ? AND scenario_id = ?", (json.dumps(changed), job_id, GOOD))
    repair(client, job_id, GOOD)
    s = scenario(client, job_id, GOOD)
    assert s["repair_state"] == "error" and not runner.job_dir(repair_job_id(job_id, GOOD)).exists()
    assert not (tmp_path / "seen_args.json").exists()


def test_the_requirement_can_be_switched_off_but_the_approval_is_marked_unverified(tmp_path, monkeypatch):
    monkeypatch.setenv("OMNISIGHT_REQUIRE_APPROVAL_DIGEST", "0")
    client, job_id, runner = make(tmp_path)
    r = post(client, job_id, GOOD)
    assert r.status_code == 200 and r.json()["approval"]["digest_verified"] is False
    assert post(client, job_id, OTHER, patch_digest_sha256="0" * 64).status_code == 409  # a wrong one still fails
    assert repair(client, job_id, GOOD).status_code == 202
    assert scenario(client, job_id, GOOD)["repair_state"] == "passed"
    written = json.loads((runner.job_dir(repair_job_id(job_id, GOOD)) / "proposal.json").read_text())
    assert "approvalDigest" not in written


def test_an_unverified_approval_cannot_be_repaired_once_the_requirement_is_back_on(tmp_path, monkeypatch):
    monkeypatch.setenv("OMNISIGHT_REQUIRE_APPROVAL_DIGEST", "0")
    client, job_id, runner = make(tmp_path)
    assert post(client, job_id, GOOD).status_code == 200
    monkeypatch.delenv("OMNISIGHT_REQUIRE_APPROVAL_DIGEST")
    repair(client, job_id, GOOD)
    assert scenario(client, job_id, GOOD)["repair_state"] == "error"
    assert not (tmp_path / "seen_args.json").exists()


def test_an_unsupported_scenario_still_says_so_without_a_digest(tmp_path):
    client, job_id, _ = make(tmp_path, {GOOD: proposal(GOOD), OTHER: proposal(OTHER, status="unsupported_category")})
    r = post(client, job_id, OTHER)
    assert r.status_code == 409 and "no supported repair" in r.json()["detail"]
