"""Unit tests for the benchmark runner (benchmark.py) and the evaluator fixes."""
import json
import shutil

import pytest

from benchmark import (
    BenchmarkCase,
    CaseOutcome,
    RunSummary,
    load_labels,
    load_v2_cases,
    main,
    run_benchmark,
    summarise_outcomes,
)
from evaluator import BenchmarkEvaluator, normalize_category
from schemas import AIFinding, AnalysisResponse, DefectCategory
from vlm_client import MockVisionModel, VLMError

DEFECT_REPLY = json.dumps({
    "has_defect": True,
    "findings": [{"defect_category": "modal_overflow", "description": "x", "confidence": 0.9}],
})
CLEAN_REPLY = json.dumps({"has_defect": False, "findings": []})
LABELS = {
    "defective/case_01": "product-image-distortion",
    "defective/case_02": "mobile-nav-overflow",
}


def _o(key, defective, expected, predicted, **kwargs):
    kwargs.setdefault("detected", predicted != "none" and not kwargs.get("inconclusive", False))
    return CaseOutcome(
        case_key=key,
        is_defective=defective,
        expected_category=DefectCategory(expected) if expected else None,
        predicted_category=DefectCategory(predicted),
        **kwargs,
    )


class _Recorder:
    def __init__(self, reply):
        self.reply = reply
        self.calls = []

    def analyze(self, image_path, prompt):
        self.calls.append((image_path, prompt))
        return self.reply


class _Flaky:
    """Fails for the clipped-button screenshot, answers 'clean' otherwise."""

    def analyze(self, image_path, prompt):
        if "clipped" in str(image_path):
            raise VLMError("provider down")
        return CLEAN_REPLY


def _make_dataset(root, screenshots, defective=("case_01", "case_02"), baseline=("case_01",), **extra):
    base = root / "model_inputs"
    for group, names in (("defective", defective), ("baseline", baseline)):
        for name in names:
            folder = base / group / name
            folder.mkdir(parents=True, exist_ok=True)
            shutil.copy(screenshots["clean"], folder / "screenshot.png")
            (folder / "dom.html").write_text("<button id='buy'>Buy</button>", encoding="utf-8")
            evidence = {
                "case_id": name,
                "step_name": "not_recorded",
                "screenshot_path": "screenshot.png",
                "dom_path": "dom.html",
                "route": "/products",
                "url": "http://127.0.0.1:5173/products",
                "viewport": {"width": 1440, "height": 900},
                "is_mobile": False,
                "computed_styles": {"image.transform": "matrix(0.75, 0, 0, 1.45, 0, 0)"},
            }
            evidence.update(extra)
            (folder / "evidence.json").write_text(json.dumps(evidence), encoding="utf-8")
    return base


# --- Summary numbers ---

def test_summary_of_an_empty_run_is_empty():
    assert summarise_outcomes([]) == RunSummary()


def test_detection_rate_false_alarms_and_category_accuracy():
    outcomes = [
        _o("a", True, "modal_overflow", "modal_overflow"),
        _o("b", True, "incorrect_spacing", "modal_overflow"),
        _o("c", True, "other", "none"),
        _o("d", False, "none", "none"),
        _o("e", False, "none", "overlapping_text"),
    ]
    s = summarise_outcomes(outcomes)
    assert (s.defective_cases, s.detected_defects) == (3, 2)
    assert s.detection_recall == pytest.approx(2 / 3)
    assert (s.clean_cases, s.false_alarms) == (2, 1)
    assert s.false_positive_rate == 0.5
    assert s.category_accuracy_on_detected == 0.5


def test_unlabelled_defects_are_left_out_of_category_accuracy():
    outcomes = [
        _o("a", True, "modal_overflow", "modal_overflow"),
        _o("b", True, None, "modal_overflow"),
    ]
    s = summarise_outcomes(outcomes)
    assert s.detection_recall == 1.0
    assert s.category_accuracy_on_detected == 1.0


