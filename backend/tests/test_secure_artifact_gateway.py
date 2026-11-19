"""Security audit test suite for the OmniSight Secure Artifact Gateway.

Verifies:
1. Whitelisted category isolation (visual-evidence, repair-executions, verification, screenshots).
2. Defense-in-depth against directory traversal (../, URL-encoded %2e%2e, backslash, null bytes).
3. Symlink escape containment.
4. Prevention of evaluation data leakage (ground_truth_eval.json, *ground_truth*).
5. Prevention of Stored XSS via HTML DOM snapshots (forced text/plain MIME type).
6. Safe MIME type allowlist and rejection of executable formats (.sh, .py, .exe, .bin).
7. Operator authentication enforcement for sensitive repair-execution reports.
8. Defense-in-depth security headers (X-Content-Type-Options: nosniff, etc.).
9. Directory browsing suppression (no directory listing leakage).
10. Dual route mounting (/artifacts/... and /api/artifacts/...).
"""
import os
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from api import create_app
import main


@pytest.fixture
def artifact_fixture(tmp_path):
    """Sets up an isolated, controlled artifacts directory fixture."""
    artifacts_dir = tmp_path / "artifacts"
    artifacts_dir.mkdir(parents=True)

    # 1. visual-evidence scenario
    ve_dir = artifacts_dir / "visual-evidence" / "run-2026-11-08-001" / "product-image-distortion"
    ve_dir.mkdir(parents=True)
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
    (ve_dir / "baseline.png").write_bytes(png_bytes)
    (ve_dir / "defective.png").write_bytes(png_bytes)
    (ve_dir / "sample.jpg").write_bytes(b"\xff\xd8\xff\xe0\x00\x10JFIF")
    (ve_dir / "sample.webp").write_bytes(b"RIFF\x00\x00\x00\x00WEBP")
    (ve_dir / "measurements.json").write_text('{"width": 400, "height": 300}')
    (ve_dir / "dom-defective.html").write_text("<div class='broken'><script>alert('xss')</script></div>")
    (ve_dir / "run.log").write_text("Scenario execution completed successfully.")

    # Ground truth answer key (MUST BE BLOCKED)
    (ve_dir / "ground_truth_eval.json").write_text('{"answer_key": "product-image-distortion-fix"}')
    (ve_dir / "secret_ground_truth.json").write_text('{"secret": "answer"}')

    # Run manifest
    manifest_dir = artifacts_dir / "visual-evidence" / "run-2026-11-08-001"
    (manifest_dir / "manifest.json").write_text('{"run_id": "run-2026-11-08-001", "success": true}')

    # 2. repair-executions scenario
    rep_dir = artifacts_dir / "repair-executions" / "job-101"
    rep_dir.mkdir(parents=True)
    (rep_dir / "repair_execution_report.json").write_text('{"job_id": "job-101", "passed": true}')

    # 3. Disallowed categories
    worktree_dir = artifacts_dir / "repair-worktrees" / "worktree-101"
    worktree_dir.mkdir(parents=True)
    (worktree_dir / "source_secret.txt").write_text("confidential worktree state")

    backend_dir = artifacts_dir / "integration-backend"
    backend_dir.mkdir(parents=True)
    (backend_dir / "internal.py").write_text("import secret")

    jobs_dir = artifacts_dir / "repair-jobs" / "job-101"
    jobs_dir.mkdir(parents=True)
    (jobs_dir / "proposal.json").write_text('{"unapproved": true}')

    # 4. Sensitive root files
    (artifacts_dir / "jobs.db").write_text("sqlite database fake")
    (artifacts_dir / ".env").write_text("PRIVATE_KEY=secret")
    (artifacts_dir / "secret_outside.txt").write_text("outside secret")

    # 5. Malicious symlink pointing outside visual-evidence
    symlink_path = ve_dir / "escaped_link.txt"
    try:
        os.symlink(artifacts_dir / "secret_outside.txt", symlink_path)
    except OSError:
        pass

    # Malicious script in visual evidence
    (ve_dir / "exploit.sh").write_text("#!/bin/sh\nrm -rf /")
    (ve_dir / "malicious.py").write_text("print('pwned')")

    return artifacts_dir


