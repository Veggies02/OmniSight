"""ProposalPipeline with fake diagnosis/proposal commands (no Node, no network)."""
import json
import sys

import pytest

from proposal_pipeline import PipelineError, ProposalPipeline

FAKE = r'''
import json, os, sys, time
from pathlib import Path

step = sys.argv[1]
args = sys.argv[2:]
run_id = args[args.index("--run-id") + 1]
mode = os.environ.get("FAKE_MODE", "ok")
root = Path.cwd()
Path(root / "calls.log").open("a").write(step + " " + " ".join(args) + "\n")

if step == "diagnose":
    if mode == "leak":
        print("Diagnosis pipeline failed: CRITICAL LEAKAGE DETECTED: Ground-truth token 'x' found", file=sys.stderr)
        sys.exit(1)
    if mode == "hang":
        time.sleep(30)
    d = root / "artifacts" / "visual-evidence" / run_id / "diagnoses"
    d.mkdir(parents=True, exist_ok=True)
    if mode != "no_manifest":
        (d / "diagnoses-manifest.json").write_text("{}")
else:
    out = root / "artifacts" / "repair-proposals" / run_id
    if mode == "no_proposals":
        sys.exit(0)
    out.mkdir(parents=True, exist_ok=True)
    body = {
        "mobile-nav-overflow": {"proposalId": "p1", "scenarioId": "mobile-nav-overflow", "diagnosisRef": {"provider": "mock"}},
        "low-contrast-text": {"proposalId": "p2", "scenarioId": "low-contrast-text"},
    }
    if mode == "mismatch":
        body["low-contrast-text"]["scenarioId"] = "other"
    if mode == "not_object":
        body = [1, 2]
    if mode == "bad_entry":
        body["low-contrast-text"] = "oops"
    (out / "repair_proposals.json").write_text(json.dumps(body))
'''
RUN = "run-2026-10-25T14-04-09-832Z"


@pytest.fixture()
def repo(tmp_path):
    (tmp_path / "fake.py").write_text(FAKE)
    run_dir = tmp_path / "artifacts" / "visual-evidence" / RUN
    run_dir.mkdir(parents=True)
    (run_dir / "model_facing_evidence.json").write_text("{}")
    return tmp_path


def make(repo, **kw):
    py = sys.executable
    return ProposalPipeline(
        repo_root=repo,
        diagnose_command=[py, str(repo / "fake.py"), "diagnose"],
        proposals_command=[py, str(repo / "fake.py"), "proposals"],
        **kw,
    )


def calls(repo):
    path = repo / "calls.log"
    return path.read_text().splitlines() if path.exists() else []


def test_happy_path_returns_proposals_keyed_by_scenario(repo):
    result = make(repo).run(RUN)
    assert set(result.proposals) == {"mobile-nav-overflow", "low-contrast-text"}
    assert result.proposals["mobile-nav-overflow"]["diagnosisRef"]["provider"] == "mock"
    assert result.provider == "mock"
    assert result.proposals_path == f"artifacts/repair-proposals/{RUN}/repair_proposals.json"
    c = calls(repo)
    assert c[0] == f"diagnose --run-id {RUN} --provider mock"
    assert c[1] == f"proposals --run-id {RUN}"


def test_failed_diagnosis_stops_before_proposals(repo, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "leak")
    with pytest.raises(PipelineError) as exc:
        make(repo).run(RUN)
    assert exc.value.code == "diagnosis_failed" and exc.value.stage == "diagnosis"
    assert "LEAKAGE" in str(exc.value)
    assert not any(line.startswith("proposals") for line in calls(repo))


def test_stale_diagnoses_and_proposals_are_deleted_first(repo, monkeypatch):
    stale_d = repo / "artifacts" / "visual-evidence" / RUN / "diagnoses"
    stale_d.mkdir()
    (stale_d / "diagnoses-manifest.json").write_text('{"stale": true}')
    stale_p = repo / "artifacts" / "repair-proposals" / RUN
    stale_p.mkdir(parents=True)
    (stale_p / "repair_proposals.json").write_text('{"old": {"proposalId": "old"}}')
    monkeypatch.setenv("FAKE_MODE", "leak")
    with pytest.raises(PipelineError):
        make(repo).run(RUN)
    assert not stale_d.exists()  # a failed diagnosis must not leave old results to be picked up
    assert not stale_p.exists()


def test_old_proposals_are_not_returned_when_generation_writes_nothing(repo, monkeypatch):
    stale_p = repo / "artifacts" / "repair-proposals" / RUN
    stale_p.mkdir(parents=True)
    (stale_p / "repair_proposals.json").write_text('{"old": {"proposalId": "old"}}')
    monkeypatch.setenv("FAKE_MODE", "no_proposals")
    with pytest.raises(PipelineError) as exc:
        make(repo).run(RUN)
    assert exc.value.code == "proposals_missing"


def test_diagnosis_without_manifest_is_an_error(repo, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "no_manifest")
    with pytest.raises(PipelineError) as exc:
        make(repo).run(RUN)
    assert exc.value.code == "diagnosis_no_output"
    assert not any(line.startswith("proposals") for line in calls(repo))


def test_timeout_is_reported_and_stops(repo, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "hang")
    with pytest.raises(PipelineError) as exc:
        make(repo, timeout_seconds=1).run(RUN)
    assert exc.value.code == "diagnosis_timeout"


@pytest.mark.parametrize("bad", ["", "../x", "a b", "-x", ".hidden", "x" * 101, "a/b", "a\\b", "a;b"])
def test_bad_run_ids_are_refused_and_nothing_runs(repo, bad):
    with pytest.raises(PipelineError) as exc:
        make(repo).run(bad)
    assert exc.value.code == "invalid_run_id"
    assert calls(repo) == []


def test_unknown_run_folder_is_refused(repo):
    with pytest.raises(PipelineError) as exc:
        make(repo).run("run-does-not-exist")
    assert exc.value.code == "no_evidence"
    assert calls(repo) == []


def test_capture_without_model_facing_file_is_refused(repo):
    (repo / "artifacts" / "visual-evidence" / RUN / "model_facing_evidence.json").unlink()
    with pytest.raises(PipelineError) as exc:
        make(repo).run(RUN)
    assert exc.value.code == "no_evidence"


@pytest.mark.parametrize("mode", ["mismatch", "not_object", "bad_entry"])
def test_malformed_proposals_file_is_an_error(repo, monkeypatch, mode):
    monkeypatch.setenv("FAKE_MODE", mode)
    with pytest.raises(PipelineError) as exc:
        make(repo).run(RUN)
    assert exc.value.code == "proposals_invalid"


def test_invalid_provider_is_refused_at_construction(repo):
    with pytest.raises(ValueError):
        ProposalPipeline(repo_root=repo, provider="mock; rm -rf /")


def test_never_reads_ground_truth(repo):
    (repo / "artifacts" / "visual-evidence" / RUN / "ground_truth_eval.json").write_text("{not json")
    assert make(repo).run(RUN).proposals  # would raise if it parsed the file