def test_inconclusive_outcomes_are_neither_detections_nor_false_alarms():
    outcomes = [
        _o("a", True, "modal_overflow", "other", inconclusive=True),
        _o("b", False, "none", "other", inconclusive=True),
    ]
    s = summarise_outcomes(outcomes)
    assert s.detection_recall == 0.0
    assert s.false_positive_rate == 0.0
    assert s.inconclusive_count == 2


def test_review_rate():
    outcomes = [_o(str(i), False, "none", "none", needs_review=(i == 0)) for i in range(4)]
    assert summarise_outcomes(outcomes).review_rate == 0.25


def test_latency_statistics_skip_missing_values():
    outcomes = [
        _o("a", False, "none", "none", latency_ms=10.0),
        _o("b", False, "none", "none", latency_ms=20.0),
        _o("c", False, "none", "none", latency_ms=90.0),
        _o("d", False, "none", "none"),
    ]
    s = summarise_outcomes(outcomes)
    assert s.mean_latency_ms == pytest.approx(40.0)
    assert s.median_latency_ms == 20.0
    assert s.max_latency_ms == 90.0


# --- Running the pipeline ---

def test_run_scores_detections_categories_and_false_alarms(make_evidence):
    cases = [
        BenchmarkCase("defective/case_01", make_evidence("clipped_button"), True, "mobile-nav-overflow"),
        BenchmarkCase("defective/case_02", make_evidence("overlapping_text"), True, "product-card-layout-break"),
        BenchmarkCase("baseline/case_01", make_evidence("clean"), False, "none"),
    ]
    result = run_benchmark(cases, MockVisionModel(canned_response=DEFECT_REPLY))
    s = result.summary
    assert s.detection_recall == 1.0
    assert s.category_accuracy_on_detected == 0.5
    assert s.false_positive_rate == 1.0
    assert result.report.total_samples == 3
    assert len(result.outcomes) == 3


def test_clean_pages_with_clean_answers(make_evidence):
    cases = [BenchmarkCase(f"baseline/case_0{i}", make_evidence("clean"), False, "none") for i in (1, 2)]
    result = run_benchmark(cases, MockVisionModel(canned_response=CLEAN_REPLY))
    assert result.summary.false_positive_rate == 0.0
    assert result.report.overall_accuracy == 1.0


def test_one_failing_case_does_not_stop_the_run(make_evidence):
    cases = [
        BenchmarkCase("defective/case_01", make_evidence("clipped_button"), True, "overlapping_text"),
        BenchmarkCase("baseline/case_01", make_evidence("clean"), False, "none"),
    ]
    result = run_benchmark(cases, _Flaky())
    assert list(result.errors) == ["defective/case_01"]
    assert result.errors["defective/case_01"].startswith("VLMError")
    assert result.summary.error_count == 1
    assert result.summary.inconclusive_count == 1
    assert result.report.total_samples == 2


def test_unparseable_reply_is_inconclusive_not_a_clean_answer(make_evidence):
    cases = [BenchmarkCase("baseline/case_01", make_evidence("clean"), False, "none")]
    result = run_benchmark(cases, MockVisionModel(canned_response="this is not json"))
    assert result.summary.inconclusive_count == 1
    assert result.summary.false_positive_rate == 0.0
    assert result.report.correct_predictions == 0


def test_latency_is_recorded(make_evidence):
    cases = [BenchmarkCase("baseline/case_01", make_evidence("clean"), False, "none")]
    result = run_benchmark(cases, MockVisionModel(canned_response=CLEAN_REPLY))
    assert result.summary.mean_latency_ms is not None
    assert result.summary.mean_latency_ms >= 0


def test_labels_are_never_sent_to_the_model(make_evidence):
    model = _Recorder(DEFECT_REPLY)
    cases = [BenchmarkCase("defective/case_01", make_evidence("clean"), True, "mobile-nav-overflow")]
    run_benchmark(cases, model)
    assert model.calls
    assert all("mobile-nav-overflow" not in prompt for _, prompt in model.calls)


