"""Unit tests for confidence scoring and uncertainty reporting."""
import pytest

from schemas import AIFinding, DefectCategory
from uncertainty import annotate_findings, get_review_threshold, THRESHOLD_ENV_VAR


def _finding(confidence=0.9, review=False, notes=None):
    return AIFinding(
        job_id="j1",
        defect_category=DefectCategory.OVERLAPPING_TEXT,
        description="x",
        evidence_reference="a.png",
        confidence=confidence,
        requires_human_review=review,
        uncertainty_notes=notes,
    )


def test_threshold_defaults_to_half(monkeypatch):
    monkeypatch.delenv(THRESHOLD_ENV_VAR, raising=False)
    assert get_review_threshold() == 0.5


def test_threshold_read_from_environment(monkeypatch):
    monkeypatch.setenv(THRESHOLD_ENV_VAR, "0.7")
    assert get_review_threshold() == 0.7


@pytest.mark.parametrize("bad", ["abc", "1.5", "-0.1"])
def test_invalid_threshold_falls_back_to_default(monkeypatch, bad):
    monkeypatch.setenv(THRESHOLD_ENV_VAR, bad)
    assert get_review_threshold() == 0.5


def test_low_confidence_is_flagged_with_note(monkeypatch):
    monkeypatch.delenv(THRESHOLD_ENV_VAR, raising=False)
    f = _finding(confidence=0.3)
    annotate_findings([f])
    assert f.requires_human_review is True
    assert "Low confidence" in f.uncertainty_notes


def test_model_notes_are_kept(monkeypatch):
    monkeypatch.delenv(THRESHOLD_ENV_VAR, raising=False)
    f = _finding(confidence=0.3, notes="Blurry area")
    annotate_findings([f])
    assert f.uncertainty_notes.startswith("Blurry area")
    assert "Low confidence" in f.uncertainty_notes


def test_model_requested_review_gets_a_note(monkeypatch):
    monkeypatch.delenv(THRESHOLD_ENV_VAR, raising=False)
    f = _finding(confidence=0.9, review=True)
    annotate_findings([f])
    assert f.requires_human_review is True
    assert "Model requested human review" in f.uncertainty_notes


def test_repaired_response_forces_review_even_at_high_confidence(monkeypatch):
    monkeypatch.delenv(THRESHOLD_ENV_VAR, raising=False)
    f = _finding(confidence=0.95)
    annotate_findings([f], response_repaired=True)
    assert f.requires_human_review is True
    assert "repaired" in f.uncertainty_notes


def test_annotating_twice_does_not_duplicate_notes(monkeypatch):
    monkeypatch.delenv(THRESHOLD_ENV_VAR, raising=False)
    f = _finding(confidence=0.3)
    annotate_findings([f])
    annotate_findings([f])
    assert f.uncertainty_notes.count("Low confidence") == 1


def test_explicit_threshold_overrides_environment(monkeypatch):
    monkeypatch.setenv(THRESHOLD_ENV_VAR, "0.1")
    f = _finding(confidence=0.6)
    annotate_findings([f], threshold=0.8)
    assert f.requires_human_review is True


def test_confident_clean_finding_is_unchanged(monkeypatch):
    monkeypatch.delenv(THRESHOLD_ENV_VAR, raising=False)
    f = _finding(confidence=0.9)
    annotate_findings([f])
    assert f.requires_human_review is False
    assert f.uncertainty_notes is None