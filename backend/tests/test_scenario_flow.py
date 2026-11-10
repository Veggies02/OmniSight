"""Scenarios (contract v2, part 2): approve, reject and repair ONE scenario at a time.

The capture, the proposal pipeline and the repair CLI are all fakes: no Node, browser or network.
"""
import json
import sys

import pytest
from fastapi.testclient import TestClient

from api import create_app
from job_schemas import JobStatus
from job_store import JobStore
from repair_runner import RepairRunner
from test_repair_report_v2 import FAKE_CLI
from test_scenarios import FakePipeline, FakeRunner, TWO

HEADERS = {"X-Operator-Token": "s3cret"}
A, B = "product-image-distortion", "low-contrast-text"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("OMNISIGHT_AUTO_PROPOSALS", raising=False)
    monkeypatch.delenv("FAKE_V2_MODE", raising=False)


@pytest.fixture()
def repair_runner(tmp_path):
    (tmp_path / "fake_cli.py").write_text(FAKE_CLI)
    return RepairRunner(repo_root=tmp_path, command=[sys.executable, str(tmp_path / "fake_cli.py")])


@pytest.fixture()
def client(tmp_path, repair_runner):
    app = create_app(
        db_path=tmp_path / "jobs.db", runner=FakeRunner(), repair_runner=repair_runner,
        operator_token="s3cret", proposal_pipeline=FakePipeline(),
    )
    return TestClient(app)


def new_job(client):
    created = client.post("/jobs", json={"website_url": "http://127.0.0.1:5173"})
    job_id = created.json()["job_id"]
    assert client.get(f"/jobs/{job_id}").json()["status"] == "repair_proposed"
    return job_id


def approve(client, job_id, sid, by="qa@omnisight.ai"):
    return client.post(f"/jobs/{job_id}/scenarios/{sid}/approval", json={"reviewed_by": by}, headers=HEADERS)


def reject(client, job_id, sid, reason="not a real defect", by="qa@omnisight.ai"):
    return client.post(
        f"/jobs/{job_id}/scenarios/{sid}/rejection", json={"reviewed_by": by, "reason": reason}, headers=HEADERS
    )


def repair(client, job_id, sid):
    return client.post(f"/jobs/{job_id}/scenarios/{sid}/repair", headers=HEADERS)


def job(client, job_id):
    return client.get(f"/jobs/{job_id}").json()


def scenario(client, job_id, sid):
    return client.get(f"/jobs/{job_id}/scenarios/{sid}").json()


# ------------------------------------------------------------------ approval
def test_approving_one_scenario_does_not_approve_the_other(client):
    job_id = new_job(client)
    r = approve(client, job_id, A)
    assert r.status_code == 200
    body = r.json()
    assert body["scenario_id"] == A and body["review_status"] == "approved"
    assert body["approval"]["reviewed_by"] == "qa@omnisight.ai" and body["approval"]["reviewed_at"]
    assert scenario(client, job_id, B)["review_status"] == "pending_review"
    j = job(client, job_id)
    assert j["status"] == "repair_proposed" and j["summary"]["approved"] == 1 and j["summary"]["pending_review"] == 1


def test_the_server_sets_the_approval_time_not_the_caller(client):
    job_id = new_job(client)
    r = client.post(
        f"/jobs/{job_id}/scenarios/{A}/approval",
        json={"reviewed_by": "qa", "reviewed_at": "1999-01-01T00:00:00Z"}, headers=HEADERS,
    )
    assert r.status_code == 200 and not r.json()["approval"]["reviewed_at"].startswith("1999")


def test_decisions_need_the_operator_token(tmp_path, repair_runner):
    def build(token):
        return TestClient(create_app(
            db_path=tmp_path / f"{token or 'none'}.db", runner=FakeRunner(), repair_runner=repair_runner,
            operator_token=token, proposal_pipeline=FakePipeline(),
        ))
    c = build("s3cret")
    job_id = new_job(c)
    for path, body in ((f"{A}/approval", {"reviewed_by": "x"}), (f"{A}/rejection", {"reviewed_by": "x", "reason": "y"}), (f"{A}/repair", None)):
        assert c.post(f"/jobs/{job_id}/scenarios/{path}", json=body).status_code == 401
        assert c.post(f"/jobs/{job_id}/scenarios/{path}", json=body, headers={"X-Operator-Token": "wrong"}).status_code == 401
    disabled = build("")
    jid = disabled.post("/jobs", json={"website_url": "http://127.0.0.1:5173"}).json()["job_id"]
    assert disabled.post(f"/jobs/{jid}/scenarios/{A}/approval", json={"reviewed_by": "x"}, headers=HEADERS).status_code == 503