def test_unlabelled_defects_still_count_for_detection(make_evidence):
    cases = [
        BenchmarkCase("defective/case_01", make_evidence("clipped_button"), True, None),
        BenchmarkCase("baseline/case_01", make_evidence("clean"), False, "none"),
    ]
    result = run_benchmark(cases, MockVisionModel(canned_response=DEFECT_REPLY))
    assert result.summary.detection_recall == 1.0
    assert result.summary.category_accuracy_on_detected is None
    assert result.report.total_samples == 1


def test_format_summary_lists_the_key_numbers(make_evidence):
    cases = [BenchmarkCase("defective/case_01", make_evidence("clean"), True, "modal_overflow")]
    text = run_benchmark(cases, MockVisionModel(canned_response=DEFECT_REPLY)).format_summary()
    assert "DETECTION AND RELIABILITY" in text
    assert "PER-CASE RESULTS" in text
    assert "defective/case_01" in text


# --- Loading the V2 folder layout ---

def test_load_v2_cases(tmp_path, screenshots):
    _make_dataset(tmp_path, screenshots)
    cases = load_v2_cases(tmp_path, LABELS)
    assert [c.case_key for c in cases] == ["baseline/case_01", "defective/case_01", "defective/case_02"]
    assert [c.is_defective for c in cases] == [False, True, True]
    assert [c.expected for c in cases] == ["none", "product-image-distortion", "mobile-nav-overflow"]
    evidence = cases[1].evidence
    assert evidence.job_id == "defective/case_01"
    assert (evidence.viewport.width, evidence.viewport.height) == (1440, 900)
    assert evidence.step_name is None
    assert "buy" in evidence.dom_snippet
    assert evidence.screenshot_path.endswith("screenshot.png")


def test_dataset_folder_or_its_parent_can_be_given(tmp_path, screenshots):
    base = _make_dataset(tmp_path, screenshots)
    assert len(load_v2_cases(base, LABELS)) == len(load_v2_cases(tmp_path, LABELS)) == 3


def test_mobile_flag_comes_from_the_top_level_field(tmp_path, screenshots):
    _make_dataset(tmp_path, screenshots, is_mobile=True, viewport={"width": 375, "height": 812})
    viewport = load_v2_cases(tmp_path, LABELS)[0].evidence.viewport
    assert (viewport.width, viewport.is_mobile) == (375, True)


def test_missing_screenshot_is_rejected(tmp_path, screenshots):
    base = _make_dataset(tmp_path, screenshots)
    (base / "defective" / "case_01" / "screenshot.png").unlink()
    with pytest.raises(ValueError, match="file not found"):
        load_v2_cases(tmp_path, LABELS)


def test_screenshot_outside_the_case_folder_is_rejected(tmp_path, screenshots):
    outside = tmp_path / "outside.png"
    shutil.copy(screenshots["clean"], outside)
    _make_dataset(tmp_path / "ds", screenshots, screenshot_path=str(outside))
    with pytest.raises(ValueError, match="outside"):
        load_v2_cases(tmp_path / "ds", LABELS)


def test_label_fields_in_evidence_are_rejected(tmp_path, screenshots):
    _make_dataset(tmp_path, screenshots, expected_category="none")
    with pytest.raises(ValueError, match="label fields"):
        load_v2_cases(tmp_path, LABELS)


def test_defective_case_without_a_label_is_rejected(tmp_path, screenshots):
    _make_dataset(tmp_path, screenshots)
    with pytest.raises(ValueError, match="no label"):
        load_v2_cases(tmp_path, {"defective/case_01": "other"})


def test_unknown_label_keys_are_rejected(tmp_path, screenshots):
    _make_dataset(tmp_path, screenshots)
    with pytest.raises(ValueError, match="unknown"):
        load_v2_cases(tmp_path, {**LABELS, "defective/case_99": "other"})


def test_empty_folder_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="No cases found"):
        load_v2_cases(tmp_path)


