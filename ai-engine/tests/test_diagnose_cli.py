"""Tests for the diagnose CLI entry point."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

CLI_PATH = str(Path(__file__).resolve().parent.parent / "diagnose_cli.py")
PYTHON = sys.executable


def _run_cli(*args: str, cwd: str | None = None) -> subprocess.CompletedProcess:
    """Run the CLI as a subprocess and capture output."""
    cmd = [PYTHON, CLI_PATH, *args]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=30,
        cwd=cwd or str(Path(__file__).resolve().parent.parent),
    )


def _make_evidence_file(tmp: str, overrides: dict | None = None) -> str:
    """Create a minimal evidence JSON file with a tiny valid PNG."""
    # 1x1 transparent PNG (67 bytes)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    screenshot_path = os.path.join(tmp, "test-screenshot.png")
    with open(screenshot_path, "wb") as f:
        f.write(png_bytes)

    data = {
        "job_id": "test-job-001",
        "screenshot_path": screenshot_path,
        "url": "http://localhost:5173/products",
        "route": "/products",
        "viewport": {"width": 375, "height": 812, "is_mobile": True},
    }
    if overrides:
        data.update(overrides)

    evidence_path = os.path.join(tmp, "evidence.json")
    with open(evidence_path, "w", encoding="utf-8") as f:
        json.dump(data, f)

    return evidence_path


def _make_run_dir(tmp: str) -> str:
    """Create a mock run directory with scenario sub-folders."""
    # 1x1 transparent PNG
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    run_dir = os.path.join(tmp, "run-test-001")
    os.makedirs(run_dir)

    for scenario in ["mobile-nav-overflow", "low-contrast-text"]:
        scenario_dir = os.path.join(run_dir, scenario)
        os.makedirs(scenario_dir)
        with open(os.path.join(scenario_dir, "defective-screenshot.png"), "wb") as f:
            f.write(png_bytes)

    return run_dir


# =====================================================================
# Exit code tests
# =====================================================================

class TestExitCodes:
    """Verify that exit codes match the contract."""

    def test_success_with_evidence_file(self, tmp_path):
        evidence = _make_evidence_file(str(tmp_path))
        result = _run_cli("--evidence-file", evidence, "--model", "mock")
        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert "job_id" in output
        assert output["job_id"] == "test-job-001"

    def test_invalid_input_missing_file(self):
        result = _run_cli("--evidence-file", "/nonexistent/path.json")
        assert result.returncode == 2

    def test_invalid_input_bad_json(self, tmp_path):
        bad_path = os.path.join(str(tmp_path), "bad.json")
        with open(bad_path, "w") as f:
            f.write("not json at all {{{")
        result = _run_cli("--evidence-file", bad_path)
        assert result.returncode == 2

    def test_invalid_input_missing_fields(self, tmp_path):
        path = os.path.join(str(tmp_path), "incomplete.json")
        with open(path, "w") as f:
            json.dump({"url": "http://localhost"}, f)
        result = _run_cli("--evidence-file", path)
        assert result.returncode == 2

    def test_no_arguments_shows_help(self):
        result = _run_cli()
        assert result.returncode == 2


# =====================================================================
# Output format tests
# =====================================================================

class TestOutputFormat:
    """Verify structured JSON output on stdout."""

    def test_output_is_valid_json(self, tmp_path):
        evidence = _make_evidence_file(str(tmp_path))
        result = _run_cli("--evidence-file", evidence, "--model", "mock")
        output = json.loads(result.stdout)
        assert isinstance(output, dict)

    def test_output_has_required_fields(self, tmp_path):
        evidence = _make_evidence_file(str(tmp_path))
        result = _run_cli("--evidence-file", evidence, "--model", "mock")
        output = json.loads(result.stdout)
        for key in ("job_id", "has_defect", "is_mock", "provider", "findings"):
            assert key in output, f"Missing field: {key}"

    def test_mock_provider_is_labelled(self, tmp_path):
        evidence = _make_evidence_file(str(tmp_path))
        result = _run_cli("--evidence-file", evidence, "--model", "mock")
        output = json.loads(result.stdout)
        assert output["is_mock"] is True
        assert output["provider"] == "mock"

    def test_raw_model_response_excluded(self, tmp_path):
        evidence = _make_evidence_file(str(tmp_path))
        result = _run_cli("--evidence-file", evidence, "--model", "mock")
        output = json.loads(result.stdout)
        assert "raw_model_response" not in output

    def test_diagnostics_on_stderr(self, tmp_path):
        evidence = _make_evidence_file(str(tmp_path))
        result = _run_cli("--evidence-file", evidence, "--model", "mock")
        assert "Analysis completed" in result.stderr


# =====================================================================
# Run directory mode tests
# =====================================================================

class TestRunDirMode:
    """Verify --run-dir mode handles scenario folders."""

    def test_run_dir_finds_scenarios(self, tmp_path):
        run_dir = _make_run_dir(str(tmp_path))
        result = _run_cli("--run-dir", run_dir, "--model", "mock")
        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert "scenarios" in output
        assert output["total_scenarios"] == 2

    def test_run_dir_scenario_keys(self, tmp_path):
        run_dir = _make_run_dir(str(tmp_path))
        result = _run_cli("--run-dir", run_dir, "--model", "mock")
        output = json.loads(result.stdout)
        scenarios = output["scenarios"]
        assert "mobile-nav-overflow" in scenarios
        assert "low-contrast-text" in scenarios

    def test_run_dir_each_scenario_has_analysis(self, tmp_path):
        run_dir = _make_run_dir(str(tmp_path))
        result = _run_cli("--run-dir", run_dir, "--model", "mock")
        output = json.loads(result.stdout)
        for name, analysis in output["scenarios"].items():
            assert "job_id" in analysis
            assert "has_defect" in analysis
            assert "findings" in analysis

    def test_run_dir_nonexistent(self):
        result = _run_cli("--run-dir", "/nonexistent/run-dir")
        assert result.returncode == 2

    def test_run_dir_empty(self, tmp_path):
        empty_dir = os.path.join(str(tmp_path), "empty-run")
        os.makedirs(empty_dir)
        result = _run_cli("--run-dir", empty_dir)
        assert result.returncode == 2


# =====================================================================
# Argument handling tests
# =====================================================================

class TestArguments:
    """Verify argument parsing and defaults."""

    def test_mutual_exclusion(self, tmp_path):
        evidence = _make_evidence_file(str(tmp_path))
        result = _run_cli("--evidence-file", evidence, "--run-dir", str(tmp_path))
        assert result.returncode == 2

    def test_timeout_flag_accepted(self, tmp_path):
        evidence = _make_evidence_file(str(tmp_path))
        result = _run_cli("--evidence-file", evidence, "--model", "mock", "--timeout", "30")
        assert result.returncode == 0

    def test_invalid_model_rejected(self, tmp_path):
        evidence = _make_evidence_file(str(tmp_path))
        result = _run_cli("--evidence-file", evidence, "--model", "invalid-provider")
        assert result.returncode == 2