@pytest.fixture
def client_with_token(tmp_path, artifact_fixture):
    db_path = tmp_path / "test_jobs.db"
    app = create_app(
        db_path=db_path,
        operator_token="super-secret-operator-token",
        artifacts_dir=artifact_fixture,
    )
    return TestClient(app)


@pytest.fixture
def client_without_token(tmp_path, artifact_fixture):
    db_path = tmp_path / "test_jobs_notoken.db"
    app = create_app(
        db_path=db_path,
        operator_token="",
        artifacts_dir=artifact_fixture,
    )
    return TestClient(app)


# ============================================================================
# Category Isolation & Whitelist Enforcement
# ============================================================================

def test_whitelisted_category_visual_evidence_accessible(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/baseline.png")
    assert res.status_code == 200
    assert res.headers["Content-Type"].startswith("image/png")
    assert b"PNG" in res.content


def test_disallowed_category_integration_backend_forbidden(client_with_token):
    res = client_with_token.get("/artifacts/integration-backend/internal.py")
    assert res.status_code == 403
    assert "not accessible" in res.json()["detail"].lower()


def test_disallowed_category_repair_worktrees_forbidden(client_with_token):
    res = client_with_token.get("/artifacts/repair-worktrees/worktree-101/source_secret.txt")
    assert res.status_code == 403
    assert "not accessible" in res.json()["detail"].lower()


def test_disallowed_category_repair_jobs_forbidden(client_with_token):
    res = client_with_token.get("/artifacts/repair-jobs/job-101/proposal.json")
    assert res.status_code == 403
    assert "not accessible" in res.json()["detail"].lower()


def test_invalid_category_characters_rejected(client_with_token):
    res = client_with_token.get("/artifacts/invalid$category/run/test.png")
    assert res.status_code == 403


# ============================================================================
# Path Traversal & Canonicalization Tests
# ============================================================================

def test_raw_dot_dot_path_traversal_rejected(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/../jobs.db")
    assert res.status_code in (403, 404)


def test_deep_dot_dot_traversal_rejected(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/../../../../etc/passwd")
    assert res.status_code in (403, 404)


def test_url_encoded_dot_dot_traversal_rejected(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/%2e%2e/%2e%2e/jobs.db")
    assert res.status_code in (400, 403)


def test_mixed_url_encoded_traversal_rejected(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/%2E%2E%2Frun/baseline.png")
    assert res.status_code in (400, 403)


def test_backslash_traversal_rejected(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/..\\..\\jobs.db")
    assert res.status_code in (400, 403)


def test_null_byte_injection_rejected(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001%00/test.png")
    assert res.status_code in (400, 403)


def test_symlink_escape_rejected(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/escaped_link.txt")
    assert res.status_code in (403, 404)


# ============================================================================
# Information Leakage & Answer Key (Ground Truth) Protection
# ============================================================================

def test_ground_truth_eval_access_strictly_forbidden(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/ground_truth_eval.json")
    assert res.status_code == 403
    assert "ground truth" in res.json()["detail"].lower()


def test_any_file_containing_ground_truth_forbidden(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/secret_ground_truth.json")
    assert res.status_code == 403
    assert "ground truth" in res.json()["detail"].lower()


def test_hidden_env_file_forbidden(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/.env")
    assert res.status_code in (403, 404)


def test_jobs_db_forbidden(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/jobs.db")
    assert res.status_code in (403, 404)


# ============================================================================
# Stored XSS Mitigation: HTML DOM Snapshot Forced Text/Plain
# ============================================================================

def test_dom_snapshot_served_as_text_plain_preventing_xss(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/dom-defective.html")
    assert res.status_code == 200
    # Must NOT be text/html
    assert "text/html" not in res.headers["Content-Type"].lower()
    assert res.headers["Content-Type"].startswith("text/plain")
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert "<script>" in res.text


# ============================================================================
# File Type Allowlist & Executable Blocking
# ============================================================================

def test_executable_script_sh_rejected(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/exploit.sh")
    assert res.status_code == 415
    assert "not permitted" in res.json()["detail"].lower()


def test_python_script_rejected(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/malicious.py")
    assert res.status_code == 415
    assert "not permitted" in res.json()["detail"].lower()


def test_supported_media_formats_served(client_with_token):
    base = "/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion"

    # JPEG
    res_jpg = client_with_token.get(f"{base}/sample.jpg")
    assert res_jpg.status_code == 200
    assert res_jpg.headers["Content-Type"].startswith("image/jpeg")

    # WebP
    res_webp = client_with_token.get(f"{base}/sample.webp")
    assert res_webp.status_code == 200
    assert res_webp.headers["Content-Type"].startswith("image/webp")

    # JSON measurements
    res_json = client_with_token.get(f"{base}/measurements.json")
    assert res_json.status_code == 200
    assert res_json.headers["Content-Type"].startswith("application/json")

    # Log text
    res_log = client_with_token.get(f"{base}/run.log")
    assert res_log.status_code == 200
    assert res_log.headers["Content-Type"].startswith("text/plain")


# ============================================================================
# Directory Browsing Suppression & 404 Handling
# ============================================================================

def test_directory_path_returns_404_no_listing(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_missing_file_returns_404(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/nonexistent.png")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


# ============================================================================
# Operator Authentication for Sensitive Execution Reports
# ============================================================================

def test_repair_executions_without_operator_token_fails_401(client_with_token):
    res = client_with_token.get("/artifacts/repair-executions/job-101/repair_execution_report.json")
    assert res.status_code == 401
    assert "missing or wrong x-operator-token" in res.json()["detail"].lower()


def test_repair_executions_with_invalid_operator_token_fails_401(client_with_token):
    res = client_with_token.get(
        "/artifacts/repair-executions/job-101/repair_execution_report.json",
        headers={"X-Operator-Token": "wrong-token"},
    )
    assert res.status_code == 401
    assert "missing or wrong x-operator-token" in res.json()["detail"].lower()


def test_repair_executions_with_valid_operator_token_succeeds(client_with_token):
    res = client_with_token.get(
        "/artifacts/repair-executions/job-101/repair_execution_report.json",
        headers={"X-Operator-Token": "super-secret-operator-token"},
    )
    assert res.status_code == 200
    assert res.headers["Content-Type"].startswith("application/json")
    assert res.json()["job_id"] == "job-101"


def test_visual_evidence_accessible_without_operator_token_even_when_token_configured(client_with_token):
    # Visual evidence is public read for review UI
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/baseline.png")
    assert res.status_code == 200


# ============================================================================
# Route Mounting & Aliasing (/api prefix and shorthand)
# ============================================================================

def test_api_prefix_route_alias_works(client_with_token):
    res = client_with_token.get("/api/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/baseline.png")
    assert res.status_code == 200
    assert res.headers["Content-Type"].startswith("image/png")


def test_shorthand_route_works(client_with_token):
    # Shorthand route automatically detects visual-evidence category prefix
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/manifest.json")
    assert res.status_code == 200
    assert res.json()["run_id"] == "run-2026-11-08-001"


# ============================================================================
# Security Response Headers Verification
# ============================================================================

def test_security_headers_present_on_all_responses(client_with_token):
    res = client_with_token.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/baseline.png")
    assert res.status_code == 200
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"
    assert "private" in res.headers.get("Cache-Control", "")
    assert res.headers.get("Content-Disposition") == "inline"


# ============================================================================
# Root Hardened Application Integration Test
# ============================================================================

def test_hardened_main_app_serves_artifacts(tmp_path, artifact_fixture):
    import importlib.util
    root_main_path = Path(__file__).resolve().parent.parent.parent / "main.py"
    spec = importlib.util.spec_from_file_location("omnisight_root_main", root_main_path)
    root_main = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(root_main)

    db_path = tmp_path / "hardened_jobs.db"
    hardened_app = root_main.create_hardened_app(
        enforce_sandbox=False,
        db_path=db_path,
        operator_token="main-test-token",
        artifacts_dir=artifact_fixture,
    )
    with TestClient(hardened_app) as client:
        # Check health endpoint
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"

        # Check artifact serving through hardened root app
        art = client.get("/artifacts/visual-evidence/run-2026-11-08-001/product-image-distortion/baseline.png")
        assert art.status_code == 200
        assert art.headers.get("X-Content-Type-Options") == "nosniff"
