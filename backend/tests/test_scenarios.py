"""Scenarios (contract v2, part 1): storage, the pipeline after capture, and the read endpoints.

The pipeline and the capture runner are fakes, so no Node, browser or network is needed.
"""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from api import create_app
from browser_runner import MockBrowserRunner, RunnerResult
from job_schemas import JobStateError, JobStatus
from job_store import JobNotFoundError, JobStore
from proposal_pipeline import PipelineError, PipelineResult, ProposalPipeline, proposal_pipeline_from_env
from scenario_logic import outcome_for, summarize


def proposal(scenario_id, **extra):
    base = {
        "proposalId": f"prop-{scenario_id}",
        "scenarioId": scenario_id,
        "status": "proposed",
        "diagnosisRef": {"provider": "mock", "model": "mock-vlm-v1"},
    }
    base.update(extra)
    return base


TWO = {"product-image-distortion": proposal("product-image-distortion"), "low-contrast-text": proposal("low-contrast-text")}


class FakeRunner:
    """A capture that 'really ran' and produced a run folder."""

    mode = "playwright"
    disclaimer = "fake"

    def run(self, job_id, website_url):
        return RunnerResult(mode="playwright", executed=True, message="ok", artifacts=[], run_id="run-1")


class FakePipeline:
    def __init__(self, proposals=None, error=None):
        self.proposals = TWO if proposals is None else proposals
        self.error = error
        self.calls = []

    def run(self, run_id):
        self.calls.append(run_id)
        if self.error:
            raise self.error
        return PipelineResult(
            run_id=run_id, provider="mock", proposals=self.proposals,
            proposals_path=f"artifacts/repair-proposals/{run_id}/repair_proposals.json", duration_seconds=0.1,
        )


@pytest.fixture(autouse=True)
def pipeline_off_by_default(monkeypatch):
    monkeypatch.delenv("OMNISIGHT_AUTO_PROPOSALS", raising=False)


def make_client(tmp_path, runner=None, pipeline=None):
    app = create_app(
        db_path=tmp_path / "jobs.db", runner=runner or FakeRunner(), operator_token="s3cret", proposal_pipeline=pipeline
    )
    return TestClient(app)


def create(client):
    created = client.post("/jobs", json={"website_url": "http://127.0.0.1:5173"})
    assert created.status_code == 201
    return created.json()["job_id"]


# ---------------------------------------------------------------- after capture
def test_capture_then_pipeline_creates_scenarios(tmp_path):
    pipeline = FakePipeline()
    client = make_client(tmp_path, pipeline=pipeline)
    job = client.get(f"/jobs/{create(client)}").json()
    assert pipeline.calls == ["run-1"]
    assert job["status"] == "repair_proposed" and job["stage"] == "awaiting_approval"
    assert job["outcome"] is None
    assert job["summary"]["total"] == 2 and job["summary"]["pending_review"] == 2
    first = job["scenarios"][0]
    assert first["scenario_id"] == "product-image-distortion"
    assert first["repair_job_id"] == f"{job['job_id']}--product-image-distortion"
    assert first["review_status"] == "pending_review" and first["repair_state"] == "not_started"
    assert first["pr_status"] == "not_started" and first["approval"] is None and first["repair"] is None
    assert first["is_mock"] is True
    assert first["diagnosis"]["provider"] == "mock"
    assert first["proposal"]["humanReviewStatus"] == "pending_review"
    # old single-proposal fields stay empty for a v2 job
    assert job["proposal"] is None and job["approval"] is None


def test_scenario_endpoints(tmp_path):
    client = make_client(tmp_path, pipeline=FakePipeline())
    job_id = create(client)
    listed = client.get(f"/jobs/{job_id}/scenarios")
    assert listed.status_code == 200 and [s["scenario_id"] for s in listed.json()] == list(TWO)
    one = client.get(f"/jobs/{job_id}/scenarios/low-contrast-text")
    assert one.status_code == 200 and one.json()["proposal"]["proposalId"] == "prop-low-contrast-text"
    assert client.get(f"/api/jobs/{job_id}/scenarios/low-contrast-text").status_code == 200
    assert client.get("/jobs/job-nope/scenarios").status_code == 404
    assert client.get("/jobs/job-nope/scenarios/x").status_code == 404
    assert client.get(f"/jobs/{job_id}/scenarios/missing").status_code == 404


def test_pipeline_failure_fails_the_job_and_keeps_the_stage(tmp_path):
    error = PipelineError("diagnosis_failed", "Diagnosis failed (exit 1): CRITICAL LEAKAGE DETECTED", "diagnosis")
    client = make_client(tmp_path, pipeline=FakePipeline(error=error))
    job = client.get(f"/jobs/{create(client)}").json()
    assert job["status"] == "failed" and job["stage"] == "generating_proposals"
    assert "diagnosis_failed" in job["error"] and "LEAKAGE" in job["error"]
    assert job["scenarios"] == []