def test_bad_decisions_are_refused(client):
    job_id = new_job(client)
    assert approve(client, job_id, A).status_code == 200
    assert approve(client, job_id, A).status_code == 409  # twice
    assert approve(client, "job-nope", A).status_code == 404
    assert approve(client, job_id, "no-such-scenario").status_code == 404
    assert approve(client, job_id, B, by="   ").status_code == 422
    assert client.post(f"/jobs/{job_id}/scenarios/{B}/approval", json={}, headers=HEADERS).status_code == 422
    assert reject(client, job_id, B, reason="  ").status_code == 422
    assert reject(client, job_id, B, reason="").status_code == 422


# ----------------------------------------------------------------- rejection
def test_rejecting_a_scenario_records_who_why_and_when(client):
    job_id = new_job(client)
    r = reject(client, job_id, A, reason="intended design")
    assert r.status_code == 200
    body = r.json()
    assert body["review_status"] == "rejected" and body["repair_state"] == "rejected"
    assert body["rejection"]["reason"] == "intended design" and body["rejection"]["reviewed_at"]
    assert job(client, job_id)["status"] == "repair_proposed"  # the other scenario is still open
    assert reject(client, job_id, A).status_code == 409
    assert approve(client, job_id, A).status_code == 409  # a rejected scenario cannot be approved
    assert repair(client, job_id, A).status_code == 409


def test_rejecting_every_scenario_completes_the_job(client):
    job_id = new_job(client)
    reject(client, job_id, A)
    assert job(client, job_id)["status"] == "repair_proposed"
    reject(client, job_id, B)
    j = job(client, job_id)
    assert j["status"] == "completed" and j["stage"] == "done" and j["outcome"] == "all_rejected"
    assert j["summary"]["rejected"] == 2 and j["summary"]["pending_review"] == 0
    assert approve(client, job_id, A).status_code == 409  # nothing can be decided on a completed job


# -------------------------------------------------------------------- repair
def test_repair_needs_approval(client):
    job_id = new_job(client)
    assert repair(client, job_id, A).status_code == 409
    assert repair(client, job_id, "no-such-scenario").status_code == 404
    assert repair(client, "job-nope", A).status_code == 404
    assert scenario(client, job_id, A)["repair_state"] == "not_started"


def test_full_flow_both_scenarios_pass(client, tmp_path):
    job_id = new_job(client)
    approve(client, job_id, A)
    approve(client, job_id, B)

    r = repair(client, job_id, A)
    assert r.status_code == 202 and r.json()["status"] == "applying_patch" and r.json()["stage"] == "repairing"
    a = scenario(client, job_id, A)
    assert a["repair_state"] == "passed" and a["repair"]["outcome"] == "passed"
    rid = f"{job_id}--{A}"
    assert a["repair_job_id"] == rid and a["repair"]["job_id"] == rid
    assert a["repair"]["branch"] == f"omnisight-repair/{rid}" and len(a["repair"]["commit_sha"]) == 40
    assert scenario(client, job_id, B)["repair_state"] == "not_started"
    j = job(client, job_id)
    assert j["status"] == "repair_proposed" and j["stage"] == "awaiting_approval" and j["outcome"] is None

    # the CLI was given a proposal file approved by THIS scenario's approval record, under the derived id
    given = json.loads((tmp_path / "artifacts" / "repair-jobs" / rid / "proposal.json").read_text())
    assert given["humanReviewStatus"] == "approved" and given["reviewedBy"] == "qa@omnisight.ai"
    assert not (tmp_path / "artifacts" / "repair-jobs" / f"{job_id}--{B}").exists()  # B was not touched

    assert repair(client, job_id, B).status_code == 202
    j = job(client, job_id)
    assert j["status"] == "completed" and j["stage"] == "done" and j["outcome"] == "all_passed"
    assert j["summary"]["passed"] == 2 and j["summary"]["pending_review"] == 0
    assert j["error"] is None


def test_the_same_scenario_cannot_be_repaired_twice(client):
    job_id = new_job(client)
    approve(client, job_id, A)
    assert repair(client, job_id, A).status_code == 202
    assert repair(client, job_id, A).status_code == 409
    assert scenario(client, job_id, A)["repair_state"] == "passed"


@pytest.mark.parametrize(
    "mode, state, outcome",
    [("failed", "failed", "failed"), ("unsupported", "unsupported", "unsupported")],
)
def test_a_repair_that_does_not_pass_never_fails_the_job(client, monkeypatch, mode, state, outcome):
    monkeypatch.setenv("FAKE_V2_MODE", mode)
    job_id = new_job(client)
    approve(client, job_id, A)
    reject(client, job_id, B)
    repair(client, job_id, A)
    assert scenario(client, job_id, A)["repair_state"] == state
    assert scenario(client, job_id, A)["repair"]["outcome"] == outcome
    j = job(client, job_id)
    assert j["status"] == "completed" and j["error"] is None and j["outcome"] == "all_failed"


def test_a_cli_that_exits_zero_without_passing_is_an_error_not_unsupported(client, monkeypatch):
    monkeypatch.setenv("FAKE_V2_MODE", "unsupported_exit0")
    job_id = new_job(client)
    approve(client, job_id, A)
    repair(client, job_id, A)
    assert scenario(client, job_id, A)["repair_state"] == "error"
    assert job(client, job_id)["error"] is None


