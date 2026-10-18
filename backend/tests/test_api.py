"""Week 1 endpoint, persistence, webhook and state-machine tests.

Run from the backend/ folder:   pytest -v
Each test gets its own temporary database, so nothing touches backend/jobs.db.
Starlette's TestClient runs FastAPI background tasks before it returns, so after a
POST the job has already moved on from "queued" (that is what the tests check).
"""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from api import create_app
from browser_runner import MockBrowserRunner, runner_from_env
from job_schemas import ALLOWED_TRANSITIONS, InvalidTransitionError, JobStatus, check_transition

SITE = "https://example.com"
CI_EVENT = {
    "event_type": "build_success",
    "website_url": SITE,
    "repository": "Veggies02/OmniSight",
    "commit_sha": "5619e0c",
}


@pytest.fixture()
def db_path(tmp_path):
    return tmp_path / "test_jobs.db"


@pytest.fixture()
def client(db_path):
    return TestClient(create_app(db_path=db_path, runner=MockBrowserRunner()))


class ExplodingRunner:
    mode = "mock"
    disclaimer = "test runner that always fails"

    def run(self, job_id, website_url):
        raise RuntimeError("browser crashed")


# ------------------------------------------------------------------ health
def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# ------------------------------------------------------------- POST /jobs
def test_create_job_returns_unique_ids_and_queued_snapshot(client):
    first = client.post("/jobs", json={"website_url": SITE})
    second = client.post("/jobs", json={"website_url": SITE})
    assert first.status_code == 201
    body = first.json()
    assert body["job_id"].startswith("job-")
    assert body["status"] == "queued"
    assert body["source"] == "manual"
    assert body["website_url"].startswith("https://example.com")
    assert first.json()["job_id"] != second.json()["job_id"]


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"website_url": ""},
        {"website_url": "not-a-url"},
        {"website_url": "ftp://example.com"},
        {"website_url": 123},
        {"wrong_field": SITE},
    ],
)
def test_create_job_rejects_invalid_input(client, payload):
    assert client.post("/jobs", json=payload).status_code == 422


def test_create_job_accepts_target_url_alias(client):
    assert client.post("/jobs", json={"target_url": SITE}).status_code == 201


# ---------------------------------------------------- GET /jobs/{job_id}
def test_unknown_job_is_404(client):
    response = client.get("/jobs/job-does-not-exist")
    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found"


def test_job_moves_to_analyzing_with_labelled_mock_result(client):
    job_id = client.post("/jobs", json={"website_url": SITE}).json()["job_id"]
    job = client.get(f"/jobs/{job_id}").json()
    assert job["status"] == "analyzing"
    assert job["inspection"]["mode"] == "mock"
    assert job["inspection"]["executed"] is False
    assert "MOCK" in job["inspection"]["message"]
    assert len(job["artifacts"]) == 1
    assert job["artifacts"][0]["mock"] is True
    assert job["artifacts"][0]["uri"].startswith("mock://")


def test_artifacts_endpoint(client):
    job_id = client.post("/jobs", json={"website_url": SITE}).json()["job_id"]
    response = client.get(f"/jobs/{job_id}/artifacts")
    assert response.status_code == 200
    assert response.json()[0]["kind"] == "screenshot"
    assert client.get("/jobs/job-nope/artifacts").status_code == 404


# ------------------------------------------------------------ persistence
def test_jobs_survive_a_server_restart(db_path):
    first_app = TestClient(create_app(db_path=db_path, runner=MockBrowserRunner()))
    job_id = first_app.post("/jobs", json={"website_url": SITE}).json()["job_id"]

    # "Restart": build a brand-new app on the same database file.
    second_app = TestClient(create_app(db_path=db_path, runner=MockBrowserRunner()))
    response = second_app.get(f"/jobs/{job_id}")
    assert response.status_code == 200
    assert response.json()["job_id"] == job_id
    assert len(response.json()["artifacts"]) == 1


def test_old_three_column_database_is_upgraded_in_place(db_path):
    # The original schema from the first version of main.py.
    with sqlite3.connect(db_path) as db:
        db.execute(
            "CREATE TABLE jobs (job_id TEXT PRIMARY KEY, website_url TEXT NOT NULL, status TEXT NOT NULL)"
        )
        db.execute("INSERT INTO jobs VALUES ('job-old-1', 'https://example.com/', 'queued')")
    db.close()

    app = TestClient(create_app(db_path=db_path, runner=MockBrowserRunner()))
    response = app.get("/jobs/job-old-1")
    assert response.status_code == 200
    job = response.json()
    assert job["status"] == "queued"
    assert job["source"] == "manual"
    assert job["created_at"] and job["updated_at"]
    assert job["artifacts"] == []


# ------------------------------------------------------------- GET /jobs
def test_list_jobs_with_pagination_and_status_filter(client):
    for _ in range(3):
        client.post("/jobs", json={"website_url": SITE})

    everything = client.get("/jobs").json()
    assert everything["total"] == 3 and len(everything["items"]) == 3

    page = client.get("/jobs", params={"limit": 2, "offset": 0}).json()
    assert len(page["items"]) == 2 and page["total"] == 3

    assert client.get("/jobs", params={"status": "analyzing"}).json()["total"] == 3
    assert client.get("/jobs", params={"status": "failed"}).json()["total"] == 0
    assert client.get("/jobs", params={"status": "bogus"}).status_code == 422
    assert client.get("/jobs", params={"limit": 0}).status_code == 422