def test_nothing_to_repair_completes_the_job(tmp_path):
    client = make_client(tmp_path, pipeline=FakePipeline(proposals={}))
    job = client.get(f"/jobs/{create(client)}").json()
    assert job["status"] == "completed" and job["stage"] == "done"
    assert job["outcome"] == "no_repairs_needed" and job["summary"]["total"] == 0


def test_bad_scenario_id_from_the_pipeline_fails_the_job_and_stores_nothing(tmp_path):
    bad = {"ok-one": proposal("ok-one"), "a--b": proposal("a--b")}
    client = make_client(tmp_path, pipeline=FakePipeline(proposals=bad))
    job = client.get(f"/jobs/{create(client)}").json()
    assert job["status"] == "failed" and job["scenarios"] == []


def test_without_a_pipeline_the_job_stops_at_analyzing_as_before(tmp_path):
    client = make_client(tmp_path, pipeline=None)
    job = client.get(f"/jobs/{create(client)}").json()
    assert job["status"] == "analyzing"
    assert job["scenarios"] == [] and job["summary"] is None and job["outcome"] is None


def test_mock_capture_never_calls_the_pipeline(tmp_path):
    pipeline = FakePipeline()
    client = make_client(tmp_path, runner=MockBrowserRunner(), pipeline=pipeline)
    job = client.get(f"/jobs/{create(client)}").json()
    assert pipeline.calls == [] and job["status"] == "analyzing"


def test_review_claims_inside_a_generated_proposal_are_discarded(tmp_path):
    sneaky = {"s1": proposal("s1", humanReviewStatus="approved", reviewedBy="mallory", reviewedAt="2026-01-01T00:00:00Z")}
    client = make_client(tmp_path, pipeline=FakePipeline(proposals=sneaky))
    stored = client.get(f"/jobs/{create(client)}").json()["scenarios"][0]
    assert stored["proposal"]["humanReviewStatus"] == "pending_review"
    assert "reviewedBy" not in stored["proposal"] and "reviewedAt" not in stored["proposal"]
    assert stored["review_status"] == "pending_review" and stored["approval"] is None


# ----------------------------------------------------------------------- store
def analyzing_job(tmp_path):
    store = JobStore(tmp_path / "s.db")
    job = store.create_job("http://x")
    store.update_status(job["job_id"], JobStatus.INSPECTING)
    store.update_status(job["job_id"], JobStatus.ANALYZING)
    return store, job["job_id"]


INFO = {"run_id": "run-1", "provider": "mock", "proposals_path": "p"}


def test_scenarios_can_only_be_added_once(tmp_path):
    store, job_id = analyzing_job(tmp_path)
    store.add_scenarios(job_id, INFO, TWO)
    with pytest.raises(JobStateError):
        store.add_scenarios(job_id, INFO, TWO)
    assert len(store.list_scenarios(job_id)) == 2


def test_scenarios_need_an_analyzing_job(tmp_path):
    store = JobStore(tmp_path / "s.db")
    job = store.create_job("http://x")  # still queued
    with pytest.raises(JobStateError):
        store.add_scenarios(job["job_id"], INFO, TWO)
    with pytest.raises(JobNotFoundError):
        store.add_scenarios("job-nope", INFO, TWO)


@pytest.mark.parametrize("bad_id", ["", "../x", "a--b", "a b", "-x", "x" * 65, "a/b"])
def test_invalid_scenario_ids_store_nothing(tmp_path, bad_id):
    store, job_id = analyzing_job(tmp_path)
    with pytest.raises(ValueError):
        store.add_scenarios(job_id, INFO, {"fine": proposal("fine"), bad_id: proposal("fine")})
    assert store.list_scenarios(job_id) == []
    assert store.get_job(job_id)["status"] == "analyzing"


@pytest.mark.parametrize("bad", [{"scenarioId": "s1"}, {"proposalId": ""}, "text"])
def test_unusable_proposals_store_nothing(tmp_path, bad):
    store, job_id = analyzing_job(tmp_path)
    with pytest.raises(ValueError):
        store.add_scenarios(job_id, INFO, {"s1": bad})
    assert store.list_scenarios(job_id) == []


def test_database_from_before_scenarios_still_opens(tmp_path):
    db = tmp_path / "old.db"
    with sqlite3.connect(db) as connection:
        connection.execute("CREATE TABLE jobs (job_id TEXT PRIMARY KEY, website_url TEXT NOT NULL, status TEXT NOT NULL)")
        connection.execute("INSERT INTO jobs VALUES ('job-old', 'http://x', 'analyzing')")
    connection.close()
    job = JobStore(db).get_job("job-old")
    assert job["status"] == "analyzing" and job["scenarios"] == [] and job["summary"] is None


