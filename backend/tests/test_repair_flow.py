"""Tests for the proposal -> approval -> repair flow in api.py (stage field, token, approval gate).

The repair CLI is replaced by the same fake used in test_repair_runner.py, so no Node, browser
or Git is needed. Starlette's TestClient runs background tasks before it returns, so after
POST .../repair the job has already reached completed or failed.
Run from the backend/ folder:   pytest -v
"""
import json
import sqlite3
import sys

import pytest
from fastapi.testclient import TestClient

from api import create_app, run_repair
from browser_runner import MockBrowserRunner
from job_schemas import JobStatus
from job_store import JobStore
from repair_runner import RepairRunner
from test_repair_runner import FAKE_CLI

SITE = "https://example.com"
TOKEN = "test-operator-token"
HEADERS = {"X-Operator-Token": TOKEN}
PROPOSAL = {"proposalId": "prop-1", "scenarioId": "product-image-distortion"}


@pytest.fixture()
def repo(tmp_path):
    (tmp_path / "fake_cli.py").write_text(FAKE_CLI)
    return tmp_path


@pytest.fixture()
def repairer(repo):
    return RepairRunner(repo_root=repo, command=[sys.executable, str(repo / "fake_cli.py")])


@pytest.fixture()
def db_path(tmp_path_factory):
    return tmp_path_factory.mktemp("db") / "jobs.db"


@pytest.fixture()
def client(db_path, repairer):
    app = create_app(
        db_path=db_path, runner=MockBrowserRunner(), repair_runner=repairer, operator_token=TOKEN
    )
    return TestClient(app)


def analyzed_job(client) -> str:
    """A job that finished the (mock) inspection and is waiting at 'analyzing'."""
    created = client.post("/jobs", json={"website_url": SITE})
    assert created.status_code == 201
    return created.json()["job_id"]


def job_with_proposal(client) -> str:
    job_id = analyzed_job(client)
    response = client.post(f"/jobs/{job_id}/proposal", json={"proposal": PROPOSAL}, headers=HEADERS)
    assert response.status_code == 200
    return job_id


def approved_job(client) -> str:
    job_id = job_with_proposal(client)
    response = client.post(f"/jobs/{job_id}/approval", json={"reviewed_by": "qa@omnisight.ai"}, headers=HEADERS)
    assert response.status_code == 200
    return job_id


# ------------------------------------------------------------------ stage
def test_stage_follows_the_job_and_is_in_every_response(client):
    created = client.post("/jobs", json={"website_url": SITE}).json()
    assert created["stage"] == "queued"  # snapshot at creation
    job = client.get(f"/jobs/{created['job_id']}").json()
    assert job["status"] == "analyzing" and job["stage"] == "analyzing"
    assert client.get("/jobs").json()["items"][0]["stage"] == "analyzing"


def test_old_database_without_stage_is_upgraded_and_backfilled(tmp_path, repairer):
    db = tmp_path / "old.db"
    with sqlite3.connect(db) as connection:
        connection.execute(
            "CREATE TABLE jobs (job_id TEXT PRIMARY KEY, website_url TEXT NOT NULL, status TEXT NOT NULL)"
        )
        connection.execute("INSERT INTO jobs VALUES ('job-old', 'https://example.com/', 'analyzing')")
        connection.execute("INSERT INTO jobs VALUES ('job-done', 'https://example.com/', 'failed')")
    connection.close()

    client = TestClient(create_app(db_path=db, runner=MockBrowserRunner(), repair_runner=repairer, operator_token=TOKEN))
    old = client.get("/jobs/job-old").json()
    assert old["stage"] == "analyzing"
    assert old["proposal"] is None and old["approval"] is None and old["repair"] is None
    assert client.get("/jobs/job-done").json()["stage"] is None  # terminal statuses keep no stage


# ------------------------------------------------------------ the token
def test_repair_endpoints_are_disabled_when_no_token_is_configured(db_path, repairer, monkeypatch):
    monkeypatch.delenv("OMNISIGHT_OPERATOR_TOKEN", raising=False)
    client = TestClient(create_app(db_path=db_path, runner=MockBrowserRunner(), repair_runner=repairer))
    job_id = analyzed_job(client)
    for path, body in (
        ("proposal", {"proposal": PROPOSAL}),
        ("approval", {"reviewed_by": "someone"}),
        ("repair", None),
    ):
        response = client.post(f"/jobs/{job_id}/{path}", json=body, headers=HEADERS)
        assert response.status_code == 503, path
    assert client.get(f"/jobs/{job_id}").json()["status"] == "analyzing"  # nothing changed


