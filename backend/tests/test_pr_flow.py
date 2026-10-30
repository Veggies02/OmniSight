"""Comprehensive test suite for the server-side GitHub Draft Pull Request workflow.

Covers:
- POST /jobs/{job_id}/pr and POST /api/jobs/{job_id}/pr
- GET  /jobs/{job_id}/pr and GET  /api/jobs/{job_id}/pr
- Safety invariants (draft=True, authorization gate, preflight eligibility)
- Error handling (missing credentials, invalid credentials, rate limit, not found)
- Idempotency & existing PR deduplication
"""
import json
from pathlib import Path
from typing import Any, Dict, Optional
import pytest
import httpx
from fastapi.testclient import TestClient

from api import create_app
from browser_runner import MockBrowserRunner
from github_client import GitHubClient
from job_schemas import JobStatus
from job_store import JobStore

SITE = "https://example.com"
TOKEN = "test-operator-token"
HEADERS = {"X-Operator-Token": TOKEN}
FAKE_GITHUB_TOKEN = "ghp_fake_test_token_1234567890"


@pytest.fixture()
def db_path(tmp_path_factory):
    return tmp_path_factory.mktemp("db") / "jobs.db"


def make_mock_github_client(handler, token=FAKE_GITHUB_TOKEN):
    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    return GitHubClient(token=token, client=http_client)


def create_completed_repair_job(
    store: JobStore,
    passed: bool = True,
    visual_passed: bool = True,
    approved: bool = True,
    status: JobStatus = JobStatus.COMPLETED,
) -> str:
    job = store.create_job(SITE, source="manual", repository="Veggies02/OmniSight")
    job_id = job["job_id"]
    store.update_status(job_id, JobStatus.INSPECTING)
    store.update_status(job_id, JobStatus.ANALYZING)
    store.update_status(
        job_id,
        JobStatus.REPAIR_PROPOSED,
        proposal={
            "proposalId": "prop-123",
            "scenarioId": "mobile-nav-overflow",
            "targetFile": "src/index.css",
        },
    )
    if approved:
        store.record_approval(job_id, "qa-reviewer@omnisight.dev")

    if status == JobStatus.COMPLETED or passed is not None:
        repair_result = {
            "outcome": "passed" if passed else "failed",
            "passed": passed,
            "visual_passed": visual_passed,
            "build_passed": True,
            "test_passed": passed,
            "exit_code": 0 if passed else 1,
            "branch": "repair/mobile-nav-overflow-test",
            "message": "All visual checks passed.",
        }
        # Transition through applying_patch to completed
        store.update_status(job_id, JobStatus.APPLYING_PATCH)
        target_status = status if status != JobStatus.REPAIR_PROPOSED else JobStatus.COMPLETED
        store.update_status(job_id, target_status, repair=repair_result)

    return job_id


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


def test_create_draft_pr_success(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store, passed=True, visual_passed=True)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert "/repos/Veggies02/OmniSight/pulls" in str(request.url)
        payload = json.loads(request.content)
        assert payload["draft"] is True
        assert "mobile-nav-overflow" in payload["title"]
        return httpx.Response(
            201,
            json={
                "number": 42,
                "html_url": "https://github.com/Veggies02/OmniSight/pull/42",
                "title": payload["title"],
                "draft": True,
                "merged": False,
                "created_at": "2026-10-31T00:00:00Z",
                "head": {"ref": payload["head"], "sha": "a1b2c3d4"},
                "base": {"ref": payload["base"]},
                "user": {"login": "omnisight-bot[bot]"},
            },
        )

    gh_client = make_mock_github_client(handler)
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    resp = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["pr_number"] == 42
    assert data["pr_url"] == "https://github.com/Veggies02/OmniSight/pull/42"
    assert data["is_draft"] is True
    assert data["status"] == "draft"
    assert data["head_branch"] == "repair/mobile-nav-overflow-test"
    assert data["existing"] is False

    # Check job updated to PR_CREATED
    job = store.get_job(job_id)
    assert job["status"] == "pr_created"
    assert job["stage"] == "pr_created"
    assert job["pull_request"]["pr_number"] == 42


def test_create_pr_requires_operator_token(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store)

    gh_client = make_mock_github_client(lambda r: httpx.Response(201, json={}))
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    # Missing header
    resp = client.post(f"/jobs/{job_id}/pr")
    assert resp.status_code == 401

    # Wrong header
    resp = client.post(f"/jobs/{job_id}/pr", headers={"X-Operator-Token": "bad-token"})
    assert resp.status_code == 401


def test_create_pr_disabled_if_operator_token_not_configured(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store)

    gh_client = make_mock_github_client(lambda r: httpx.Response(201, json={}))
    app = create_app(db_path=db_path, operator_token="", github_client=gh_client)
    client = TestClient(app)

    resp = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp.status_code == 503
    assert "disabled" in resp.json()["detail"].lower()


def test_create_pr_job_not_found(db_path):
    gh_client = make_mock_github_client(lambda r: httpx.Response(201, json={}))
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    resp = client.post("/jobs/job-does-not-exist/pr", headers=HEADERS)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Job not found"


def test_create_pr_rejected_if_not_completed(db_path):
    store = JobStore(db_path)
    job = store.create_job(SITE)
    job_id = job["job_id"]

    gh_client = make_mock_github_client(lambda r: httpx.Response(201, json={}))
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    resp = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp.status_code == 409
    assert "Only completed jobs" in resp.json()["detail"]