# -------------------------------------------------------- POST /webhooks/ci
def test_webhook_creates_job_and_keeps_response_contract(client):
    response = client.post("/webhooks/ci", json=CI_EVENT)
    assert response.status_code == 201
    body = response.json()
    assert body["message"] == "CI event received; inspection job queued"
    assert body["status"] == "queued"
    assert body["repository"] == "Veggies02/OmniSight"
    assert body["commit_sha"] == "5619e0c"
    assert body["browser_result"]["type"] == "mock"
    assert body["browser_result"]["executed"] is False
    assert "MOCK" in body["browser_result"]["message"]

    job = client.get(f"/jobs/{body['job_id']}").json()
    assert job["source"] == "ci_webhook"
    assert job["repository"] == "Veggies02/OmniSight"
    assert job["commit_sha"] == "5619e0c"


def test_webhook_rejects_unsupported_event(client):
    response = client.post("/webhooks/ci", json={**CI_EVENT, "event_type": "build_failed"})
    assert response.status_code == 400
    assert response.json()["detail"] == "Unsupported CI event type"


@pytest.mark.parametrize(
    "change",
    [
        {"commit_sha": "not-a-sha"},
        {"commit_sha": "abc"},
        {"repository": "no-slash"},
        {"website_url": "nope"},
        {"event_type": ""},
    ],
)
def test_webhook_rejects_invalid_fields(client, change):
    assert client.post("/webhooks/ci", json={**CI_EVENT, **change}).status_code == 422


def test_webhook_rejects_missing_fields(client):
    assert client.post("/webhooks/ci", json={"event_type": "build_success"}).status_code == 422


# ----------------------------------------------------------- failure path
def test_runner_failure_marks_job_failed_without_a_server_error(db_path):
    app = TestClient(create_app(db_path=db_path, runner=ExplodingRunner()))
    response = app.post("/jobs", json={"website_url": SITE})
    assert response.status_code == 201
    job = app.get(f"/jobs/{response.json()['job_id']}").json()
    assert job["status"] == "failed"
    assert "browser crashed" in job["error"]


# ----------------------------------------------------------- /api prefix
def test_api_prefix_alias_for_the_dashboard(client):
    created = client.post("/api/jobs", json={"website_url": SITE})
    assert created.status_code == 201
    assert client.get(f"/api/jobs/{created.json()['job_id']}").status_code == 200
    assert client.get("/api/health").json() == {"status": "ok"}


# ------------------------------------------------------------------ CORS
def test_cors_allows_the_dashboard_origin(client):
    response = client.options(
        "/jobs",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


# --------------------------------------------------------- state machine
def test_happy_path_transitions_are_allowed():
    path = [
        JobStatus.QUEUED,
        JobStatus.INSPECTING,
        JobStatus.ANALYZING,
        JobStatus.REPAIR_PROPOSED,
        JobStatus.APPLYING_PATCH,
        JobStatus.VALIDATING,
        JobStatus.PR_CREATED,
    ]
    for current, nxt in zip(path, path[1:]):
        check_transition(current, nxt)


@pytest.mark.parametrize(
    "current,new",
    [
        (JobStatus.QUEUED, JobStatus.VALIDATING),
        (JobStatus.QUEUED, JobStatus.PR_CREATED),
        (JobStatus.INSPECTING, JobStatus.QUEUED),
        (JobStatus.FAILED, JobStatus.QUEUED),
        (JobStatus.PR_CREATED, JobStatus.FAILED),
    ],
)
def test_invalid_transitions_are_rejected(current, new):
    with pytest.raises(InvalidTransitionError):
        check_transition(current, new)


def test_every_status_has_a_transition_rule_and_terminals_are_final():
    assert set(ALLOWED_TRANSITIONS) == set(JobStatus)
    for terminal in (JobStatus.PR_CREATED, JobStatus.NEEDS_REVIEW, JobStatus.COMPLETED, JobStatus.FAILED):
        assert ALLOWED_TRANSITIONS[terminal] == set()


# --------------------------------------------------------------- runner
def test_runner_factory_defaults_to_mock_and_rejects_unknown_names():
    assert isinstance(runner_from_env(), MockBrowserRunner)
    with pytest.raises(ValueError):
        runner_from_env("playwright-not-built-yet")


# ------------------------------------------- the end-to-end demo as a test
def test_end_to_end_demo_webhook_to_persisted_status_and_artifacts(db_path):
    app = TestClient(create_app(db_path=db_path, runner=MockBrowserRunner()))

    hook = app.post("/webhooks/ci", json=CI_EVENT)                      # 1. simulated CI event
    assert hook.status_code == 201
    job_id = hook.json()["job_id"]

    status = app.get(f"/jobs/{job_id}").json()                           # 2. status retrieval
    assert status["status"] == "analyzing"
    assert status["inspection"]["executed"] is False                     #    clearly mock

    artifacts = app.get(f"/jobs/{job_id}/artifacts").json()              # 3. artifact references
    assert artifacts and artifacts[0]["mock"] is True

    restarted = TestClient(create_app(db_path=db_path, runner=MockBrowserRunner()))
    assert restarted.get(f"/jobs/{job_id}").json()["status"] == "analyzing"  # 4. persisted