def test_measurements_are_not_sent_to_the_model(tmp_path, screenshots):
    _make_dataset(tmp_path, screenshots)
    model = _Recorder(CLEAN_REPLY)
    run_benchmark(load_v2_cases(tmp_path, LABELS), model)
    assert len(model.calls) == 3
    for _, prompt in model.calls:
        assert "matrix(0.75" not in prompt
        assert "Viewport: 1440x900 (desktop)" in prompt


def test_labels_file_is_read_and_checked(tmp_path):
    good = tmp_path / "labels.json"
    good.write_text(json.dumps(LABELS), encoding="utf-8")
    assert load_labels(good) == LABELS
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps(["not", "an", "object"]), encoding="utf-8")
    with pytest.raises(ValueError, match="JSON object"):
        load_labels(bad)


# --- Command line ---

def test_cli_runs_with_the_mock_model(tmp_path, screenshots, capsys):
    _make_dataset(tmp_path, screenshots)
    labels = tmp_path / "labels.json"
    labels.write_text(json.dumps(LABELS), encoding="utf-8")
    out = tmp_path / "results.json"
    code = main(["--data", str(tmp_path), "--labels", str(labels), "--mock", "--output", str(out)])
    printed = capsys.readouterr().out
    assert code == 0
    assert "OMNISIGHT VLM BENCHMARK EVALUATION REPORT" in printed
    assert "plumbing" in printed
    assert "summary" in json.loads(out.read_text(encoding="utf-8"))


def test_cli_without_labels_says_category_scoring_is_skipped(tmp_path, screenshots, capsys):
    _make_dataset(tmp_path, screenshots)
    assert main(["--data", str(tmp_path), "--mock"]) == 0
    assert "no labels file" in capsys.readouterr().out


def test_cli_reports_bad_input(tmp_path, capsys):
    assert main(["--data", str(tmp_path / "nope"), "--mock"]) == 2
    assert "Could not load cases" in capsys.readouterr().err


# --- Evaluator fixes ---

def test_seeded_defect_ids_normalize_to_enum_members():
    assert type(normalize_category("mobile-nav-overflow")) is DefectCategory


def test_response_with_an_error_is_inconclusive_not_a_clean_answer():
    response = AnalysisResponse(
        job_id="j", has_defect=False, findings=[],
        error="Model response could not be parsed into structured findings.",
    )
    sample = BenchmarkEvaluator().evaluate_pair("c", "none", response)
    assert sample.inconclusive is True
    assert sample.is_match is False
    assert sample.predicted_category == DefectCategory.OTHER


def test_placeholder_finding_without_a_defect_is_inconclusive():
    response = AnalysisResponse(
        job_id="j",
        has_defect=False,
        findings=[AIFinding(
            job_id="j", defect_category=DefectCategory.OTHER, description="x",
            evidence_reference="a.png", confidence=0.0, requires_human_review=True,
        )],
    )
    assert BenchmarkEvaluator.is_inconclusive(response) is True


def test_batch_requires_a_prediction_for_every_case():
    with pytest.raises(ValueError, match="No prediction"):
        BenchmarkEvaluator().evaluate_batch([{"case_id": "a", "expected_category": "none"}], {})


def test_batch_requires_an_expected_category():
    with pytest.raises(ValueError, match="missing"):
        BenchmarkEvaluator().evaluate_batch([{"case_id": "a"}], {"a": "none"})


def test_review_flag_and_latency_are_copied_from_the_response():
    response = AnalysisResponse(
        job_id="j",
        has_defect=True,
        findings=[AIFinding(
            job_id="j", defect_category=DefectCategory.MODAL_OVERFLOW, description="x",
            evidence_reference="a.png", confidence=0.9, requires_human_review=True,
        )],
        analysis_latency_ms=12.5,
    )
    sample = BenchmarkEvaluator().evaluate_pair("c", "modal_overflow", response)
    assert sample.needs_review is True
    assert sample.latency_ms == 12.5