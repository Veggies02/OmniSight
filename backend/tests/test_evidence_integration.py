"""Tests for the OmniSight Evidence Reference Contract & Integration.

Verifies:
1. Real Playwright manifest parsing and validation.
2. Evidence-to-job association via JobStore and inspection metadata.
3. Secure gateway URL generation for baseline/defective screenshots, DOM, and measurements.
4. Retrieval of real Playwright screenshots over HTTP through the gateway.
5. Rejection of manifests containing path traversal sequences or escaping visual-evidence boundary.
6. Graceful handling of missing scenarios (404) and non-existent jobs (404).
7. Mock runner fallback contract preservation.
8. Workspace latest evidence discovery.
"""
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from api import create_app
from job_schemas import JobStatus
from job_store import JobStore


@pytest.fixture
def app_with_real_workspace(tmp_path):
    """Initializes app pointing to the real workspace artifacts directory."""
    db_path = tmp_path / "test_evidence_jobs.db"
    # Project root artifacts
    workspace_root = Path(__file__).resolve().parent.parent.parent
    real_artifacts = workspace_root / "artifacts"
    app = create_app(
        db_path=db_path,
        operator_token="test-operator-token",
        artifacts_dir=real_artifacts,
    )
    return app, db_path, real_artifacts


@pytest.fixture
def client(app_with_real_workspace):
    app, _, _ = app_with_real_workspace
    return TestClient(app)


# ============================================================================
# 1. Real Manifest Parsing & Contract Generation
# ============================================================================

def test_real_manifest_parsing_and_contract_generation(client):
    res = client.get("/evidence/latest")
    assert res.status_code == 200
    contracts = res.json()
    assert len(contracts) >= 4

    by_scenario = {c["scenario_id"]: c for c in contracts}
    assert "product-image-distortion" in by_scenario
    assert "product-card-layout-break" in by_scenario
    assert "low-contrast-text" in by_scenario
    assert "mobile-nav-overflow" in by_scenario

    pid = by_scenario["product-image-distortion"]
    assert pid["scenario_id"] == "product-image-distortion"
    assert pid["is_mock"] is False
    assert pid["baseline_screenshot_url"].startswith("/artifacts/visual-evidence/")
    assert pid["baseline_screenshot_url"].endswith("baseline.png")
    assert pid["defective_screenshot_url"].endswith("defective.png")
    assert pid["manifest_url"].endswith("manifest.json")
    assert pid["run_id"] is not None
    assert pid["captured_at"] is not None


# ============================================================================
# 2. Evidence-to-Job Association
# ============================================================================

def test_evidence_associated_with_job(app_with_real_workspace, client):
    _, db_path, _ = app_with_real_workspace
    store = JobStore(db_path)

    # Create job and record inspection with real run_id
    job = store.create_job("http://127.0.0.1:5173", source="manual")
    job_id = job["job_id"]

    inspection_summary = {
        "mode": "playwright",
        "executed": True,
        "message": "Inspection completed successfully",
        "run_id": "run-2026-10-13T17-36-08-002Z",
        "exit_code": 0,
        "scenarios_captured": 4,
        "total_scenarios": 4,
    }
    store.update_status(job_id, JobStatus.INSPECTING)
    store.update_status(job_id, JobStatus.ANALYZING, inspection=inspection_summary)

    # Query job evidence endpoint
    res = client.get(f"/jobs/{job_id}/evidence")
    assert res.status_code == 200
    evidence_list = res.json()
    assert len(evidence_list) == 4

    # Query specific scenario on job
    res_sc = client.get(f"/jobs/{job_id}/evidence/product-image-distortion")
    assert res_sc.status_code == 200
    sc_data = res_sc.json()
    assert sc_data["scenario_id"] == "product-image-distortion"
    assert sc_data["run_id"] == "run-2026-10-13T17-36-08-002Z"
    assert sc_data["measurements"] is not None

    # Query GET /jobs/{job_id} directly to verify evidence map is attached
    res_job = client.get(f"/jobs/{job_id}")
    assert res_job.status_code == 200
    job_payload = res_job.json()
    assert "evidence" in job_payload
    assert "product-image-distortion" in job_payload["evidence"]


# ============================================================================
# 3. Real Screenshot Retrieval Through Secure Gateway Over HTTP
# ============================================================================