# ------------------------------------------------------------- summary/outcome
def sc(review="pending_review", state="not_started", pr="not_started"):
    return {"review_status": review, "repair_state": state, "pr_status": pr}


@pytest.mark.parametrize(
    "scenarios, expected",
    [
        ([], "no_repairs_needed"),
        ([sc()], None),
        ([sc("approved", "not_started")], None),
        ([sc("approved", "running")], None),
        ([sc("approved", "passed"), sc()], None),
        ([sc("approved", "passed"), sc("approved", "passed")], "all_passed"),
        ([sc("approved", "passed"), sc("approved", "failed")], "partial"),
        ([sc("approved", "passed"), sc("rejected", "rejected")], "partial"),
        ([sc("approved", "passed"), sc("approved", "unsupported")], "partial"),
        ([sc("approved", "passed"), sc("approved", "error")], "partial"),
        ([sc("approved", "failed"), sc("rejected", "rejected")], "all_failed"),
        ([sc("approved", "error"), sc("approved", "unsupported")], "all_failed"),
        ([sc("rejected", "rejected"), sc("rejected", "rejected")], "all_rejected"),
    ],
)
def test_outcome_rules(scenarios, expected):
    assert outcome_for(scenarios) == expected


def test_summary_counts():
    scenarios = [
        sc("pending_review"),
        sc("approved", "not_started"),
        sc("approved", "running"),
        sc("approved", "passed", "created"),
        sc("approved", "failed"),
        sc("rejected", "rejected"),
        sc("approved", "unsupported"),
        sc("approved", "error"),
    ]
    assert summarize(scenarios) == {
        "total": 8, "pending_review": 1, "approved": 1, "repairing": 1, "passed": 1,
        "failed": 1, "rejected": 1, "unsupported": 1, "error": 1, "prs_created": 1,
    }
def test_real_proposal_shape_gives_category_provider_and_status(tmp_path):
    """Field names as printed from a real repair_proposals.json (Nov 9)."""
    real = {
        "schemaVersion": "1.0", "proposalId": "prop-real", "scenarioId": "product-image-distortion",
        "diagnosisRef": {
            "diagnosisStatus": "diagnosed", "model": "mock-vlm-v1", "provider": "mock",
            "primaryDefectCategory": "image_distortion", "reportedConfidence": 0.94,
        },
        "defectCategory": "image_distortion", "isMock": True, "humanReviewStatus": "pending_review",
    }
    store, job_id = analyzing_job(tmp_path)
    store.add_scenarios(job_id, INFO, {"product-image-distortion": real})
    stored = store.get_scenario(job_id, "product-image-distortion")
    assert stored["defect_category"] == "image_distortion" and stored["is_mock"] is True
    assert stored["diagnosis"] == {"provider": "mock", "model": "mock-vlm-v1", "status": "diagnosed"}


def test_category_falls_back_to_the_diagnosis_reference(tmp_path):
    only_ref = {"proposalId": "p", "diagnosisRef": {"provider": "gemini", "primaryDefectCategory": "low_contrast"}}
    store, job_id = analyzing_job(tmp_path)
    store.add_scenarios(job_id, INFO, {"s1": only_ref})
    stored = store.get_scenario(job_id, "s1")
    assert stored["defect_category"] == "low_contrast" and stored["is_mock"] is False


# -------------------------------------------------------------- env switch
def test_pipeline_is_off_unless_switched_on(tmp_path, monkeypatch):
    assert proposal_pipeline_from_env(tmp_path) is None
    monkeypatch.setenv("OMNISIGHT_AUTO_PROPOSALS", "1")
    pipeline = proposal_pipeline_from_env(tmp_path)
    assert isinstance(pipeline, ProposalPipeline) and pipeline.provider == "mock" and pipeline.timeout_seconds == 300
    monkeypatch.setenv("OMNISIGHT_DIAGNOSIS_PROVIDER", "gemini")
    monkeypatch.setenv("OMNISIGHT_PIPELINE_TIMEOUT_SECONDS", "45")
    pipeline = proposal_pipeline_from_env(tmp_path)
    assert pipeline.provider == "gemini" and pipeline.timeout_seconds == 45


def test_bad_provider_fails_at_startup(tmp_path, monkeypatch):
    monkeypatch.setenv("OMNISIGHT_AUTO_PROPOSALS", "1")
    monkeypatch.setenv("OMNISIGHT_DIAGNOSIS_PROVIDER", "mock; rm -rf /")
    with pytest.raises(ValueError):
        proposal_pipeline_from_env(tmp_path)