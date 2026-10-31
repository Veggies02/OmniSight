"""The pull request endpoint may only target the repository the SERVER is configured for.

Neither the request body nor the repository stored on a job (which comes from the CI webhook)
may redirect the server's GitHub token to another repository or another fork.
"""
import httpx
import pytest
from fastapi.testclient import TestClient

from api import create_app
from browser_runner import MockBrowserRunner
from job_store import JobStore

from test_pr_flow import (  # reuse the helpers of the existing PR tests
    HEADERS,
    TOKEN,
    create_completed_repair_job,
    db_path,  # noqa: F401  (pytest fixture)
    make_mock_github_client,
)


def make_client(db_path, calls):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        pr = {
            "number": 7,
            "html_url": "https://github.com/x/y/pull/7",
            "url": "https://api.github.com/repos/x/y/pulls/7",
            "state": "open",
            "draft": True,
            "merged": False,
            "title": "t",
            "body": "b",
            "head": {"ref": "repair/mobile-nav-overflow-test", "sha": "a" * 40},
            "base": {"ref": "main"},
            "created_at": "2026-10-31T00:00:00Z",
            "updated_at": "2026-10-31T00:00:00Z",
        }
        return httpx.Response(201, json=pr)

    app = create_app(
        db_path=db_path,
        runner=MockBrowserRunner(),
        operator_token=TOKEN,
        github_client=make_mock_github_client(handler),
    )
    return TestClient(app)


@pytest.fixture(autouse=True)
def no_repo_env(monkeypatch):
    monkeypatch.delenv("OMNISIGHT_GITHUB_REPO", raising=False)


def test_body_cannot_choose_another_repository(db_path):
    calls = []
    client = make_client(db_path, calls)
    job_id = create_completed_repair_job(JobStore(db_path))
    resp = client.post(f"/jobs/{job_id}/pr", json={"repository": "attacker/other-repo"}, headers=HEADERS)
    assert resp.status_code == 422
    assert calls == []  # GitHub was never contacted


def test_repository_stored_on_job_cannot_redirect_the_pr(db_path):
    calls = []
    client = make_client(db_path, calls)
    store = JobStore(db_path)
    job_id = create_completed_repair_job(store)
    with store._connect() as db:  # simulate a CI webhook that supplied another repository
        db.execute("UPDATE jobs SET repository = ? WHERE job_id = ?", ("attacker/other-repo", job_id))
    resp = client.post(f"/jobs/{job_id}/pr", json={}, headers=HEADERS)
    assert resp.status_code == 422
    assert calls == []


def test_configured_repository_is_used_and_matched_case_insensitively(db_path, monkeypatch):
    monkeypatch.setenv("OMNISIGHT_GITHUB_REPO", "Acme/Site, Veggies02/OmniSight")
    calls = []
    client = make_client(db_path, calls)
    job_id = create_completed_repair_job(JobStore(db_path))
    client.post(f"/jobs/{job_id}/pr", json={"repository": "acme/site"}, headers=HEADERS)
    assert len(calls) == 1
    assert calls[0].url.path == "/repos/Acme/Site/pulls"


@pytest.mark.parametrize("head", ["attacker:repair/x", "../x", "-x", "a b", "x" * 201])
def test_bad_head_branch_is_refused(db_path, head):
    calls = []
    client = make_client(db_path, calls)
    job_id = create_completed_repair_job(JobStore(db_path))
    resp = client.post(f"/jobs/{job_id}/pr", json={"head_branch": head}, headers=HEADERS)
    assert resp.status_code == 422
    assert calls == []


def test_bad_base_branch_is_refused(db_path):
    calls = []
    client = make_client(db_path, calls)
    job_id = create_completed_repair_job(JobStore(db_path))
    resp = client.post(f"/jobs/{job_id}/pr", json={"base_branch": "main..evil"}, headers=HEADERS)
    assert resp.status_code == 422
    assert calls == []