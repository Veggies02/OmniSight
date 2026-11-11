"""Scenarios (contract v2, part 4): a proposal the generator did not mark 'proposed' is never actionable."""
import sys

import pytest
from fastapi.testclient import TestClient

from api import create_app
from repair_runner import RepairRunner
from test_repair_report_v2 import FAKE_CLI
from test_scenario_flow import HEADERS, approve, job, reject, repair, scenario
from test_scenarios import FakePipeline, FakeRunner, proposal

GOOD, BAD, BAD2 = "mobile-nav-overflow", "product-image-distortion", "low-contrast-text"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("OMNISIGHT_AUTO_PROPOSALS", raising=False)
    monkeypatch.delenv("FAKE_V2_MODE", raising=False)


def unsupported(sid, status="unsupported_category"):
    return proposal(sid, status=status, defectCategory="unknown")


def make(tmp_path, proposals):
    (tmp_path / "fake_cli.py").write_text(FAKE_CLI)
    runner = RepairRunner(repo_root=tmp_path, command=[sys.executable, str(tmp_path / "fake_cli.py")])
    app = create_app(
        db_path=tmp_path / "jobs.db", runner=FakeRunner(), repair_runner=runner, operator_token="s3cret",
        proposal_pipeline=FakePipeline(proposals=proposals),
    )
    client = TestClient(app)
    return client, client.post("/jobs", json={"website_url": "http://127.0.0.1:5173"}).json()["job_id"]


MIXED = {GOOD: proposal(GOOD), BAD: unsupported(BAD), BAD2: unsupported(BAD2)}


def test_an_unsupported_proposal_is_stored_as_unsupported_and_not_waiting_for_anyone(tmp_path):
    client, job_id = make(tmp_path, MIXED)
    for sid in (BAD, BAD2):
        s = scenario(client, job_id, sid)
        assert s["repair_state"] == "unsupported" and s["review_status"] == "not_applicable"
        assert s["proposal"]["status"] == "unsupported_category"  # kept as generated, never relabelled
    assert scenario(client, job_id, GOOD)["review_status"] == "pending_review"
    j = job(client, job_id)
    assert j["status"] == "repair_proposed" and j["outcome"] is None
    assert j["summary"]["total"] == 3 and j["summary"]["pending_review"] == 1 and j["summary"]["unsupported"] == 2


def test_the_job_finishes_when_the_one_supported_scenario_is_repaired(tmp_path):
    client, job_id = make(tmp_path, MIXED)
    assert approve(client, job_id, GOOD).status_code == 200
    assert repair(client, job_id, GOOD).status_code == 202
    j = job(client, job_id)
    assert scenario(client, job_id, GOOD)["repair_state"] == "passed"
    assert j["status"] == "completed" and j["stage"] == "done"
    assert j["outcome"] == "all_passed"  # the unsupported two do not turn a good result into 'partial'
    assert j["summary"]["unsupported"] == 2 and j["summary"]["passed"] == 1


def test_rejecting_the_supported_one_ends_the_job_as_all_rejected(tmp_path):
    client, job_id = make(tmp_path, MIXED)
    assert reject(client, job_id, GOOD).status_code == 200
    j = job(client, job_id)
    assert j["status"] == "completed" and j["outcome"] == "all_rejected"


@pytest.mark.parametrize("action", ["approve", "reject", "repair"])
def test_an_unsupported_scenario_can_not_be_approved_rejected_or_repaired(tmp_path, action):
    client, job_id = make(tmp_path, MIXED)
    r = {"approve": approve, "reject": reject, "repair": repair}[action](client, job_id, BAD)
    assert r.status_code == 409
    if action != "repair":
        assert "no supported repair" in r.json()["detail"]
    s = scenario(client, job_id, BAD)
    assert s["repair_state"] == "unsupported" and s["review_status"] == "not_applicable" and s["approval"] is None
    assert not (tmp_path / "seen_args.json").exists()  # the repair CLI never ran


def test_an_unsupported_scenario_never_gets_a_pull_request(tmp_path):
    client, job_id = make(tmp_path, MIXED)
    assert client.post(f"/jobs/{job_id}/scenarios/{BAD}/pr", json={}, headers=HEADERS).status_code == 409


def test_a_job_with_nothing_actionable_completes_at_once(tmp_path):
    client, job_id = make(tmp_path, {BAD: unsupported(BAD), BAD2: unsupported(BAD2, "inconclusive")})
    j = job(client, job_id)
    assert j["status"] == "completed" and j["stage"] == "done" and j["outcome"] == "no_repairs_needed"
    assert j["summary"]["unsupported"] == 2 and j["summary"]["pending_review"] == 0


@pytest.mark.parametrize("status", [None, "", "PROPOSED", "proposed ", "approved", "unsupported_category", 1])
def test_only_the_exact_status_proposed_is_actionable(tmp_path, status):
    p = proposal(GOOD)
    p.pop("status")
    if status is not None:
        p["status"] = status
    client, job_id = make(tmp_path, {GOOD: p})
    assert scenario(client, job_id, GOOD)["repair_state"] == "unsupported"
    assert approve(client, job_id, GOOD).status_code == 409


def test_a_supported_scenario_is_unaffected(tmp_path):
    client, job_id = make(tmp_path, {GOOD: proposal(GOOD)})
    s = scenario(client, job_id, GOOD)
    assert s["repair_state"] == "not_started" and s["review_status"] == "pending_review"
