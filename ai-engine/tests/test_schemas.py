"""Unit tests for Pydantic schemas in schemas.py."""
import pytest
from pydantic import ValidationError
from schemas import (
    DefectCategory,
    ViewportConfig,
    EvidenceContext,
    AIFinding,
    AnalysisResponse,
    BoundingBox
)


def test_defect_category_enum_values():
    assert DefectCategory.MOBILE_BUTTON_CLIPPING.value == "mobile_button_clipping"
    assert DefectCategory.OVERLAPPING_TEXT.value == "overlapping_text"
    assert DefectCategory.HIDDEN_CONTROL.value == "hidden_control"
    assert DefectCategory.INCORRECT_SPACING.value == "incorrect_spacing"
    assert DefectCategory.MODAL_OVERFLOW.value == "modal_overflow"


def test_valid_evidence_context():
    context = EvidenceContext(
        job_id="job-101",
        screenshot_path="/artifacts/job-101/step_1.png",
        url="http://localhost:5173/products",
        route="/products",
        viewport=ViewportConfig(width=375, height=812, is_mobile=True)
    )
    assert context.job_id == "job-101"
    assert context.viewport.is_mobile is True
    assert context.viewport.width == 375


def test_valid_ai_finding_creation():
    finding = AIFinding(
        job_id="job-101",
        defect_category=DefectCategory.MOBILE_BUTTON_CLIPPING,
        description="The 'Add to Cart' button is truncated at 375px viewport.",
        evidence_reference="/artifacts/job-101/step_1.png",
        confidence=0.92,
        target_selector="button.add-to-cart",
        suggested_next_step="Inspect flex wrap or padding in ProductCard.tsx"
    )
    assert finding.finding_id.startswith("fnd_")
    assert finding.confidence == 0.92
    assert finding.requires_human_review is False
    assert finding.defect_category == DefectCategory.MOBILE_BUTTON_CLIPPING


def test_confidence_validation_bounds():
    # Confidence must be between 0.0 and 1.0
    with pytest.raises(ValidationError):
        AIFinding(
            job_id="job-101",
            defect_category=DefectCategory.OVERLAPPING_TEXT,
            description="Text overlapping",
            evidence_reference="test.png",
            confidence=1.5  # Invalid: > 1.0
        )

    with pytest.raises(ValidationError):
        AIFinding(
            job_id="job-101",
            defect_category=DefectCategory.OVERLAPPING_TEXT,
            description="Text overlapping",
            evidence_reference="test.png",
            confidence=-0.1  # Invalid: < 0.0
        )


def test_bounding_box_validation():
    box = BoundingBox(x=0.1, y=0.2, width=0.5, height=0.3)
    assert box.x == 0.1
    assert box.width == 0.5

    with pytest.raises(ValidationError):
        BoundingBox(x=1.2, y=0.0, width=0.5, height=0.5)


def test_analysis_response_serialization():
    finding = AIFinding(
        job_id="job-200",
        defect_category=DefectCategory.MODAL_OVERFLOW,
        description="Modal dialog extends past viewport bottom",
        evidence_reference="/artifacts/job-200/modal.png",
        confidence=0.85
    )
    response = AnalysisResponse(
        job_id="job-200",
        has_defect=True,
        findings=[finding],
        analysis_latency_ms=1240.5
    )
    
    data = response.model_dump()
    assert data["has_defect"] is True
    assert len(data["findings"]) == 1
    assert data["findings"][0]["defect_category"] == "modal_overflow"

    json_str = response.model_dump_json()
    assert "modal_overflow" in json_str
