import pytest
from diagnosis_adapter import CATEGORY_MAP, adapt_cli_output, adapt_scenario, severity_for

PY_CATEGORIES = {"mobile_button_clipping", "overlapping_text", "hidden_control", "incorrect_spacing", "modal_overflow", "other"}
TS_CATEGORIES = {"image_distortion", "layout_breakage", "low_contrast", "responsive_overflow", "unknown"}
STATUSES = {"diagnosed", "no_defect_detected", "inconclusive", "error"}


def finding(**kw):
    base = dict(defect_category="mobile_button_clipping", description="Menu button is cut off",
                evidence_reference="mobile-nav-overflow/defective.png", target_selector=".nav-toggle",
                target_component=None, confidence=0.8, uncertainty_notes=None,
                requires_human_review=False, suggested_next_step=None)
    base.update(kw)
    return base


def response(findings=None, **kw):
    base = dict(job_id="j", has_defect=bool(findings), findings=findings or [], analysis_latency_ms=12.6,
                is_mock=False, provider="gemini", error=None)
    base.update(kw)
    return base


def assert_ts_valid(result):
    """Mirrors validateDiagnosisSchema in scripts/vlm/diagnosis-schema.ts."""
    d = result["diagnosis"]
    assert d["schema_version"] == "1.0" and d["status"] in STATUSES
    assert d["summary"].strip() and isinstance(d["limitations"], list)
    for x in d["defects"]:
        assert x["category"] in TS_CATEGORIES and x["severity"] in {"low", "medium", "high", "critical"}
        assert 0 <= x["confidence"] <= 1 and x["description"].strip()
        assert x["evidence"] and all(e.strip() for e in x["evidence"])
        assert x["affected_element"]["description"].strip()
        assert x["suspected_cause"].strip() and x["suggested_fix"].strip()
    assert result["scenarioId"] and result["model"] and result["provider"]


def test_defect_is_adapted_and_valid():
    r = adapt_scenario("mobile-nav-overflow", response([finding()]))
    assert_ts_valid(r)
    assert r["status"] == "diagnosed"
    d = r["diagnosis"]["defects"][0]
    assert d["category"] == "responsive_overflow" and d["affected_element"]["selector"] == ".nav-toggle"
    assert r["executionTimeMs"] == 12 and r["provider"] == "gemini"
    assert any("severity" in s for s in r["diagnosis"]["limitations"])


def test_no_defect():
    r = adapt_scenario("s", response())
    assert_ts_valid(r)
    assert r["status"] == "no_defect_detected" and r["diagnosis"]["defects"] == []


def test_error_is_never_a_clean_page():
    r = adapt_scenario("s", response(has_defect=False, error="VLM provider error: boom"))
    assert_ts_valid(r)
    assert r["status"] == "error" and "boom" in r["error"]


def test_defect_without_usable_finding_is_inconclusive():
    r = adapt_scenario("s", response(has_defect=True, findings=[finding(defect_category="none")]))
    assert_ts_valid(r)
    assert r["status"] == "inconclusive"


def test_confidence_is_clamped():
    r = adapt_scenario("s", response([finding(confidence=7)]))
    assert_ts_valid(r)
    assert r["diagnosis"]["defects"][0]["confidence"] == 1.0


def test_blank_optional_fields_get_labelled_fallbacks():
    r = adapt_scenario("s", response([finding(evidence_reference="", target_selector=None, uncertainty_notes=" ")]))
    assert_ts_valid(r)
    assert r["status"] == "diagnosed"


def test_mock_is_labelled():
    r = adapt_scenario("s", response([finding()], is_mock=True, provider="mock"))
    assert r["provider"] == "mock"
    assert any("mock" in s for s in r["diagnosis"]["limitations"])


def test_every_python_category_maps_into_the_typescript_set():
    assert set(CATEGORY_MAP) == PY_CATEGORIES
    assert set(CATEGORY_MAP.values()) <= TS_CATEGORIES


def test_cli_output_is_keyed_by_scenario_folder():
    cli = {"run_id": "run-1", "provider": "mock", "total_scenarios": 2,
           "scenarios": {"mobile-nav-overflow": response([finding()]),
                         "product-image-distortion": response(error="x")}}
    out = adapt_cli_output(cli)
    assert set(out["results"]) == {"mobile-nav-overflow", "product-image-distortion"}
    assert out["manifest"]["totalScenarios"] == 2 and out["manifest"]["scenariosDiagnosed"] == 1
    assert out["manifest"]["runId"] == "run-1"


@pytest.mark.parametrize("bad", ["../x", "a--b", "", "a b"])
def test_unsafe_scenario_ids_are_refused(bad):
    with pytest.raises(ValueError):
        adapt_cli_output({"scenarios": {bad: response()}})


def test_missing_scenarios_object():
    with pytest.raises(ValueError):
        adapt_cli_output({"run_id": "r"})


def test_category_mismatch_is_recorded_in_limitations():
    r = adapt_scenario("product-image-distortion", response([finding()]))
    assert_ts_valid(r)
    assert any("Category mismatch" in s and "image_distortion" in s for s in r["diagnosis"]["limitations"])
    assert r["diagnosis"]["defects"][0]["category"] == "responsive_overflow"  # never relabelled to fit


def test_matching_category_has_no_mismatch_note():
    r = adapt_scenario("mobile-nav-overflow", response([finding()]))
    assert not any("Category mismatch" in s for s in r["diagnosis"]["limitations"])


# ---- agreed with Ajay: severity rule, 'other' stays unsupported, nothing fabricated ----
@pytest.mark.parametrize("confidence, review, expected", [
    (0.95, True, "high"), (0.1, True, "high"), (0.71, False, "medium"), (0.7, False, "low"), (0.3, False, "low"), (1.0, False, "medium"),
])
def test_severity_rule(confidence, review, expected):
    assert severity_for(confidence, review) == expected
    r = adapt_scenario("s", response([finding(confidence=confidence, requires_human_review=review)]))
    d = r["diagnosis"]["defects"][0]
    assert d["severity"] == expected and d["confidence"] == confidence


def test_human_review_flag_is_kept_in_the_limitations():
    r = adapt_scenario("s", response([finding(requires_human_review=True)]))
    assert any("human review" in s for s in r["diagnosis"]["limitations"])


@pytest.mark.parametrize("scenario", ["product-image-distortion", "low-contrast-text"])
def test_other_stays_unknown_whatever_the_scenario(scenario):
    r = adapt_scenario(scenario, response([finding(defect_category="other")]))
    assert r["diagnosis"]["defects"][0]["category"] == "unknown"  # never image_distortion / low_contrast


@pytest.mark.parametrize("bad", [
    {"description": " "}, {"description": None}, {"confidence": None}, {"confidence": "high"},
    {"confidence": float("nan")}, {"defect_category": None}, {"defect_category": "made_up"},
])
def test_a_finding_missing_required_fields_is_never_actionable(bad):
    r = adapt_scenario("s", response([finding(**bad)]))
    assert_ts_valid(r)
    assert r["status"] == "inconclusive" and r["diagnosis"]["defects"] == []
    assert any("ignored" in s for s in r["diagnosis"]["limitations"])


def test_one_bad_finding_does_not_hide_a_good_one():
    r = adapt_scenario("s", response([finding(description=""), finding(description="Real defect")]))
    assert r["status"] == "diagnosed" and len(r["diagnosis"]["defects"]) == 1