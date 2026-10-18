"""Unit tests for the defect analysis pipeline (defect_analyzer.py + prompts.py)."""
import json
import os
import tempfile
import pytest

from defect_analyzer import (
    validate_screenshot,
    extract_json_from_response,
    normalize_category,
    parse_findings,
    analyze_evidence,
    ALLOWED_EXTENSIONS,
)
from prompts import (
    DEFECT_TYPES,
    AJAY_CATEGORY_MAP,
    FEW_SHOT_EXAMPLES,
    build_analysis_prompt,
    sanitize_dom_snippet,
)
from schemas import (
    AIFinding,
    AnalysisResponse,
    DefectCategory,
    EvidenceContext,
    ViewportConfig,
)
from vlm_client import MockVisionModel, VLMError


# =====================================================================
# Fixtures
# =====================================================================

@pytest.fixture
def dummy_png():
    """Create a minimal valid PNG file."""
    # Minimal 1x1 PNG bytes
    png_bytes = (
        b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR'
        b'\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06'
        b'\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00'
        b'\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01'
        b'\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
    )
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(png_bytes)
        path = f.name
    yield path
    if os.path.exists(path):
        os.remove(path)


@pytest.fixture
def evidence(dummy_png):
    """Create a valid EvidenceContext pointing to the dummy screenshot."""
    return EvidenceContext(
        job_id="test-job-001",
        screenshot_path=dummy_png,
        url="http://localhost:5173/products",
        route="/products",
        viewport=ViewportConfig(width=375, height=812, is_mobile=True),
        step_name="Browse products on mobile",
    )


# =====================================================================
# prompts.py Tests
# =====================================================================

class TestDefectTaxonomy:
    def test_taxonomy_has_five_types(self):
        assert len(DEFECT_TYPES) == 5

    def test_taxonomy_values_unchanged(self):
        expected = {
            "mobile_button_clipping", "overlapping_text",
            "hidden_control", "incorrect_spacing", "modal_overflow",
        }
        assert set(DEFECT_TYPES) == expected

    def test_ajay_map_covers_four_seeded_defects(self):
        assert len(AJAY_CATEGORY_MAP) == 4
        assert "mobile-nav-overflow" in AJAY_CATEGORY_MAP
        assert "product-card-layout-break" in AJAY_CATEGORY_MAP

    def test_ajay_map_values_are_valid_categories(self):
        valid = {e.value for e in DefectCategory}
        for target in AJAY_CATEGORY_MAP.values():
            assert target in valid


class TestPromptBuilder:
    def test_build_basic_prompt(self):
        prompt = build_analysis_prompt(
            url="http://localhost:5173/",
            viewport_width=1280,
            viewport_height=720,
        )
        assert "OmniSight" in prompt
        assert "mobile_button_clipping" in prompt
        assert "1280x720" in prompt
        assert "desktop" in prompt

    def test_build_mobile_prompt(self):
        prompt = build_analysis_prompt(
            url="http://localhost:5173/products",
            route="/products",
            viewport_width=375,
            viewport_height=812,
            is_mobile=True,
            step_name="Browse catalog",
        )
        assert "375x812" in prompt
        assert "mobile" in prompt
        assert "Browse catalog" in prompt

    def test_dom_snippet_included(self):
        prompt = build_analysis_prompt(
            url="http://localhost:5173/",
            dom_snippet="<div class='product-card'>Test</div>",
        )
        assert "product-card" in prompt

    def test_prompt_injection_in_dom_stripped(self):
        malicious_dom = '<div>Hello</div><script>alert("pwned")</script>'
        prompt = build_analysis_prompt(
            url="http://localhost:5173/",
            dom_snippet=malicious_dom,
        )
        assert "<script>" not in prompt
        assert "alert" not in prompt
        assert "Hello" in prompt


class TestDomSanitizer:
    def test_strips_script_tags(self):
        result = sanitize_dom_snippet('<p>OK</p><script>evil()</script>')
        assert "<script>" not in result
        assert "evil" not in result
        assert "OK" in result

    def test_strips_event_handlers(self):
        result = sanitize_dom_snippet('<button onclick="steal()">Click</button>')
        assert "onclick" not in result
        assert "steal" not in result

    def test_strips_style_blocks(self):
        result = sanitize_dom_snippet('<style>body{display:none}</style><p>Hi</p>')
        assert "<style>" not in result
        assert "Hi" in result

    def test_truncates_long_dom(self):
        long_dom = "x" * 5000
        result = sanitize_dom_snippet(long_dom, max_length=100)
        assert len(result) <= 120  # 100 + "... [truncated]"
        assert result.endswith("... [truncated]")