@pytest.mark.parametrize("headers", [{}, {"X-Operator-Token": "wrong"}, {"X-Operator-Token": ""}])
def test_missing_or_wrong_token_is_rejected_on_all_three_endpoints(client, headers):
    job_id = analyzed_job(client)
    for path, body in (
        ("proposal", {"proposal": PROPOSAL}),
        ("approval", {"reviewed_by": "someone"}),
        ("repair", None),
    ):
        assert client.post(f"/jobs/{job_id}/{path}", json=body, headers=headers).status_code == 401, path
    assert client.get(f"/jobs/{job_id}").json()["status"] == "analyzing"


# --------------------------------------------------------------- proposal
def test_attaching_a_proposal_resets_any_review_claims_inside_it(client):
    job_id = analyzed_job(client)
    sneaky = dict(PROPOSAL, humanReviewStatus="approved", reviewedBy="attacker", reviewedAt="1999-01-01")
    response = client.post(f"/jobs/{job_id}/proposal", json={"proposal": sneaky}, headers=HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "repair_proposed" and body["stage"] == "awaiting_approval"
    assert body["proposal"]["humanReviewStatus"] == "pending_review"
    assert "reviewedBy" not in body["proposal"] and "reviewedAt" not in body["proposal"]
    assert body["approval"] is None


def test_proposal_validation_and_state_rules(client):
    job_id = analyzed_job(client)
    assert client.post(f"/jobs/{job_id}/proposal", json={"proposal": {"scenarioId": "x"}}, headers=HEADERS).status_code == 422
    assert client.post(f"/jobs/{job_id}/proposal", json={"proposal": {"proposalId": ""}}, headers=HEADERS).status_code == 422
    assert client.post("/jobs/job-nope/proposal", json={"proposal": PROPOSAL}, headers=HEADERS).status_code == 404
    assert client.post(f"/jobs/{job_id}/proposal", json={"proposal": PROPOSAL}, headers=HEADERS).status_code == 200
    # a second proposal on the same job is refused
    assert client.post(f"/jobs/{job_id}/proposal", json={"proposal": PROPOSAL}, headers=HEADERS).status_code == 409


# -------------------------------------------------------------- approval
def test_approval_needs_a_proposal_is_once_only_and_uses_a_server_timestamp(client):
    job_id = analyzed_job(client)
    # no proposal yet
    assert client.post(f"/jobs/{job_id}/approval", json={"reviewed_by": "qa"}, headers=HEADERS).status_code == 409

    client.post(f"/jobs/{job_id}/proposal", json={"proposal": PROPOSAL}, headers=HEADERS)
    forged = {"reviewed_by": "qa@omnisight.ai", "reviewed_at": "1999-01-01T00:00:00Z"}
    response = client.post(f"/jobs/{job_id}/approval", json=forged, headers=HEADERS)
    assert response.status_code == 200
    approval = response.json()["approval"]
    assert approval["reviewed_by"] == "qa@omnisight.ai"
    assert approval["reviewed_at"] != "1999-01-01T00:00:00Z"  # the client cannot choose the time
    assert response.json()["status"] == "repair_proposed"  # approving does not run anything

    assert client.post(f"/jobs/{job_id}/approval", json={"reviewed_by": "someone else"}, headers=HEADERS).status_code == 409
    assert client.get(f"/jobs/{job_id}").json()["approval"]["reviewed_by"] == "qa@omnisight.ai"
    assert client.post(f"/jobs/{job_id}/approval", json={"reviewed_by": ""}, headers=HEADERS).status_code in (409, 422)


# ---------------------------------------------------------------- repair
def test_repair_is_refused_without_approval_and_nothing_is_launched(client, repo):
    job_id = job_with_proposal(client)
    response = client.post(f"/jobs/{job_id}/repair", headers=HEADERS)
    assert response.status_code == 409
    assert "approved" in response.json()["detail"]
    assert client.get(f"/jobs/{job_id}").json()["status"] == "repair_proposed"
    assert not (repo / "artifacts").exists() and not (repo / "seen_args.json").exists()


def test_repair_is_refused_before_a_proposal_exists(client):
    job_id = analyzed_job(client)
    assert client.post(f"/jobs/{job_id}/repair", headers=HEADERS).status_code == 409
    assert client.post("/jobs/job-nope/repair", headers=HEADERS).status_code == 404


def test_full_flow_passes_and_the_result_is_stored_on_the_job(client, repo):
    job_id = approved_job(client)
    response = client.post(f"/jobs/{job_id}/repair", headers=HEADERS)
    assert response.status_code == 202
    assert response.json()["status"] == "applying_patch" and response.json()["stage"] == "repairing"

    job = client.get(f"/jobs/{job_id}").json()
    assert job["status"] == "completed"
    assert job["error"] is None
    assert job["repair"]["outcome"] == "passed" and job["repair"]["passed"] is True
    assert (job["repair"]["build_passed"], job["repair"]["test_passed"], job["repair"]["visual_passed"]) == (True, True, True)
    assert job["repair"]["cleanup"]["worktreeRemoved"] is True
    uris = {a["uri"] for a in job["artifacts"]}
    assert f"artifacts/repair-jobs/{job_id}/proposal.json" in uris
    assert f"artifacts/repair-executions/{job_id}/repair_execution_report.json" in uris

    # the CLI saw an approval written from the stored record, not from the caller's data
    seen = json.loads((repo / "seen_proposal.json").read_text())
    assert seen["humanReviewStatus"] == "approved"
    assert seen["reviewedBy"] == "qa@omnisight.ai"
    assert seen["reviewedAt"] == job["approval"]["reviewed_at"]


def test_failed_repair_marks_the_job_failed_and_keeps_the_reason(client, monkeypatch):
    monkeypatch.setenv("FAKE_REPAIR_MODE", "build_fail")
    job_id = approved_job(client)
    assert client.post(f"/jobs/{job_id}/repair", headers=HEADERS).status_code == 202
    job = client.get(f"/jobs/{job_id}").json()
    assert job["status"] == "failed"
    assert "Build failed" in job["error"]
    assert job["repair"]["outcome"] == "failed" and job["repair"]["build_passed"] is False


def test_a_repair_cannot_be_started_twice(client):
    job_id = approved_job(client)
    assert client.post(f"/jobs/{job_id}/repair", headers=HEADERS).status_code == 202
    assert client.post(f"/jobs/{job_id}/repair", headers=HEADERS).status_code == 409
    assert client.get(f"/jobs/{job_id}").json()["status"] == "completed"


def test_a_busy_repair_runner_gives_409_and_leaves_the_job_untouched(client, repairer):
    job_id = approved_job(client)
    assert repairer._lock.acquire(blocking=False)
    try:
        response = client.post(f"/jobs/{job_id}/repair", headers=HEADERS)
    finally:
        repairer._lock.release()
    assert response.status_code == 409
    assert client.get(f"/jobs/{job_id}").json()["status"] == "repair_proposed"


def test_a_refusal_by_the_runner_is_recorded_as_a_failed_job(client, repo):
    job_id = approved_job(client)
    (repo / "artifacts" / "repair-jobs" / job_id).mkdir(parents=True)  # a previous run left files
    assert client.post(f"/jobs/{job_id}/repair", headers=HEADERS).status_code == 202
    job = client.get(f"/jobs/{job_id}").json()
    assert job["status"] == "failed"
    assert "already_ran" in job["error"]
    assert not (repo / "seen_args.json").exists()  # the CLI never started


def test_the_background_task_refuses_to_run_without_a_stored_approval(db_path, repairer, repo):
    """Second line of defence: even if the HTTP check were bypassed, nothing runs without approval."""
    store = JobStore(db_path)
    job_id = store.create_job(SITE)["job_id"]
    store.update_status(job_id, JobStatus.INSPECTING)
    store.update_status(job_id, JobStatus.ANALYZING)
    store.update_status(job_id, JobStatus.REPAIR_PROPOSED, proposal=dict(PROPOSAL, humanReviewStatus="approved"))
    store.update_status(job_id, JobStatus.APPLYING_PATCH)  # claimed, but never approved

    run_repair(store, repairer, job_id)

    job = store.get_job(job_id)
    assert job["status"] == "failed"
    assert "not_approved" in job["error"]
    assert not (repo / "seen_args.json").exists() and not (repo / "artifacts").exists()


def test_repair_endpoints_also_work_under_the_api_prefix(client):
    job_id = analyzed_job(client)
    response = client.post(f"/api/jobs/{job_id}/proposal", json={"proposal": PROPOSAL}, headers=HEADERS)
    assert response.status_code == 200
    assert client.post(f"/api/jobs/{job_id}/approval", json={"reviewed_by": "qa"}, headers=HEADERS).status_code == 200
    assert client.post(f"/api/jobs/{job_id}/repair", headers=HEADERS).status_code == 202
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "completed"