def test_create_pr_rejected_if_not_approved(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store, approved=False)

    gh_client = make_mock_github_client(lambda r: httpx.Response(201, json={}))
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    resp = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp.status_code == 409
    assert "approved" in resp.json()["detail"].lower()


def test_create_pr_rejected_if_repair_failed(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store, passed=False, visual_passed=False)

    gh_client = make_mock_github_client(lambda r: httpx.Response(201, json={}))
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    resp = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp.status_code == 409
    assert "did not pass" in resp.json()["detail"].lower()


def test_create_pr_rejected_if_visual_check_failed(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store, passed=True, visual_passed=False)

    gh_client = make_mock_github_client(lambda r: httpx.Response(201, json={}))
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    resp = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp.status_code == 409
    assert "visual" in resp.json()["detail"].lower()


def test_create_pr_missing_github_token(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store, passed=True, visual_passed=True)

    # Empty token on GitHubClient
    gh_client = GitHubClient(token="")
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    resp = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp.status_code == 503
    assert "GITHUB_TOKEN" in resp.json()["detail"]


def test_create_pr_github_bad_credentials(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "Bad credentials"})

    gh_client = make_mock_github_client(handler)
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    resp = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp.status_code == 502
    assert "authentication failed" in resp.json()["detail"].lower()


def test_create_pr_github_rate_limited(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"message": "API rate limit exceeded"})

    gh_client = make_mock_github_client(handler)
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    resp = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp.status_code == 429
    assert "rate limit" in resp.json()["detail"].lower()


def test_create_pr_idempotency_returns_existing(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store)

    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            201,
            json={
                "number": 99,
                "html_url": "https://github.com/Veggies02/OmniSight/pull/99",
                "title": "fix: repair",
                "draft": True,
                "merged": False,
                "created_at": "2026-10-31T00:00:00Z",
                "head": {"ref": "repair/branch", "sha": "12345"},
                "base": {"ref": "main"},
                "user": {"login": "omnisight-bot[bot]"},
            },
        )

    gh_client = make_mock_github_client(handler)
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    # First call creates
    resp1 = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp1.status_code == 201
    assert calls == 1

    # Second call uses stored metadata and does not call GitHub again
    resp2 = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp2.status_code in (200, 201)
    assert calls == 1  # No additional network call!
    data2 = resp2.json()
    assert data2["pr_number"] == 99
    assert data2["existing"] is True


def test_create_pr_reuses_existing_pr_from_github_422(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            # GitHub reports that PR already exists for branch
            return httpx.Response(
                422,
                json={
                    "message": "Validation Failed",
                    "errors": [{"message": "A pull request already exists for Veggies02:repair/mobile-nav-overflow-test"}],
                },
            )
        elif request.method == "GET":
            # find_existing_pull_request lists open PRs
            return httpx.Response(
                200,
                json=[
                    {
                        "number": 77,
                        "html_url": "https://github.com/Veggies02/OmniSight/pull/77",
                        "title": "Existing PR",
                        "draft": True,
                        "merged": False,
                        "created_at": "2026-10-31T00:00:00Z",
                        "head": {"ref": "repair/mobile-nav-overflow-test", "sha": "abc123"},
                        "base": {"ref": "main"},
                        "user": {"login": "omnisight-bot[bot]"},
                    }
                ],
            )
        return httpx.Response(404)

    gh_client = make_mock_github_client(handler)
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    resp = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert resp.status_code == 201
    data = resp.json()
    assert data["pr_number"] == 77
    assert data["existing"] is True


def test_get_pr_endpoints(db_path):
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store)

    gh_client = make_mock_github_client(
        lambda r: httpx.Response(
            201,
            json={
                "number": 55,
                "html_url": "https://github.com/Veggies02/OmniSight/pull/55",
                "title": "fix: mobile nav",
                "draft": True,
                "merged": False,
                "created_at": "2026-10-31T00:00:00Z",
                "head": {"ref": "repair/mobile-nav-overflow-test"},
                "base": {"ref": "main"},
            },
        )
    )
    app = create_app(db_path=db_path, operator_token=TOKEN, github_client=gh_client)
    client = TestClient(app)

    # 1. Before PR creation -> GET /jobs/{job_id}/pr returns 404
    resp_before = client.get(f"/jobs/{job_id}/pr")
    assert resp_before.status_code == 404
    assert "No pull request" in resp_before.json()["detail"]

    # 2. Create PR
    post_resp = client.post(f"/jobs/{job_id}/pr", headers=HEADERS)
    assert post_resp.status_code == 201

    # 3. GET /jobs/{job_id}/pr returns 200 with PR data
    get_resp = client.get(f"/jobs/{job_id}/pr")
    assert get_resp.status_code == 200
    assert get_resp.json()["pr_number"] == 55

    # 4. /api prefix compatibility
    api_get_resp = client.get(f"/api/jobs/{job_id}/pr")
    assert api_get_resp.status_code == 200
    assert api_get_resp.json()["pr_number"] == 55


def test_get_pr_nonexistent_job(db_path):
    app = create_app(db_path=db_path, operator_token=TOKEN)
    client = TestClient(app)

    resp = client.get("/jobs/job-unknown-404/pr")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Job not found"
