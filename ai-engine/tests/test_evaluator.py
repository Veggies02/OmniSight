"""Tests for benchmark evaluation harness (evaluator.py)."""

import json
from pathlib import Path
import pytest

from evaluator import (
    BenchmarkEvaluator,
    CategoryMetrics,
    EvaluationReport,
    EvalSample,
    normalize_category,
)
from schemas import AIFinding, AnalysisResponse, DefectCategory


class TestCategoryNormalization:
    def test_direct_enum_passthrough(self):
        assert normalize_category(DefectCategory.OVERLAPPING_TEXT) == DefectCategory.OVERLAPPING_TEXT

    def test_case_insensitive_string(self):
        assert normalize_category("MOBILE_BUTTON_CLIPPING") == DefectCategory.MOBILE_BUTTON_CLIPPING
        assert normalize_category("modal_overflow") == DefectCategory.MODAL_OVERFLOW

    def test_ajay_taxonomy_mapping(self):
        assert normalize_category("mobile-nav-overflow") == DefectCategory.MODAL_OVERFLOW
        assert normalize_category("product-card-layout-break") == DefectCategory.INCORRECT_SPACING
        assert normalize_category("checkout-button-clip") == DefectCategory.MOBILE_BUTTON_CLIPPING
        assert normalize_category("text-overlap-banner") == DefectCategory.OVERLAPPING_TEXT
        assert normalize_category("invisible-filter-dropdown") == DefectCategory.HIDDEN_CONTROL

    def test_none_and_empty(self):
        assert normalize_category(None) == DefectCategory.NONE
        assert normalize_category("none") == DefectCategory.NONE

    def test_unknown_string_fallback_to_other(self):
        assert normalize_category("completely-unrelated-defect") == DefectCategory.OTHER


