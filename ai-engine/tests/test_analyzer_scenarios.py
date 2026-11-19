"""Scenario tests: sample screenshots and realistic model responses, end to end."""
import json
import os
import struct

import pytest

import defect_analyzer
from defect_analyzer import analyze_evidence, validate_screenshot
from schemas import AnalysisResponse, DefectCategory
from vlm_client import MockVisionModel

SCREENSHOT_NAMES = ["clean", "clipped_button", "overlapping_text"]

AJAY_SCENARIOS = [
    ("mobile-nav-overflow", "modal_overflow"),
    ("product-card-layout-break", "incorrect_spacing"),
    ("product-image-distortion", "other"),
    ("low-contrast-text", "other"),
]


def _payload(*findings, has_defect=True):
    return {"has_defect": has_defect, "findings": list(findings)}


def _finding(category, confidence=0.9, description="Problem found"):
    return {
        "defect_category": category,
        "description": description,
        "confidence": confidence,
    }


@pytest.fixture(autouse=True)
def default_threshold(monkeypatch):
    monkeypatch.delenv("REVIEW_CONFIDENCE_THRESHOLD", raising=False)


# --- Sample screenshots ---

@pytest.mark.parametrize("name", SCREENSHOT_NAMES)
def test_sample_screenshot_is_a_valid_mobile_png(screenshots, name):
    path = screenshots[name]
    with open(path, "rb") as f:
        data = f.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", data[16:24]) == (375, 812)
    assert os.path.getsize(path) < defect_analyzer.MAX_FILE_SIZE_BYTES
    validate_screenshot(path)  # should not raise


@pytest.mark.parametrize("name", SCREENSHOT_NAMES)
def test_pipeline_handles_every_sample_screenshot(make_evidence, name):
    result = analyze_evidence(make_evidence(name), MockVisionModel())
    assert isinstance(result, AnalysisResponse)
    assert result.job_id == "scenario-job"


# --- Ajay's seeded defects, end to end ---

@pytest.mark.parametrize("seeded_id, expected", AJAY_SCENARIOS)
def test_seeded_defect_ids_map_to_taxonomy(make_evidence, seeded_id, expected):
    canned = json.dumps(_payload(_finding(seeded_id, confidence=0.8)))
    result = analyze_evidence(make_evidence("clipped_button"), MockVisionModel(canned_response=canned))
    assert result.has_defect is True
    assert result.findings[0].defect_category.value == expected


# --- Response shapes ---

def test_clean_page_reports_no_defect(make_evidence):
    canned = json.dumps(_payload(has_defect=False))
    result = analyze_evidence(make_evidence("clean"), MockVisionModel(canned_response=canned))
    assert result.has_defect is False
    assert result.findings == []


def test_fenced_response_with_surrounding_prose(make_evidence):
    canned = (
        "Here is my analysis:\n```json\n"
        + json.dumps(_payload(_finding("overlapping_text", 0.9)))
        + "\n```\nLet me know if you need more."
    )
    result = analyze_evidence(make_evidence("overlapping_text"), MockVisionModel(canned_response=canned))
    finding = result.findings[0]
    assert finding.defect_category == DefectCategory.OVERLAPPING_TEXT
    assert finding.requires_human_review is False
    assert finding.uncertainty_notes is None


def test_multiple_findings_keep_their_order(make_evidence):
    canned = json.dumps(_payload(
        _finding("mobile_button_clipping"),
        _finding("overlapping_text"),
    ))
    result = analyze_evidence(make_evidence("clipped_button"), MockVisionModel(canned_response=canned))
    assert [f.defect_category.value for f in result.findings] == [
        "mobile_button_clipping", "overlapping_text",
    ]


def test_only_low_confidence_finding_is_flagged(make_evidence):
    canned = json.dumps(_payload(
        _finding("overlapping_text", confidence=0.9),
        _finding("hidden_control", confidence=0.3),
    ))
    result = analyze_evidence(make_evidence("overlapping_text"), MockVisionModel(canned_response=canned))
    assert [f.requires_human_review for f in result.findings] == [False, True]


def test_result_carries_job_evidence_and_raw_response(make_evidence):
    evidence = make_evidence("clipped_button", job_id="job-77")
    canned = json.dumps(_payload(_finding("mobile_button_clipping")))
    result = analyze_evidence(evidence, MockVisionModel(canned_response=canned))
    assert result.job_id == "job-77"
    assert result.findings[0].job_id == "job-77"
    assert result.findings[0].evidence_reference == evidence.screenshot_path
    assert result.raw_model_response == canned
    assert isinstance(result.analysis_latency_ms, float)
    assert result.analysis_latency_ms >= 0


def test_multi_finding_result_survives_json_round_trip(make_evidence):
    canned = json.dumps(_payload(
        _finding("mobile_button_clipping"),
        _finding("modal_overflow"),
    ))
    result = analyze_evidence(make_evidence("clipped_button"), MockVisionModel(canned_response=canned))
    restored = AnalysisResponse.model_validate_json(result.model_dump_json())
    assert [f.defect_category for f in restored.findings] == [
        f.defect_category for f in result.findings
    ]


# --- Screenshot validation edge cases ---

@pytest.mark.parametrize("ext", [".jpg", ".jpeg", ".webp", ".PNG"])
def test_supported_extensions_are_accepted(tmp_path, ext):
    path = tmp_path / f"shot{ext}"
    path.write_bytes(b"fake image bytes")
    validate_screenshot(str(path))  # should not raise


def test_file_exactly_at_size_limit_is_accepted(tmp_path, monkeypatch):
    monkeypatch.setattr(defect_analyzer, "MAX_FILE_SIZE_BYTES", 10)
    path = tmp_path / "shot.png"
    path.write_bytes(b"x" * 10)
    validate_screenshot(str(path))  # should not raise


def test_file_over_size_limit_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(defect_analyzer, "MAX_FILE_SIZE_BYTES", 10)
    path = tmp_path / "shot.png"
    path.write_bytes(b"x" * 11)
    with pytest.raises(ValueError, match="exceeds 10 MB limit"):
        validate_screenshot(str(path))


def test_directory_path_is_rejected(tmp_path):
    with pytest.raises(FileNotFoundError):
        validate_screenshot(str(tmp_path))