def test_mixed_results_give_a_partial_outcome(client, monkeypatch):
    job_id = new_job(client)
    approve(client, job_id, A)
    approve(client, job_id, B)
    repair(client, job_id, A)  # passes
    monkeypatch.setenv("FAKE_V2_MODE", "failed")
    repair(client, job_id, B)
    j = job(client, job_id)
    assert j["status"] == "completed" and j["outcome"] == "partial"
    assert j["summary"]["passed"] == 1 and j["summary"]["failed"] == 1


def test_a_crash_or_refusal_becomes_an_error_state(client, repair_runner, tmp_path):
    job_id = new_job(client)
    approve(client, job_id, A)
    approve(client, job_id, B)
    # B: the repair folder already exists, so the runner refuses ("a job ID can only be repaired once")
    (tmp_path / "artifacts" / "repair-jobs" / f"{job_id}--{B}").mkdir(parents=True)
    repair(client, job_id, B)
    b = scenario(client, job_id, B)
    assert b["repair_state"] == "error" and "already_ran" in b["repair"]["message"]
    # A: the runner blows up
    def boom(*args, **kwargs):
        raise RuntimeError("disk on fire")
    repair_runner.run = boom
    repair(client, job_id, A)
    a = scenario(client, job_id, A)
    assert a["repair_state"] == "error" and "disk on fire" in a["repair"]["message"]
    j = job(client, job_id)
    assert j["status"] == "completed" and j["outcome"] == "all_failed" and j["summary"]["error"] == 2


def test_only_one_scenario_of_a_job_repairs_at_a_time_but_decisions_stay_open(client, tmp_path):
    job_id = new_job(client)
    approve(client, job_id, A)
    store = JobStore(tmp_path / "jobs.db")
    store.claim_scenario_repair(job_id, A)  # A is now being repaired
    assert job(client, job_id)["status"] == "applying_patch"
    assert approve(client, job_id, B).status_code == 200  # a human can still decide on B
    waiting = repair(client, job_id, B)
    assert waiting.status_code == 409 and "Another scenario" in waiting.json()["detail"]  # B waits for A
    assert scenario(client, job_id, B)["repair_state"] == "not_started"
    reject_response = reject(client, job_id, A)           # a running scenario cannot be rejected
    assert reject_response.status_code == 409
    assert job(client, job_id)["status"] == "applying_patch"


def test_busy_repair_runner_is_refused_up_front(client, repair_runner):
    job_id = new_job(client)
    approve(client, job_id, A)
    repair_runner._lock.acquire()
    try:
        assert repair(client, job_id, A).status_code == 409
    finally:
        repair_runner._lock.release()
    assert scenario(client, job_id, A)["repair_state"] == "not_started"
    assert job(client, job_id)["status"] == "repair_proposed"


def test_losing_the_lock_race_puts_the_scenario_back(client, repair_runner, monkeypatch):
    job_id = new_job(client)
    approve(client, job_id, A)
    monkeypatch.setattr(repair_runner, "is_busy", lambda: False)  # the up-front check passes ...
    repair_runner._lock.acquire()                                  # ... but someone else holds the lock
    try:
        assert repair(client, job_id, A).status_code == 202
    finally:
        repair_runner._lock.release()
    assert scenario(client, job_id, A)["repair_state"] == "not_started"
    j = job(client, job_id)
    assert j["status"] == "repair_proposed" and j["stage"] == "awaiting_approval"
    monkeypatch.undo()
    assert repair(client, job_id, A).status_code == 202  # and it can be tried again
    assert scenario(client, job_id, A)["repair_state"] == "passed"


def test_old_single_proposal_endpoints_do_not_touch_scenario_jobs(client):
    job_id = new_job(client)
    assert client.post(f"/jobs/{job_id}/approval", json={"reviewed_by": "x"}, headers=HEADERS).status_code == 409
    assert client.post(f"/jobs/{job_id}/repair", headers=HEADERS).status_code == 409
    assert client.post(f"/jobs/{job_id}/proposal", json={"proposal": {"proposalId": "p"}}, headers=HEADERS).status_code == 409


def test_jobs_without_scenarios_are_not_affected(tmp_path, repair_runner):
    plain = TestClient(create_app(
        db_path=tmp_path / "plain.db", runner=FakeRunner(), repair_runner=repair_runner,
        operator_token="s3cret", proposal_pipeline=None,
    ))
    job_id = plain.post("/jobs", json={"website_url": "http://127.0.0.1:5173"}).json()["job_id"]
    assert plain.get(f"/jobs/{job_id}").json()["status"] == "analyzing"
    assert approve(plain, job_id, A).status_code == 404  # no scenarios, so no such scenario
    assert reject(plain, job_id, A).status_code == 404
    assert repair(plain, job_id, A).status_code == 404
    assert plain.get(f"/jobs/{job_id}").json()["status"] == "analyzing"