def test_real_screenshot_retrieval_over_gateway_http(client):
    res_ev = client.get("/evidence/latest/product-image-distortion")
    assert res_ev.status_code == 200
    evidence = res_ev.json()

    baseline_url = evidence["baseline_screenshot_url"]
    defective_url = evidence["defective_screenshot_url"]

    # Retrieve baseline screenshot over HTTP gateway
    res_base = client.get(baseline_url)
    assert res_base.status_code == 200
    assert res_base.headers["Content-Type"].startswith("image/png")
    assert res_base.headers.get("X-Content-Type-Options") == "nosniff"
    assert res_base.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(res_base.content) > 100_000  # Real image (>100KB)

    # Retrieve defective screenshot over HTTP gateway
    res_def = client.get(defective_url)
    assert res_def.status_code == 200
    assert res_def.headers["Content-Type"].startswith("image/png")
    assert res_def.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(res_def.content) > 100_000


# ============================================================================
# 4. Manifest Security & Path Traversal Validation
# ============================================================================

def test_manifest_path_traversal_rejected(tmp_path):
    artifacts_dir = tmp_path / "artifacts"
    ve_dir = artifacts_dir / "visual-evidence" / "run-evil"
    ve_dir.mkdir(parents=True)

    # Create malicious manifest attempting path traversal out of run folder
    malicious_manifest = {
        "runId": "run-evil",
        "timestamp": "2026-11-08T00:00:00Z",
        "browser": "chromium",
        "scenariosCaptured": 1,
        "totalScenarios": 1,
        "success": True,
        "scenarios": {
            "exploit-scenario": {
                "scenarioId": "exploit-scenario",
                "baseline": {
                    "screenshotPath": "../../outside_secret.png"
                }
            }
        }
    }
    (ve_dir / "manifest.json").write_text(json.dumps(malicious_manifest))

    app = create_app(
        db_path=tmp_path / "evil.db",
        artifacts_dir=artifacts_dir,
    )
    test_client = TestClient(app)

    res = test_client.get("/evidence/latest")
    assert res.status_code == 403
    assert "path traversal" in res.json()["detail"].lower()


def test_manifest_unauthorized_run_id_rejected(tmp_path):
    artifacts_dir = tmp_path / "artifacts"
    ve_dir = artifacts_dir / "visual-evidence" / "run-bad"
    ve_dir.mkdir(parents=True)

    bad_manifest = {
        "runId": "../escaped_run",
        "scenarios": {}
    }
    (ve_dir / "manifest.json").write_text(json.dumps(bad_manifest))

    app = create_app(
        db_path=tmp_path / "bad.db",
        artifacts_dir=artifacts_dir,
    )
    test_client = TestClient(app)

    res = test_client.get("/evidence/latest")
    assert res.status_code == 403


# ============================================================================
# 5. Missing Scenarios & Jobs (404 Handling)
# ============================================================================

def test_missing_job_evidence_returns_404(client):
    res = client.get("/jobs/job-nonexistent/evidence")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_missing_scenario_on_job_returns_404(app_with_real_workspace, client):
    _, db_path, _ = app_with_real_workspace
    store = JobStore(db_path)
    job = store.create_job("http://127.0.0.1:5173")
    store.update_status(job["job_id"], JobStatus.INSPECTING)
    store.update_status(
        job["job_id"],
        JobStatus.ANALYZING,
        inspection={"mode": "playwright", "executed": True, "run_id": "run-2026-10-13T17-36-08-002Z", "message": "ok"},
    )

    res = client.get(f"/jobs/{job['job_id']}/evidence/unknown-scenario-xyz")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


# ============================================================================
# 6. Mock Runner Fallback Handling
# ============================================================================

def test_mock_runner_fallback_handled(app_with_real_workspace, client):
    _, db_path, _ = app_with_real_workspace
    store = JobStore(db_path)
    from job_schemas import ArtifactDraft
    job = store.create_job("http://127.0.0.1:5173")
    store.add_artifacts(job["job_id"], [
        ArtifactDraft(
            kind="screenshot",
            uri=f"mock://artifacts/{job['job_id']}/homepage.png",
            description="Mock screenshot",
            mock=True,
        )
    ])
    store.update_status(job["job_id"], JobStatus.INSPECTING)
    store.update_status(
        job["job_id"],
        JobStatus.ANALYZING,
        inspection={"mode": "mock", "executed": False, "message": "mock result"},
    )

    res = client.get(f"/jobs/{job['job_id']}/evidence")
    assert res.status_code == 200
    ev_list = res.json()
    assert len(ev_list) == 1
    assert ev_list[0]["is_mock"] is True
    assert ev_list[0]["baseline_screenshot_url"].startswith("mock://")
