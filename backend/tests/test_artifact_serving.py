"""Screenshot artifact serving: GET /jobs/{job_id}/artifacts/{artifact_id}/file

Only a screenshot that is registered to THAT job, is an image, and lives inside artifacts/ can be
downloaded. Placeholders, traversal, absolute paths, symlinks out of artifacts/, JSON files and
huge files are refused.
"""
import pytest
from fastapi.testclient import TestClient

import api
from api import create_app
from browser_runner import MockBrowserRunner
from job_schemas import ArtifactDraft
from job_store import JobStore

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


@pytest.fixture()
def env(tmp_path):
    repo = tmp_path / "repo"
    (repo / "artifacts" / "visual-evidence" / "run1").mkdir(parents=True)
    (repo / "backend").mkdir()
    db = tmp_path / "jobs.db"
    store = JobStore(db)
    client = TestClient(create_app(db_path=db, runner=MockBrowserRunner(), repo_root=repo))
    return repo, store, client


def add(store, uri, kind="screenshot", job=None):
    job = job or store.create_job("https://example.com")
    store.add_artifacts(job["job_id"], [ArtifactDraft(kind=kind, uri=uri)])
    artifact = store.get_job(job["job_id"])["artifacts"][-1]
    return job["job_id"], artifact["artifact_id"]


def url(job_id, artifact_id, prefix=""):
    return f"{prefix}/jobs/{job_id}/artifacts/{artifact_id}/file"


def test_serves_a_registered_screenshot(env):
    repo, store, client = env
    (repo / "artifacts/visual-evidence/run1/shot.png").write_bytes(PNG)
    job_id, art = add(store, "artifacts/visual-evidence/run1/shot.png")
    r = client.get(url(job_id, art))
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.content == PNG


def test_works_under_the_api_prefix_and_with_windows_separators(env):
    repo, store, client = env
    (repo / "artifacts/visual-evidence/run1/shot.png").write_bytes(PNG)
    job_id, art = add(store, "artifacts\\visual-evidence\\run1\\shot.png")
    assert client.get(url(job_id, art, "/api")).status_code == 200


def test_unknown_job_or_artifact_is_404(env):
    repo, store, client = env
    job_id, art = add(store, "artifacts/visual-evidence/run1/shot.png")
    assert client.get(url("job-nope", art)).status_code == 404
    assert client.get(url(job_id, "art-nope")).status_code == 404


def test_artifact_of_another_job_cannot_be_fetched_through_this_job(env):
    repo, store, client = env
    (repo / "artifacts/visual-evidence/run1/shot.png").write_bytes(PNG)
    _, art_a = add(store, "artifacts/visual-evidence/run1/shot.png")
    job_b = store.create_job("https://example.org")
    assert client.get(url(job_b["job_id"], art_a)).status_code == 404


def test_mock_placeholder_is_not_a_file(env):
    repo, store, client = env
    job_id, art = add(store, "mock://artifacts/job-1/homepage.png")
    assert client.get(url(job_id, art)).status_code == 404


def test_missing_file_on_disk_is_404(env):
    repo, store, client = env
    job_id, art = add(store, "artifacts/visual-evidence/run1/gone.png")
    assert client.get(url(job_id, art)).status_code == 404


@pytest.mark.parametrize("uri", [
    "artifacts/../backend/secret.png",
    "../outside.png",
    "artifacts/visual-evidence/../../backend/secret.png",
])
def test_traversal_out_of_artifacts_is_refused(env, uri):
    repo, store, client = env
    (repo / "backend" / "secret.png").write_bytes(PNG)
    (repo.parent / "outside.png").write_bytes(PNG)
    job_id, art = add(store, uri)
    assert client.get(url(job_id, art)).status_code == 404


def test_absolute_paths_are_refused(env, tmp_path):
    repo, store, client = env
    outside = tmp_path / "abs.png"
    outside.write_bytes(PNG)
    job_id, art = add(store, str(outside))
    assert client.get(url(job_id, art)).status_code == 404
    job_id, art = add(store, "C:/Windows/win.png")
    assert client.get(url(job_id, art)).status_code == 404


def test_symlink_pointing_outside_artifacts_is_refused(env, tmp_path):
    repo, store, client = env
    (repo / "backend" / "secret.png").write_bytes(PNG)
    link = repo / "artifacts" / "visual-evidence" / "run1" / "link.png"
    try:
        link.symlink_to(repo / "backend" / "secret.png")
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are not available here")
    job_id, art = add(store, "artifacts/visual-evidence/run1/link.png")
    assert client.get(url(job_id, art)).status_code == 404


def test_only_images_can_be_downloaded(env):
    repo, store, client = env
    (repo / "artifacts/visual-evidence/run1/ground_truth_eval.json").write_text("{}")
    job_id, art = add(store, "artifacts/visual-evidence/run1/ground_truth_eval.json", kind="other")
    assert client.get(url(job_id, art)).status_code == 415


def test_oversized_file_is_refused(env, monkeypatch):
    repo, store, client = env
    (repo / "artifacts/visual-evidence/run1/big.png").write_bytes(PNG + b"\x00" * 100)
    job_id, art = add(store, "artifacts/visual-evidence/run1/big.png")
    monkeypatch.setattr(api, "MAX_ARTIFACT_BYTES", 50)
    assert client.get(url(job_id, art)).status_code == 413