# =====================================================================
# defect_analyzer.py Tests
# =====================================================================

class TestValidateScreenshot:
    def test_valid_png(self, dummy_png):
        validate_screenshot(dummy_png)  # Should not raise

    def test_missing_file(self):
        with pytest.raises(FileNotFoundError):
            validate_screenshot("/nonexistent/path/image.png")

    def test_unsupported_format(self):
        with tempfile.NamedTemporaryFile(suffix=".bmp", delete=False) as f:
            f.write(b"fake bmp data")
            path = f.name
        try:
            with pytest.raises(ValueError, match="Unsupported image format"):
                validate_screenshot(path)
        finally:
            os.remove(path)

    def test_empty_file(self):
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            path = f.name
        try:
            with pytest.raises(ValueError, match="empty"):
                validate_screenshot(path)
        finally:
            os.remove(path)


class TestExtractJson:
    def test_plain_json(self):
        raw = '{"has_defect": true, "findings": []}'
        result = extract_json_from_response(raw)
        assert result["has_defect"] is True

    def test_markdown_fenced(self):
        raw = '```json\n{"has_defect": false, "findings": []}\n```'
        result = extract_json_from_response(raw)
        assert result["has_defect"] is False

    def test_json_with_surrounding_text(self):
        raw = 'Here is the analysis:\n{"has_defect": true, "findings": []}\nDone.'
        result = extract_json_from_response(raw)
        assert result["has_defect"] is True

    def test_empty_response_raises(self):
        with pytest.raises(ValueError, match="empty"):
            extract_json_from_response("")

    def test_garbage_raises(self):
        with pytest.raises(ValueError, match="Could not extract"):
            extract_json_from_response("This is not JSON at all")


class TestNormalizeCategory:
    def test_exact_match(self):
        assert normalize_category("mobile_button_clipping") == "mobile_button_clipping"

    def test_ajay_mobile_nav(self):
        assert normalize_category("mobile-nav-overflow") == "modal_overflow"

    def test_ajay_layout_break(self):
        assert normalize_category("product-card-layout-break") == "incorrect_spacing"

    def test_ajay_distortion(self):
        assert normalize_category("product-image-distortion") == "other"

    def test_unknown_maps_to_other(self):
        assert normalize_category("totally_unknown_defect") == "other"

    def test_case_insensitive(self):
        assert normalize_category("OVERLAPPING_TEXT") == "overlapping_text"


class TestParseFindings:
    def test_valid_finding(self):
        data = {
            "findings": [{
                "defect_category": "overlapping_text",
                "description": "Price overlaps title",
                "confidence": 0.88,
                "target_selector": ".price-label",
            }]
        }
        findings = parse_findings(data, "job-1", "screenshot.png")
        assert len(findings) == 1
        assert findings[0].defect_category == DefectCategory.OVERLAPPING_TEXT
        assert findings[0].confidence == 0.88
        assert findings[0].requires_human_review is False

    def test_low_confidence_flags_human_review(self):
        data = {
            "findings": [{
                "defect_category": "hidden_control",
                "description": "Maybe a hidden button",
                "confidence": 0.3,
            }]
        }
        findings = parse_findings(data, "job-1", "screenshot.png")
        assert findings[0].requires_human_review is True

    def test_confidence_clamped(self):
        data = {
            "findings": [{
                "defect_category": "overlapping_text",
                "description": "test",
                "confidence": 1.5,
            }]
        }
        findings = parse_findings(data, "job-1", "screenshot.png")
        assert findings[0].confidence == 1.0

    def test_empty_findings(self):
        findings = parse_findings({"findings": []}, "job-1", "screenshot.png")
        assert findings == []

    def test_malformed_finding_skipped(self):
        data = {"findings": ["not a dict", {"defect_category": "overlapping_text", "description": "ok", "confidence": 0.9}]}
        findings = parse_findings(data, "job-1", "screenshot.png")
        assert len(findings) == 1  # Only the valid one


# =====================================================================
# Full Pipeline Tests
# =====================================================================

