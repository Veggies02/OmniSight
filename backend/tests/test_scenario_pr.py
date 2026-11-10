"""Scenarios (contract v2, part 3): one Draft pull request per scenario.

Capture, repair CLI, git push and GitHub are all fakes here (the real push is covered by test_branch_pusher.py).
"""
import sys

import pytest
from fastapi.testclient import TestClient

from api import create_app
from branch_pusher import BranchPusher, BranchPushError
from github_client import GitHubAPIError, GitHubAuthError, GitHubAuthMissingError, GitHubRateLimitError
from job_store import JobStore
from repair_runner import RepairRunner
from test_repair_report_v2 import FAKE_CLI
from test_scenario_flow import A, B, HEADERS, approve, job, new_job, reject, repair, scenario
from test_scenarios import FakePipeline, FakeRunner


class FakePusher:
    def __init__(self):
        self.calls = []
        self.error = None

    def push(self, repository, commit_sha, branch):
        self.calls.append((repository, commit_sha, branch))
        if self.error:
            raise self.error


class FakeGitHub:
    def __init__(self):
        self.calls = []
        self.error = None

    def create_draft_pull_request(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        n = len(self.calls)
        return {
            "pr_number": 6 + n, "pr_url": f"https://github.com/{kwargs['owner']}/{kwargs['repo']}/pull/{6 + n}",
            "title": kwargs["title"], "head_branch": kwargs["head"], "base_branch": kwargs["base"],
            "head_commit_sha": "a" * 40, "status": "draft", "is_draft": True, "merged": False,
            "created_at": "2026-11-10T00:00:00Z", "repository": f"{kwargs['owner']}/{kwargs['repo']}", "existing": False,
        }


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("OMNISIGHT_AUTO_PROPOSALS", raising=False)
    monkeypatch.delenv("FAKE_V2_MODE", raising=False)
    monkeypatch.delenv("OMNISIGHT_GITHUB_REPO", raising=False)


@pytest.fixture()
def parts(tmp_path):
    (tmp_path / "fake_cli.py").write_text(FAKE_CLI)
    runner = RepairRunner(repo_root=tmp_path, command=[sys.executable, str(tmp_path / "fake_cli.py")])
    pusher, github = FakePusher(), FakeGitHub()
    app = create_app(
        db_path=tmp_path / "jobs.db", runner=FakeRunner(), repair_runner=runner, operator_token="s3cret",
        proposal_pipeline=FakePipeline(), github_client=github, branch_pusher=pusher,
    )
    return dict(client=TestClient(app), pusher=pusher, github=github, tmp=tmp_path)


def pr(client, job_id, sid, body=None, headers=HEADERS):
    return client.post(f"/jobs/{job_id}/scenarios/{sid}/pr", json=body, headers=headers)


def passed_scenario(parts, sid=A):
    client = parts["client"]
    job_id = new_job(client)
    approve(client, job_id, sid)
    assert repair(client, job_id, sid).status_code == 202
    assert scenario(client, job_id, sid)["repair_state"] == "passed"
    return job_id


# ------------------------------------------------------------------ happy path
def test_pr_for_a_passed_scenario_pushes_then_opens_a_draft(parts):
    client = parts["client"]
    job_id = passed_scenario(parts)
    r = pr(client, job_id, A)
    assert r.status_code == 201
    body = r.json()
    assert body["pr_status"] == "created" and body["pull_request"]["pr_number"] == 7
    assert body["pull_request"]["scenario_id"] == A and body["pull_request"]["job_id"] == job_id
    assert body["pull_request"]["url"] == body["pull_request"]["pr_url"]  # contract names next to the client's names
    assert body["pull_request"]["draft"] is True and body["pull_request"]["state"] == "draft"

    rep = scenario(client, job_id, A)["repair"]
    assert parts["pusher"].calls == [("Veggies02/OmniSight", rep["commit_sha"], rep["branch"])]
    (call,) = parts["github"].calls
    assert call["head"] == rep["branch"] and call["base"] == "main"
    assert call["owner"] == "Veggies02" and call["repo"] == "OmniSight"
    assert A in call["title"] and job_id in call["body"] and "qa@omnisight.ai" in call["body"] and rep["commit_sha"] in call["body"]

    j = job(client, job_id)
    assert j["summary"]["prs_created"] == 1
    assert j["status"] == "repair_proposed"  # B is still open: the PR does not change the job
    assert client.get(f"/jobs/{job_id}/scenarios/{A}/pr").json()["pr_number"] == 7


def test_a_completed_job_stays_completed_after_its_prs(parts):
    client = parts["client"]
    job_id = passed_scenario(parts, A)
    approve(client, job_id, B)
    repair(client, job_id, B)
    assert job(client, job_id)["status"] == "completed"
    assert pr(client, job_id, A).status_code == 201
    assert pr(client, job_id, B).status_code == 201
    j = job(client, job_id)
    assert j["status"] == "completed" and j["stage"] == "done" and j["outcome"] == "all_passed"
    assert j["summary"]["prs_created"] == 2 and j["pull_request"] is None  # never the old job-level pr_created


def test_asking_again_returns_the_existing_pr_and_pushes_nothing(parts):
    client = parts["client"]
    job_id = passed_scenario(parts)
    first = pr(client, job_id, A).json()
    second = pr(client, job_id, A)
    assert second.status_code == 200
    assert second.json()["pull_request"]["pr_number"] == first["pull_request"]["pr_number"]
    assert len(parts["pusher"].calls) == 1 and len(parts["github"].calls) == 1


# ------------------------------------------------------------------ who may ask for what
def test_the_caller_cannot_choose_the_repository_or_the_head_branch(parts):
    client = parts["client"]
    job_id = passed_scenario(parts)
    r = pr(client, job_id, A, {
        "repository": "attacker/other", "head_branch": "main", "head": "main", "title": "My title",
        "base_branch": "develop", "labels": ["x"], "draft": False,
    })
    assert r.status_code == 201
    rep = scenario(client, job_id, A)["repair"]
    assert parts["pusher"].calls == [("Veggies02/OmniSight", rep["commit_sha"], rep["branch"])]
    (call,) = parts["github"].calls
    assert call["head"] == rep["branch"] and call["owner"] == "Veggies02"
    assert call["title"] == "My title" and call["base"] == "develop"  # wording and base branch are allowed
    assert call["labels"] == ["automated-repair", "omnisight"]


def test_the_server_setting_decides_the_repository(parts, monkeypatch):
    monkeypatch.setenv("OMNISIGHT_GITHUB_REPO", "Acme/Site, Veggies02/OmniSight")
    job_id = passed_scenario(parts)
    assert pr(parts["client"], job_id, A).status_code == 201
    assert parts["pusher"].calls[0][0] == "Acme/Site"
    assert parts["github"].calls[0]["owner"] == "Acme" and parts["github"].calls[0]["repo"] == "Site"


@pytest.mark.parametrize("base", ["main..evil", "/main", "-x", "a b", "x" * 201])
def test_bad_base_branches_are_refused_before_anything_happens(parts, base):
    job_id = passed_scenario(parts)
    assert pr(parts["client"], job_id, A, {"base_branch": base}).status_code == 422
    assert parts["pusher"].calls == [] and parts["github"].calls == []


def test_the_operator_token_is_required(parts):
    client = parts["client"]
    job_id = passed_scenario(parts)
    assert pr(client, job_id, A, headers={}).status_code == 401
    assert pr(client, job_id, A, headers={"X-Operator-Token": "wrong"}).status_code == 401
    assert pr(client, "job-nope", A).status_code == 404
    assert pr(client, job_id, "no-such-scenario").status_code == 404
    assert parts["pusher"].calls == []


# ------------------------------------------------------------------ only a passed repair gets a PR
def test_no_pr_unless_the_repair_passed(parts, monkeypatch):
    client = parts["client"]
    job_id = new_job(client)
    assert pr(client, job_id, A).status_code == 409                     # not even approved
    approve(client, job_id, A)
    assert pr(client, job_id, A).status_code == 409                     # approved, not repaired
    reject(client, job_id, B)
    assert pr(client, job_id, B).status_code == 409                     # rejected
    monkeypatch.setenv("FAKE_V2_MODE", "failed")
    repair(client, job_id, A)
    assert scenario(client, job_id, A)["repair_state"] == "failed"
    assert pr(client, job_id, A).status_code == 409                     # repair failed
    assert parts["pusher"].calls == [] and parts["github"].calls == []


def _set_repair(parts, job_id, sid, **changes):
    store = JobStore(parts["tmp"] / "jobs.db")
    import json
    current = scenario(parts["client"], job_id, sid)["repair"]
    current.update(changes)
    with store._connect() as db:
        db.execute("UPDATE scenarios SET repair = ? WHERE job_id = ? AND scenario_id = ?", (json.dumps(current), job_id, sid))


@pytest.mark.parametrize("changes", [{"visual_passed": False}, {"passed": False}, {"commit_sha": None}, {"branch": None}])
def test_a_repair_report_that_is_not_pushable_is_refused(parts, changes):
    job_id = passed_scenario(parts)
    _set_repair(parts, job_id, A, **changes)
    assert pr(parts["client"], job_id, A).status_code == 409
    assert parts["pusher"].calls == [] and parts["github"].calls == []


def test_the_real_pusher_refuses_a_branch_outside_omnisight_repair(parts):
    client = parts["client"]
    job_id = passed_scenario(parts)
    _set_repair(parts, job_id, A, branch="main")
    app = create_app(
        db_path=parts["tmp"] / "jobs.db", runner=FakeRunner(), operator_token="s3cret",
        github_client=parts["github"], branch_pusher=BranchPusher(repo_root=parts["tmp"], token_provider=lambda: "tok"),
    )
    r = pr(TestClient(app), job_id, A)
    assert r.status_code == 409 and "omnisight-repair/" in r.json()["detail"]
    assert parts["github"].calls == []


# ------------------------------------------------------------------ failures and retries
def test_a_failed_push_marks_the_pr_failed_and_can_be_retried(parts):
    client = parts["client"]
    job_id = passed_scenario(parts)
    parts["pusher"].error = BranchPushError("push_rejected", "GitHub refused the push")
    r = pr(client, job_id, A)
    assert r.status_code == 502 and "refused" in r.json()["detail"]
    assert scenario(client, job_id, A)["pr_status"] == "failed" and parts["github"].calls == []
    parts["pusher"].error = None
    assert pr(client, job_id, A).status_code == 201
    assert scenario(client, job_id, A)["pr_status"] == "created"


def test_no_token_is_a_503_and_changes_nothing(parts):
    client = parts["client"]
    job_id = passed_scenario(parts)
    parts["pusher"].error = BranchPushError("no_token", "No GitHub token is configured on the server")
    assert pr(client, job_id, A).status_code == 503
    assert scenario(client, job_id, A)["pr_status"] == "not_started"


@pytest.mark.parametrize("code, status", [("commit_missing", 409), ("branch_mismatch", 409), ("invalid_branch", 409), ("push_timeout", 502), ("push_auth_failed", 502)])
def test_push_error_codes_map_to_http_statuses(parts, code, status):
    job_id = passed_scenario(parts)
    parts["pusher"].error = BranchPushError(code, "x")
    assert pr(parts["client"], job_id, A).status_code == status


@pytest.mark.parametrize(
    "error, status",
    [(GitHubAuthMissingError("no token"), 503), (GitHubAuthError("bad token"), 502),
     (GitHubRateLimitError("slow down"), 429), (GitHubAPIError("boom", status_code=500), 500), (RuntimeError("weird"), 502)],
)
def test_github_errors_after_a_good_push_can_be_retried(parts, error, status):
    client = parts["client"]
    job_id = passed_scenario(parts)
    parts["github"].error = error
    assert pr(client, job_id, A).status_code == status
    parts["github"].error = None
    assert pr(client, job_id, A).status_code == 201  # the push is repeated, which is harmless
    assert scenario(client, job_id, A)["pr_status"] == "created" and len(parts["pusher"].calls) == 2


def test_getting_a_pr_that_does_not_exist_is_a_404(parts):
    client = parts["client"]
    job_id = passed_scenario(parts)
    assert client.get(f"/jobs/{job_id}/scenarios/{A}/pr").status_code == 404
    assert client.get(f"/jobs/{job_id}/scenarios/nope/pr").status_code == 404
    assert client.get("/jobs/job-nope/scenarios/x/pr").status_code == 404


def test_the_old_job_level_pr_endpoint_does_not_touch_scenario_jobs(parts):
    client = parts["client"]
    job_id = passed_scenario(parts)
    assert client.post(f"/jobs/{job_id}/pr", json={}, headers=HEADERS).status_code == 409
    assert parts["github"].calls == []


def test_the_scenario_state_itself_must_be_passed(parts):
    job_id = passed_scenario(parts)
    store = JobStore(parts["tmp"] / "jobs.db")
    with store._connect() as db:
        db.execute("UPDATE scenarios SET repair_state = 'failed' WHERE job_id = ? AND scenario_id = ?", (job_id, A))
    assert pr(parts["client"], job_id, A).status_code == 409
    assert parts["pusher"].calls == [] and parts["github"].calls == []