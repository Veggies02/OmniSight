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
if ev["step_name"] == os.environ.get("ERROR_WITH_EXIT_ZERO"):
    print(json.dumps({"has_defect": False, "findings": [], "provider": "mock", "error": "soft failure"}))
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
        (run_dir / sid / "baseline.png").write_bytes(b"png")
        entries.append({"scenarioId": sid, "route": "/products", "viewport": {"width": 1440, "height": 900},
                        "defectiveScreenshot": f"{sid}\\defective.png"})
    (run_dir / "model_facing_evidence.json").write_text(json.dumps({"runId": "run-t1", "scenarios": entries}))
    engine = tmp_path / "engine"
    engine.mkdir()
    (engine / "diagnose_cli.py").write_text(FAKE_CLI, encoding="utf-8")
    return repo, run_dir, engine


def run_wrapper(repo, engine, run_id="run-t1", extra_args=(), **extra_env):
    env = {k: v for k, v in os.environ.items() if k not in ("FAIL_SCENARIO", "FAKE_GARBAGE", "ERROR_WITH_EXIT_ZERO")}
    env["OMNISIGHT_EXPECTED_SCENARIOS"] = ",".join(SCENARIOS)  # the fixture has two scenarios, not the canonical four
    env.update(OMNISIGHT_REPO_ROOT=str(repo), OMNISIGHT_AI_ENGINE_DIR=str(engine), **extra_env)
    return subprocess.run([sys.executable, str(WRAPPER), "--run-id", run_id, "--provider", "mock", *extra_args],
                          capture_output=True, text=True, env=env, timeout=60)


def set_meta(run_dir, change):
    path = run_dir / "model_facing_evidence.json"
    meta = json.loads(path.read_text())
    change(meta)
    path.write_text(json.dumps(meta))


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


def test_a_non_null_error_with_exit_zero_is_still_a_failure(setup):
    repo, run_dir, engine = setup
    proc = run_wrapper(repo, engine, ERROR_WITH_EXIT_ZERO="mobile-nav-overflow")
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
    set_meta(run_dir, lambda m: m["scenarios"][0].update(defectiveScreenshot="..\\..\\..\\secret.png"))
    assert run_wrapper(repo, engine).returncode == 2


@pytest.mark.parametrize("name", ["baseline.png", "clean.png", "defective-baseline.png", "defective_clean.png"])
def test_a_baseline_or_clean_image_is_never_sent_to_the_model(setup, name):
    repo, run_dir, engine = setup
    (run_dir / "mobile-nav-overflow" / name).write_bytes(b"png")
    set_meta(run_dir, lambda m: m["scenarios"][0].update(defectiveScreenshot=f"mobile-nav-overflow/{name}"))
    proc = run_wrapper(repo, engine)
    assert proc.returncode == 2 and "not a defective image" in proc.stderr
    assert not (run_dir / "diagnoses").exists()


def test_a_symlinked_screenshot_is_refused(setup):
    repo, run_dir, engine = setup
    link = run_dir / "mobile-nav-overflow" / "defective.png"
    link.unlink()
    try:
        link.symlink_to(run_dir / "mobile-nav-overflow" / "baseline.png")
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are not permitted here")
    proc = run_wrapper(repo, engine)
    assert proc.returncode == 2 and "link" in proc.stderr


def test_a_screenshot_from_another_scenario_folder_is_refused(setup):
    repo, run_dir, engine = setup
    set_meta(run_dir, lambda m: m["scenarios"][0].update(defectiveScreenshot="product-image-distortion/defective.png"))
    assert run_wrapper(repo, engine).returncode == 2


def test_a_repeated_scenario_id_is_refused(setup):
    repo, run_dir, engine = setup
    set_meta(run_dir, lambda m: m["scenarios"].append(dict(m["scenarios"][0])))
    proc = run_wrapper(repo, engine)
    assert proc.returncode == 2 and "more than once" in proc.stderr


def test_an_empty_scenario_list_is_refused(setup):
    repo, run_dir, engine = setup
    set_meta(run_dir, lambda m: m.update(scenarios=[]))
    assert run_wrapper(repo, engine).returncode == 2