class TestAnalyzeEvidence:
    def test_mock_defect_detected(self, evidence):
        model = MockVisionModel()
        result = analyze_evidence(evidence, model)
        assert isinstance(result, AnalysisResponse)
        assert result.job_id == "test-job-001"
        assert result.has_defect is True
        assert len(result.findings) >= 1
        assert result.analysis_latency_ms is not None
        assert result.analysis_latency_ms >= 0

    def test_no_defect_result(self, evidence):
        no_defect = json.dumps({"has_defect": False, "findings": []})
        model = MockVisionModel(canned_response=no_defect)
        result = analyze_evidence(evidence, model)
        assert result.has_defect is False
        assert len(result.findings) == 0

    def test_unparseable_response_returns_inconclusive(self, evidence):
        model = MockVisionModel(canned_response="This is not JSON")
        result = analyze_evidence(evidence, model)
        assert len(result.findings) == 1
        assert result.findings[0].requires_human_review is True
        assert result.findings[0].confidence == 0.0

    def test_missing_screenshot_raises(self):
        bad_evidence = EvidenceContext(
            job_id="job-bad",
            screenshot_path="/nonexistent/fake.png",
            url="http://localhost:5173/",
        )
        model = MockVisionModel()
        with pytest.raises(FileNotFoundError):
            analyze_evidence(bad_evidence, model)

    def test_vlm_error_propagates(self, evidence):
        model = MockVisionModel(simulate_error=VLMError("Provider down"))
        with pytest.raises(VLMError):
            analyze_evidence(evidence, model)

    def test_serialization_roundtrip(self, evidence):
        model = MockVisionModel()
        result = analyze_evidence(evidence, model)
        # Serialize to JSON and back
        json_str = result.model_dump_json()
        parsed_back = AnalysisResponse.model_validate_json(json_str)
        assert parsed_back.job_id == result.job_id
        assert len(parsed_back.findings) == len(result.findings)

    def test_pipeline_never_modifies_files(self, evidence, dummy_png):
        """Confirm the pipeline is detection-only."""
        original_stat = os.stat(dummy_png)
        model = MockVisionModel()
        analyze_evidence(evidence, model)
        after_stat = os.stat(dummy_png)
        assert original_stat.st_mtime == after_stat.st_mtime
        assert original_stat.st_size == after_stat.st_size
# =====================================================================
# Few-shot example tests
# =====================================================================

class TestFewShotExamples:
    def test_examples_included_by_default(self):
        prompt = build_analysis_prompt(url="http://localhost:5173/")
        assert "Example 1:" in prompt

    def test_examples_can_be_disabled(self):
        prompt = build_analysis_prompt(url="http://localhost:5173/", include_examples=False)
        assert "Example 1:" not in prompt
        assert "OmniSight" in prompt

    def test_examples_come_before_evidence_context(self):
        prompt = build_analysis_prompt(url="http://localhost:5173/")
        assert prompt.index("Example 1:") < prompt.index("--- EVIDENCE CONTEXT ---")

    def test_example_outputs_follow_output_contract(self):
        finding_keys = {
            "defect_category", "description", "confidence", "target_selector",
            "target_component", "requires_human_review", "suggested_next_step",
        }
        for example in FEW_SHOT_EXAMPLES:
            out = example["output"]
            assert isinstance(out["has_defect"], bool)
            if not out["has_defect"]:
                assert out["findings"] == []
            for finding in out["findings"]:
                assert set(finding) == finding_keys
                assert finding["defect_category"] in DEFECT_TYPES
                assert 0.0 <= finding["confidence"] <= 1.0
                if finding["confidence"] < 0.5:
                    assert finding["requires_human_review"] is True

    def test_examples_cover_every_defect_type(self):
        used = {
            f["defect_category"]
            for example in FEW_SHOT_EXAMPLES
            for f in example["output"]["findings"]
        }
        assert set(DEFECT_TYPES) <= used

    def test_examples_include_a_clean_page(self):
        assert any(not example["output"]["has_defect"] for example in FEW_SHOT_EXAMPLES)

    def test_example_outputs_pass_the_real_parser(self):
        for example in FEW_SHOT_EXAMPLES:
            parsed = parse_findings(example["output"], "job-x", "shot.png")
            assert len(parsed) == len(example["output"]["findings"])