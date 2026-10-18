"""Tests for the REAL runner (PlaywrightCliRunner) using a fake capture script.

The fake script prints the same lines as Person 1's harness and writes a manifest with
the same layout (paths relative to the run folder), so no browser or Node is needed.
Run from the backend/ folder:   pytest -v
"""
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from api import create_app
from browser_runner import PlaywrightCliRunner, RunnerError, runner_from_env

FAKE_CAPTURE = r'''
import json, os, sys, time
from pathlib import Path

mode = os.environ.get("FAKE_MODE", "ok")
run_id = "run-2026-10-18T10-00-00-000Z"
run_dir = Path.cwd() / "artifacts" / "visual-evidence" / run_id
print(f"Starting Visual Evidence Capture Harness (Run ID: {run_id})...")

if mode == "exit1":
    print("Visual evidence capture harness failed: browserType.launch: Executable doesn't exist", file=sys.stderr)
    sys.exit(1)
if mode == "hang":
    time.sleep(60)

run_dir.mkdir(parents=True, exist_ok=True)
if mode == "no_manifest":
    print(f"Artifacts saved in: {run_dir}")
    sys.exit(0)

scenarios = {}
for sid in ("s1", "s2"):
    folder = run_dir / sid
    folder.mkdir(exist_ok=True)
    entry = {"scenarioId": sid, "defectId": "d-" + sid, "route": "/products"}
    for side in ("baseline", "defective"):
        (folder / f"{side}.png").write_bytes(b"png")
        (folder / f"dom-{side}.html").write_text("<html></html>")
        (folder / f"measurements-{side}.json").write_text("{}")
        entry[side] = {
            "screenshotPath": f"{sid}/{side}.png",
            "domPath": f"{sid}/dom-{side}.html",
            "measurementsPath": f"{sid}/measurements-{side}.json",
        }
    scenarios[sid] = entry
if mode == "traversal":
    scenarios["s1"]["baseline"]["screenshotPath"] = "../../../../outside.png"

manifest = {
    "runId": run_id, "browser": "chromium", "totalScenarios": 2,
    "scenariosCaptured": 1 if mode == "partial" else 2,
    "success": mode != "partial", "artifactsDirectory": str(run_dir), "scenarios": scenarios,
}
(run_dir / "manifest.json").write_text(json.dumps(manifest))
(run_dir / "model_facing_evidence.json").write_text("{}")
(run_dir / "ground_truth_eval.json").write_text("{}")
print(f"Successfully captured {manifest['scenariosCaptured']}/2 scenarios.")
print(f"Artifacts saved in: {run_dir}")
'''


class _QuietHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


