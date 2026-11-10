import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

WRAPPER = Path(__file__).resolve().parent.parent / "diagnose_wrapper.py"

FAKE_CLI = '''
import json, os, sys
args = sys.argv
ev = json.load(open(args[args.index("--evidence-file") + 1], encoding="utf-8"))
if ev["step_name"] == os.environ.get("FAIL_SCENARIO"):
    print(json.dumps({"has_defect": False, "findings": [], "provider": "mock", "error": "boom"}))
    sys.exit(1)
if os.environ.get("FAKE_GARBAGE"):
    print("this is not json")
    sys.exit(0)
print(json.dumps({"job_id": ev["job_id"], "has_defect": True, "is_mock": True, "provider": "mock", "error": None,
    "analysis_latency_ms": 3.0,
    "findings": [{"defect_category": "mobile_button_clipping", "description": "Button clipped",
                  "evidence_reference": ev["screenshot_path"], "target_selector": ".btn",
                  "target_component": None, "confidence": 0.9, "uncertainty_notes": None,
                  "requires_human_review": False, "suggested_next_step": "Fix padding"}]}))
'''

SCENARIOS = ["mobile-nav-overflow", "product-image-distortion"]


@pytest.fixture
def setup(tmp_path):
    repo = tmp_path / "repo"
    run_dir = repo / "artifacts" / "visual-evidence" / "run-t1"
    entries = []
    for sid in SCENARIOS:
        (run_dir / sid).mkdir(parents=True)
        (run_dir / sid / "defective.png").write_bytes(b"png")
        entries.append({"scenarioId": sid, "route": "/products", "viewport": {"width": 1440, "height": 900},
                        "defectiveScreenshot": f"{sid}\\defective.png"})
    (run_dir / "model_facing_evidence.json").write_text(json.dumps({"runId": "run-t1", "scenarios": entries}))
    engine = tmp_path / "engine"
    engine.mkdir()
    (engine / "diagnose_cli.py").write_text(FAKE_CLI, encoding="utf-8")
    return repo, run_dir, engine


def run_wrapper(repo, engine, run_id="run-t1", **extra_env):
    env = {k: v for k, v in os.environ.items() if k not in ("FAIL_SCENARIO", "FAKE_GARBAGE")}
    env.update(OMNISIGHT_REPO_ROOT=str(repo), OMNISIGHT_AI_ENGINE_DIR=str(engine), **extra_env)
    return subprocess.run([sys.executable, str(WRAPPER), "--run-id", run_id, "--provider", "mock"],
                          capture_output=True, text=True, env=env, timeout=60)


def test_success_writes_all_files(setup):
    repo, run_dir, engine = setup
    proc = run_wrapper(repo, engine)
    assert proc.returncode == 0, proc.stderr
    diag = run_dir / "diagnoses"
    for sid in SCENARIOS:
        assert (diag / f"{sid}-diagnosis.json").is_file()
    manifest = json.loads((diag / "diagnoses-manifest.json").read_text())
    assert manifest["totalScenarios"] == 2 and manifest["scenariosDiagnosed"] == 2 and manifest["provider"] == "mock"
    one = json.loads((diag / "mobile-nav-overflow-diagnosis.json").read_text())
    assert one["sanitizedEvidenceRef"]["viewport"] == {"width": 1440, "height": 900}
    assert one["diagnosis"]["defects"][0]["evidence"] == ["mobile-nav-overflow/defective.png"]  # no local path


def test_one_failed_scenario_publishes_nothing(setup):
    repo, run_dir, engine = setup
    proc = run_wrapper(repo, engine, FAIL_SCENARIO="product-image-distortion")
    assert proc.returncode == 1
    assert not (run_dir / "diagnoses").exists()


def test_unparseable_engine_output_is_a_failure(setup):
    repo, run_dir, engine = setup
    proc = run_wrapper(repo, engine, FAKE_GARBAGE="1")
    assert proc.returncode == 1
    assert not (run_dir / "diagnoses").exists()


def test_engine_dir_is_required(setup):
    repo, _, engine = setup
    proc = run_wrapper(repo, engine / "missing")
    assert proc.returncode == 2


def test_bad_run_id_is_refused(setup):
    repo, _, engine = setup
    assert run_wrapper(repo, engine, run_id="../x").returncode == 2


def test_screenshot_path_traversal_is_refused(setup):
    repo, run_dir, engine = setup
    meta_path = run_dir / "model_facing_evidence.json"
    meta = json.loads(meta_path.read_text())
    meta["scenarios"][0]["defectiveScreenshot"] = "..\\..\\..\\secret.png"
    meta_path.write_text(json.dumps(meta))
    assert run_wrapper(repo, engine).returncode == 2