# ---- provenance and publication, in the shape scripts/vlm/diagnosis-manifest.ts validates ----
def test_the_manifest_and_attempt_state_carry_the_lock_attempt_id(setup):
    repo, run_dir, engine = setup
    proc = run_wrapper(repo, engine, extra_args=["--attempt-id", "attempt-123-abc-def"])
    assert proc.returncode == 0, proc.stderr
    diag = run_dir / "diagnoses"
    manifest = json.loads((diag / "diagnoses-manifest.json").read_text())
    state = json.loads((diag / "diagnosis-attempt.json").read_text())
    assert manifest["attemptId"] == "attempt-123-abc-def" and manifest["runId"] == "run-t1"
    assert manifest["status"] == "completed" and manifest["scenarioAliases"] == []
    assert manifest["outputArtifactsDirectory"] == str(diag)
    assert state["runId"] == "run-t1" and state["attemptId"] == manifest["attemptId"] and state["status"] == "completed"
    assert state["manifestPath"] == str(diag / "diagnoses-manifest.json")


def test_without_a_lock_id_one_is_generated_in_the_lock_format(setup):
    import re
    repo, run_dir, engine = setup
    assert run_wrapper(repo, engine).returncode == 0
    manifest = json.loads((run_dir / "diagnoses" / "diagnoses-manifest.json").read_text())
    assert re.match(r"^attempt-[A-Za-z0-9-]+$", manifest["attemptId"])


@pytest.mark.parametrize("bad", ["123", "attempt-", "attempt-../x", "attempt-a b", "ATTEMPT-1"])
def test_a_malformed_attempt_id_is_refused(setup, bad):
    repo, run_dir, engine = setup
    assert run_wrapper(repo, engine, extra_args=["--attempt-id", bad]).returncode == 2
    assert not (run_dir / "diagnoses").exists()


def test_publication_leaves_no_staging_folder_and_replaces_an_older_result(setup):
    repo, run_dir, engine = setup
    (run_dir / "diagnoses").mkdir()
    (run_dir / "diagnoses" / "old.json").write_text("{}")
    assert run_wrapper(repo, engine).returncode == 0
    assert not (run_dir / "diagnoses" / "old.json").exists()
    assert [p.name for p in run_dir.iterdir() if p.name.startswith(".diagnoses")] == []


def test_a_failed_run_keeps_the_previous_result_and_leaves_nothing_behind(setup):
    repo, run_dir, engine = setup
    (run_dir / "diagnoses").mkdir()
    (run_dir / "diagnoses" / "old.json").write_text("{}")
    assert run_wrapper(repo, engine, FAIL_SCENARIO="product-image-distortion").returncode == 1
    assert (run_dir / "diagnoses" / "old.json").exists()
    assert [p.name for p in run_dir.iterdir() if p.name.startswith(".diagnoses")] == []


def test_a_missing_canonical_scenario_fails_the_run(setup):
    repo, run_dir, engine = setup
    proc = run_wrapper(repo, engine, OMNISIGHT_EXPECTED_SCENARIOS=",".join(SCENARIOS + ["low-contrast-text"]))
    assert proc.returncode == 2 and "missing" in proc.stderr
    assert not (run_dir / "diagnoses").exists()


def test_an_aliased_or_unknown_scenario_is_refused_not_guessed(setup):
    repo, run_dir, engine = setup
    proc = run_wrapper(repo, engine, OMNISIGHT_EXPECTED_SCENARIOS="mobile-nav-overflow")
    assert proc.returncode == 2 and "product-image-distortion" in proc.stderr
    assert not (run_dir / "diagnoses").exists()


def test_the_default_expected_set_is_the_four_registry_scenarios(setup):
    repo, run_dir, engine = setup
    env = {k: v for k, v in os.environ.items() if k != "OMNISIGHT_EXPECTED_SCENARIOS"}
    env.update(OMNISIGHT_REPO_ROOT=str(repo), OMNISIGHT_AI_ENGINE_DIR=str(engine))
    proc = subprocess.run([sys.executable, str(WRAPPER), "--run-id", "run-t1", "--provider", "mock"],
                          capture_output=True, text=True, env=env, timeout=60)
    assert proc.returncode == 2 and "low-contrast-text" in proc.stderr and "product-card-layout-break" in proc.stderr