@pytest.fixture()
def app_server():
    """A tiny local web server standing in for the app on :5173."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


@pytest.fixture()
def repo(tmp_path):
    script = tmp_path / "fake_capture.py"
    script.write_text(FAKE_CAPTURE)
    return tmp_path


def make_runner(repo, base_url, **kwargs):
    return PlaywrightCliRunner(
        repo_root=repo,
        base_url=base_url,
        command=[sys.executable, str(repo / "fake_capture.py")],
        **kwargs,
    )


# --------------------------------------------------------------- success
def test_successful_capture_records_run_id_exit_code_and_artifact_refs(repo, app_server):
    result = make_runner(repo, app_server).run("job-1", app_server + "/")

    assert result.mode == "playwright" and result.executed is True
    assert result.run_id == "run-2026-10-18T10-00-00-000Z"
    assert result.exit_code == 0
    assert (result.scenarios_captured, result.total_scenarios) == (2, 2)
    assert "Successfully captured" in result.stdout_tail
    assert result.duration_seconds is not None

    # 3 run-level files + 2 scenarios x 2 sides x 3 files
    assert len(result.artifacts) == 15
    kinds = {a.kind for a in result.artifacts}
    assert {"screenshot", "dom_snapshot", "other"} <= kinds
    assert not any(a.mock for a in result.artifacts)
    for artifact in result.artifacts:
        assert artifact.uri.startswith("artifacts/visual-evidence/run-2026-10-18T10-00-00-000Z/")
        assert (repo / artifact.uri).is_file()
    truth = [a for a in result.artifacts if a.uri.endswith("ground_truth_eval.json")][0]
    assert "EVALUATION ONLY" in truth.description


def test_localhost_and_127_0_0_1_are_treated_as_the_same_app(repo, app_server):
    port = app_server.rsplit(":", 1)[1]
    runner = make_runner(repo, app_server)
    assert runner.run("job-1", f"http://localhost:{port}/").executed is True


# --------------------------------------------------------------- failures
def test_nonzero_exit_is_reported_with_exit_code_run_id_and_stderr(repo, app_server, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "exit1")
    with pytest.raises(RunnerError) as caught:
        make_runner(repo, app_server).run("job-1", app_server)
    inspection = caught.value.inspection
    assert inspection.exit_code == 1
    assert inspection.run_id == "run-2026-10-18T10-00-00-000Z"
    assert inspection.executed is False
    assert "Executable doesn't exist" in inspection.stderr_tail
    assert "exited with code 1" in str(caught.value)
    assert "Executable doesn't exist" in str(caught.value)  # the useful line, not the banner


def test_missing_manifest_is_a_failure(repo, app_server, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "no_manifest")
    with pytest.raises(RunnerError, match="no manifest"):
        make_runner(repo, app_server).run("job-1", app_server)


def test_incomplete_capture_fails_but_keeps_partial_artifacts(repo, app_server, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "partial")
    with pytest.raises(RunnerError, match="1/2") as caught:
        make_runner(repo, app_server).run("job-1", app_server)
    assert caught.value.inspection.executed is True
    assert len(caught.value.artifacts) == 15


def test_manifest_path_traversal_is_rejected(repo, app_server, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "traversal")
    with pytest.raises(RunnerError, match="outside the run folder"):
        make_runner(repo, app_server).run("job-1", app_server)


def test_hung_capture_times_out_and_is_stopped(repo, app_server, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "hang")
    with pytest.raises(RunnerError, match="timed out") as caught:
        make_runner(repo, app_server, timeout_seconds=1).run("job-1", app_server)
    assert caught.value.inspection.exit_code is None


def test_unsupported_url_is_rejected_before_anything_runs(repo, app_server):
    with pytest.raises(RunnerError, match="only supports"):
        make_runner(repo, app_server).run("job-1", "https://example.com")


def test_app_not_running_gives_a_helpful_message(repo):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        dead_url = f"http://127.0.0.1:{probe.getsockname()[1]}"
    with pytest.raises(RunnerError, match="npm run dev"):
        make_runner(repo, dead_url).run("job-1", dead_url)


def test_missing_npm_is_reported(repo, app_server, monkeypatch):
    monkeypatch.setattr("browser_runner.shutil.which", lambda name: None)
    runner = PlaywrightCliRunner(repo_root=repo, base_url=app_server)  # default command
    with pytest.raises(RunnerError, match="npm was not found"):
        runner.run("job-1", app_server)


# ----------------------------------------------------------------- factory
def test_factory_builds_the_real_runner_from_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("OMNISIGHT_REPO_ROOT", str(tmp_path))
    monkeypatch.setenv("OMNISIGHT_CAPTURE_BASE_URL", "http://127.0.0.1:5999")
    monkeypatch.setenv("OMNISIGHT_CAPTURE_TIMEOUT_SECONDS", "42")
    runner = runner_from_env("playwright")
    assert isinstance(runner, PlaywrightCliRunner)
    assert runner.base_url == "http://127.0.0.1:5999"
    assert runner.timeout_seconds == 42.0
    assert runner.repo_root == tmp_path.resolve()


# ----------------------------------------- through the API, webhook to job
def test_webhook_to_real_capture_to_persisted_job(repo, app_server, tmp_path_factory):
    db = tmp_path_factory.mktemp("db") / "jobs.db"
    app = TestClient(create_app(db_path=db, runner=make_runner(repo, app_server)))

    hook = app.post(
        "/webhooks/ci",
        json={
            "event_type": "build_success",
            "website_url": app_server,
            "repository": "Veggies02/OmniSight",
            "commit_sha": "5619e0c",
        },
    )
    assert hook.status_code == 201
    assert hook.json()["browser_result"]["type"] == "playwright"

    job = app.get(f"/jobs/{hook.json()['job_id']}").json()
    assert job["status"] == "analyzing"
    assert job["inspection"]["mode"] == "playwright"
    assert job["inspection"]["executed"] is True
    assert job["inspection"]["exit_code"] == 0
    assert job["inspection"]["run_id"].startswith("run-")
    assert len(job["artifacts"]) == 15
    assert not any(a["mock"] for a in job["artifacts"])


def test_failed_capture_marks_the_job_failed_and_keeps_the_details(repo, app_server, monkeypatch, tmp_path_factory):
    monkeypatch.setenv("FAKE_MODE", "exit1")
    db = tmp_path_factory.mktemp("db") / "jobs.db"
    app = TestClient(create_app(db_path=db, runner=make_runner(repo, app_server)))

    created = app.post("/jobs", json={"website_url": app_server})
    job = app.get(f"/jobs/{created.json()['job_id']}").json()
    assert job["status"] == "failed"
    assert "exited with code 1" in job["error"]
    assert job["inspection"]["exit_code"] == 1
    assert "Executable doesn't exist" in job["inspection"]["stderr_tail"]