class TestBenchmarkEvaluator:
    @pytest.fixture
    def evaluator(self):
        return BenchmarkEvaluator()

    def test_empty_samples_returns_zero_report(self, evaluator):
        report = evaluator.compute_metrics([])
        assert report.total_samples == 0
        assert report.overall_accuracy == 0.0
        assert report.macro_f1 == 0.0
        assert report.samples == []

    def test_perfect_accuracy_scenario(self, evaluator):
        samples = [
            evaluator.evaluate_pair("c1", "modal_overflow", "modal_overflow"),
            evaluator.evaluate_pair("c2", "overlapping_text", "overlapping_text"),
            evaluator.evaluate_pair("c3", "none", "none"),
        ]
        report = evaluator.compute_metrics(samples)
        assert report.total_samples == 3
        assert report.correct_predictions == 3
        assert report.overall_accuracy == 1.0
        assert report.macro_f1 == 1.0
        assert report.weighted_f1 == 1.0

        modal_metric = report.category_metrics["modal_overflow"]
        assert modal_metric.true_positives == 1
        assert modal_metric.false_positives == 0
        assert modal_metric.precision == 1.0
        assert modal_metric.recall == 1.0
        assert modal_metric.f1_score == 1.0

    def test_mixed_misclassification_scenario(self, evaluator):
        samples = [
            # 2 actual overlapping_text: 1 correctly predicted, 1 mispredicted as incorrect_spacing
            evaluator.evaluate_pair("c1", "overlapping_text", "overlapping_text"),
            evaluator.evaluate_pair("c2", "overlapping_text", "incorrect_spacing"),
            # 1 actual incorrect_spacing correctly predicted
            evaluator.evaluate_pair("c3", "incorrect_spacing", "incorrect_spacing"),
        ]
        report = evaluator.compute_metrics(samples)
        assert report.total_samples == 3
        assert report.correct_predictions == 2
        assert pytest.approx(report.overall_accuracy, 0.01) == 0.67

        # overlapping_text: TP=1, FP=0, FN=1 -> precision=1.0, recall=0.5, f1=0.6667
        ot = report.category_metrics["overlapping_text"]
        assert ot.true_positives == 1
        assert ot.false_positives == 0
        assert ot.false_negatives == 1
        assert ot.precision == 1.0
        assert ot.recall == 0.5
        assert pytest.approx(ot.f1_score, 0.01) == 0.67

        # incorrect_spacing: TP=1, FP=1 (c2), FN=0 -> precision=0.5, recall=1.0, f1=0.6667
        sp = report.category_metrics["incorrect_spacing"]
        assert sp.true_positives == 1
        assert sp.false_positives == 1
        assert sp.false_negatives == 0
        assert sp.precision == 0.5
        assert sp.recall == 1.0
        assert pytest.approx(sp.f1_score, 0.01) == 0.67

        # Confusion matrix checks
        assert report.confusion_matrix["overlapping_text"]["overlapping_text"] == 1
        assert report.confusion_matrix["overlapping_text"]["incorrect_spacing"] == 1
        assert report.confusion_matrix["incorrect_spacing"]["incorrect_spacing"] == 1

    def test_analysis_response_pair_evaluation(self, evaluator):
        response_with_defect = AnalysisResponse(
            job_id="job-123",
            is_mock=True,
            provider="mock",
            has_defect=True,
            findings=[
                AIFinding(
                    finding_id="f1",
                    job_id="job-123",
                    defect_category=DefectCategory.MOBILE_BUTTON_CLIPPING,
                    confidence=0.92,
                    description="Button clipped at viewport edge",
                    target_selector=".checkout-btn",
                    evidence_reference="artifacts/screenshot.png",
                )
            ],
        )

        sample = evaluator.evaluate_pair("case-btn", "checkout-button-clip", response_with_defect)
        assert sample.is_match is True
        assert sample.expected_category == DefectCategory.MOBILE_BUTTON_CLIPPING
        assert sample.predicted_category == DefectCategory.MOBILE_BUTTON_CLIPPING
        assert pytest.approx(sample.confidence, 0.01) == 0.92

    def test_analysis_response_no_defect(self, evaluator):
        response_clean = AnalysisResponse(
            job_id="job-clean",
            is_mock=True,
            provider="mock",
            has_defect=False,
            findings=[],
        )
        sample = evaluator.evaluate_pair("clean-case", "none", response_clean)
        assert sample.is_match is True
        assert sample.predicted_category == DefectCategory.NONE

    def test_evaluate_batch(self, evaluator):
        cases = [
            {"case_id": "test_1", "expected_category": "mobile-nav-overflow"},
            {"case_id": "test_2", "expected_category": "none"},
        ]
        predictions = {
            "test_1": DefectCategory.MODAL_OVERFLOW,
            "test_2": DefectCategory.NONE,
        }
        report = evaluator.evaluate_batch(cases, predictions)
        assert report.total_samples == 2
        assert report.overall_accuracy == 1.0

    def test_load_ground_truth_json(self, evaluator, tmp_path):
        gt_file = tmp_path / "ground_truth_eval.json"
        gt_data = [
            {"case_id": "t1", "expected_category": "overlapping_text"},
            {"case_id": "t2", "expected_category": "hidden_control"},
        ]
        gt_file.write_text(json.dumps(gt_data), encoding="utf-8")

        loaded = evaluator.load_ground_truth(gt_file)
        assert len(loaded) == 2
        assert loaded[0]["case_id"] == "t1"

    def test_load_ground_truth_dict_format(self, evaluator, tmp_path):
        gt_file = tmp_path / "ground_truth_wrapped.json"
        gt_data = {
            "cases": [{"test_id": "sub_1", "category": "modal_overflow"}]
        }
        gt_file.write_text(json.dumps(gt_data), encoding="utf-8")

        loaded = evaluator.load_ground_truth(gt_file)
        assert len(loaded) == 1
        assert loaded[0]["test_id"] == "sub_1"

    def test_load_ground_truth_missing_file_raises(self, evaluator, tmp_path):
        with pytest.raises(FileNotFoundError):
            evaluator.load_ground_truth(tmp_path / "non_existent.json")

    def test_format_summary_output(self, evaluator):
        samples = [
            evaluator.evaluate_pair("c1", "modal_overflow", "modal_overflow"),
            evaluator.evaluate_pair("c2", "overlapping_text", "none"),
        ]
        report = evaluator.compute_metrics(samples)
        summary = report.format_summary()

        assert "OMNISIGHT VLM BENCHMARK EVALUATION REPORT" in summary
        assert "Total Samples Evaluated : 2"
        assert "Overall Accuracy        : 50.00%"
        assert "modal_overflow" in summary