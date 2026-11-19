"""Unit tests for Pydantic schemas in schemas.py."""
import pytest
from pydantic import ValidationError
from schemas import (
    DefectCategory,
    ViewportConfig,
    EvidenceContext,
    AIFinding,
    AnalysisResponse,
    BoundingBox,
    CodeChange,
    ValidationChecklist,
    PatchProposal,
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


# --- Patch proposal schemas ---

DIFF = (
    "--- a/src/index.css\n+++ b/src/index.css\n"
    "@@ -1,1 +1,1 @@\n-.btn { width: 400px; }\n+.btn { max-width: 100%; }\n"
)


def _checklist():
    return ValidationChecklist(steps=["Load /products at 375px"], expected_outcome="Button fully visible")


def _change(**overrides):
    data = {"file_path": "src/index.css", "description": "Cap button width", "unified_diff": DIFF}
    data.update(overrides)
    return CodeChange(**data)


def test_code_change_valid():
    assert _change().file_path == "src/index.css"


def test_code_change_normalizes_backslashes():
    assert _change(file_path="src\\index.css").file_path == "src/index.css"


@pytest.mark.parametrize("bad", ["/etc/passwd", "C:/x/y.css", "../secrets.env", "src/../../x.css"])
def test_code_change_rejects_unsafe_paths(bad):
    with pytest.raises(ValidationError):
        _change(file_path=bad)


def test_code_change_rejects_diff_without_hunk():
    with pytest.raises(ValidationError):
        _change(unified_diff="just some text")


def test_checklist_requires_steps():
    with pytest.raises(ValidationError):
        ValidationChecklist(steps=[], expected_outcome="ok")


def test_patch_proposal_valid_and_defaults_to_human_review():
    p = PatchProposal(
        category=DefectCategory("mobile_button_clipping"),
        summary="Prevent nav button clipping on mobile",
        changes=[_change()],
        validation=_checklist(),
        confidence=0.8,
    )
    assert p.requires_human_review is True


def test_patch_proposal_requires_changes():
    with pytest.raises(ValidationError):
        PatchProposal(
            category=DefectCategory("overlapping_text"),
            summary="x", changes=[], validation=_checklist(), confidence=0.5,
        )


@pytest.mark.parametrize("bad", [-0.1, 1.5])
def test_patch_proposal_confidence_bounds(bad):
    with pytest.raises(ValidationError):
        PatchProposal(
            category=DefectCategory("overlapping_text"),
            summary="x", changes=[_change()], validation=_checklist(), confidence=bad,
        )


# --- Edge-case coverage ---

def test_viewport_defaults():
    vp = ViewportConfig()
    assert (vp.width, vp.height) == (1280, 720)
    assert vp.is_mobile is False
    assert vp.device_scale_factor == 1.0


@pytest.mark.parametrize("kwargs", [{"width": 0}, {"height": 0}, {"device_scale_factor": 5.0}])
def test_viewport_rejects_out_of_range_values(kwargs):
    with pytest.raises(ValidationError):
        ViewportConfig(**kwargs)


def test_evidence_context_optional_fields_default_to_none():
    ctx = EvidenceContext(job_id="j1", screenshot_path="a.png", url="http://localhost:5173/")
    assert ctx.route is None
    assert ctx.dom_snippet is None
    assert ctx.step_name is None
    assert ctx.timestamp.tzinfo is not None


def test_bounding_box_rejects_negative_values():
    with pytest.raises(ValidationError):
        BoundingBox(x=-0.1, y=0.0, width=0.5, height=0.5)


def test_finding_ids_are_unique():
    def make():
        return AIFinding(
            job_id="j1",
            defect_category=DefectCategory.HIDDEN_CONTROL,
            description="Control hidden",
            evidence_reference="a.png",
            confidence=0.7,
        )
    assert make().finding_id != make().finding_id


def test_clean_page_response_has_no_findings():
    resp = AnalysisResponse(job_id="j2", has_defect=False)
    assert resp.findings == []
    assert DefectCategory.NONE.value == "none"


def test_patch_proposal_json_round_trip():
    original = PatchProposal(
        category=DefectCategory.INCORRECT_SPACING,
        summary="Fix card gap",
        changes=[_change()],
        validation=_checklist(),
        confidence=0.6,
    )
    restored = PatchProposal.model_validate_json(original.model_dump_json())
    assert restored == original

def test_analysis_response_provider_metadata_and_error():
    resp = AnalysisResponse(
        job_id="j-prov-1",
        has_defect=False,
        is_mock=True,
        provider="mock",
        error=None,
    )
    assert resp.is_mock is True
    assert resp.provider == "mock"
    assert resp.error is None

    dumped = resp.model_dump()
    assert dumped["is_mock"] is True
    assert dumped["provider"] == "mock"
    assert "error" in dumped

    # Test error reporting
    err_resp = AnalysisResponse(
        job_id="j-err-1",
        has_defect=False,
        is_mock=False,
        provider="gemini",
        error="VLM rate limit exceeded",
    )
    assert err_resp.error == "VLM rate limit exceeded"
    assert err_resp.is_mock is False
    assert err_resp.provider == "gemini"
