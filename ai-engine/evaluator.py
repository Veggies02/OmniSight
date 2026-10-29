"""Evaluation and benchmarking harness for OmniSight AI-Engine.

Provides offline metrics computation (precision, recall, F1, confusion matrix)
comparing predicted visual defect findings against ground truth datasets.
Strictly segregated from runtime inference prompts.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from pydantic import BaseModel, Field

from prompts import AJAY_CATEGORY_MAP
from schemas import AIFinding, AnalysisResponse, DefectCategory


def normalize_category(raw_val: Union[str, DefectCategory, None]) -> DefectCategory:
    """Normalize ground-truth or predicted labels to canonical DefectCategory.

    Supports:
    - Direct DefectCategory enum members.
    - Case-insensitive string matching of enum values.
    - Ajay's seeded defect taxonomy mapping.
    """
    if raw_val is None:
        return DefectCategory.NONE

    if isinstance(raw_val, DefectCategory):
        return raw_val

    cleaned = str(raw_val).strip().lower()

    # Check Ajay's seeded defect mapping first
    if cleaned in AJAY_CATEGORY_MAP:
        return AJAY_CATEGORY_MAP[cleaned]

    # Check direct match with enum values
    for member in DefectCategory:
        if cleaned == member.value.lower():
            return member

    # Check snake_case replacement of hyphens
    hyphen_fixed = cleaned.replace("-", "_")
    for member in DefectCategory:
        if hyphen_fixed == member.value.lower():
            return member

    # Common keyword matching fallback for seeded defect names
    if "button" in cleaned and "clip" in cleaned:
        return DefectCategory.MOBILE_BUTTON_CLIPPING
    if "nav" in cleaned and "overflow" in cleaned:
        return DefectCategory.MODAL_OVERFLOW
    if "overlap" in cleaned:
        return DefectCategory.OVERLAPPING_TEXT
    if "spacing" in cleaned or "layout" in cleaned:
        return DefectCategory.INCORRECT_SPACING
    if "hidden" in cleaned or "invisible" in cleaned:
        return DefectCategory.HIDDEN_CONTROL

    return DefectCategory.OTHER


class EvalSample(BaseModel):
    """Evaluation result for an individual test case."""

    case_id: str
    expected_category: DefectCategory
    predicted_category: DefectCategory
    is_match: bool
    confidence: float = 0.0
    notes: Optional[str] = None


class CategoryMetrics(BaseModel):
    """Precision, Recall, and F1 metrics for a specific defect category."""

    category: str
    true_positives: int = 0
    false_positives: int = 0
    false_negatives: int = 0
    precision: float = 0.0
    recall: float = 0.0
    f1_score: float = 0.0
    support: int = 0  # Total actual ground truth occurrences


class EvaluationReport(BaseModel):
    """Aggregate benchmark performance report."""

    total_samples: int = 0
    correct_predictions: int = 0
    overall_accuracy: float = 0.0
    macro_f1: float = 0.0
    weighted_f1: float = 0.0
    category_metrics: Dict[str, CategoryMetrics] = Field(default_factory=dict)
    confusion_matrix: Dict[str, Dict[str, int]] = Field(default_factory=dict)
    samples: List[EvalSample] = Field(default_factory=list)

    def format_summary(self) -> str:
        """Render a clean, human-readable terminal table summary."""
        lines = [
            "=" * 78,
            "OMNISIGHT VLM BENCHMARK EVALUATION REPORT",
            "=" * 78,
            f"Total Samples Evaluated : {self.total_samples}",
            f"Correct Predictions     : {self.correct_predictions}",
            f"Overall Accuracy        : {self.overall_accuracy:.2%}",
            f"Macro-Averaged F1       : {self.macro_f1:.4f}",
            f"Weighted F1             : {self.weighted_f1:.4f}",
            "-" * 78,
            f"{'Category':<26} | {'Precision':<10} | {'Recall':<10} | {'F1-Score':<10} | {'Support':<8}",
            "-" * 78,
        ]

        for cat_name, metrics in sorted(self.category_metrics.items()):
            lines.append(
                f"{cat_name:<26} | "
                f"{metrics.precision:<10.2%} | "
                f"{metrics.recall:<10.2%} | "
                f"{metrics.f1_score:<10.4f} | "
                f"{metrics.support:<8d}"
            )

        lines.append("=" * 78)
        return "\n".join(lines)


class BenchmarkEvaluator:
    """Benchmark evaluation engine for comparing predictions against ground truth."""

    def __init__(self, target_categories: Optional[List[DefectCategory]] = None) -> None:
        self.categories = target_categories or list(DefectCategory)

    @staticmethod
    def extract_predicted_category(response: AnalysisResponse) -> Tuple[DefectCategory, float]:
        """Extract dominant category and confidence from an AnalysisResponse."""
        if not response.has_defect or not response.findings:
            return DefectCategory.NONE, 1.0 if not response.has_defect else 0.0

        # Sort findings by confidence descending, take top finding
        sorted_findings = sorted(response.findings, key=lambda f: f.confidence, reverse=True)
        top_finding = sorted_findings[0]
        # Support both defect_category (AIFinding schema) and category attribute
        cat = getattr(top_finding, "defect_category", getattr(top_finding, "category", DefectCategory.OTHER))
        return cat, top_finding.confidence

    def evaluate_pair(
        self,
        case_id: str,
        expected: Union[str, DefectCategory],
        response_or_pred: Union[AnalysisResponse, DefectCategory, str],
        confidence: Optional[float] = None,
        notes: Optional[str] = None,
    ) -> EvalSample:
        """Evaluate a single test case pairing expected vs predicted."""
        expected_cat = normalize_category(expected)

        if isinstance(response_or_pred, AnalysisResponse):
            pred_cat, conf = self.extract_predicted_category(response_or_pred)
        else:
            pred_cat = normalize_category(response_or_pred)
            conf = confidence if confidence is not None else 1.0

        is_match = (expected_cat == pred_cat)
        return EvalSample(
            case_id=case_id,
            expected_category=expected_cat,
            predicted_category=pred_cat,
            is_match=is_match,
            confidence=conf,
            notes=notes,
        )

    def compute_metrics(self, samples: List[EvalSample]) -> EvaluationReport:
        """Compute aggregate performance metrics and confusion matrix from evaluated samples."""
        total = len(samples)
        if total == 0:
            return EvaluationReport()

        correct = sum(1 for s in samples if s.is_match)
        accuracy = correct / total

        # Initialize confusion matrix [expected][predicted] = count
        cat_names = [c.value for c in self.categories]
        matrix: Dict[str, Dict[str, int]] = {
            exp: {pred: 0 for pred in cat_names} for exp in cat_names
        }

        for sample in samples:
            exp_val = sample.expected_category.value
            pred_val = sample.predicted_category.value
            if exp_val not in matrix:
                matrix[exp_val] = {pred: 0 for pred in cat_names}
            if pred_val not in matrix[exp_val]:
                matrix[exp_val][pred_val] = 0
            matrix[exp_val][pred_val] += 1

        # Per-category calculations
        category_metrics: Dict[str, CategoryMetrics] = {}
        total_support = 0

        for cat in self.categories:
            c_val = cat.value
            tp = matrix.get(c_val, {}).get(c_val, 0)
            fp = sum(matrix[other].get(c_val, 0) for other in matrix if other != c_val)
            fn = sum(matrix.get(c_val, {}).get(other, 0) for other in matrix.get(c_val, {}) if other != c_val)
            support = tp + fn

            precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

            category_metrics[c_val] = CategoryMetrics(
                category=c_val,
                true_positives=tp,
                false_positives=fp,
                false_negatives=fn,
                precision=precision,
                recall=recall,
                f1_score=f1,
                support=support,
            )
            total_support += support

        # Compute Macro F1 (average across categories present in ground truth or target list)
        active_cats = [m for m in category_metrics.values() if m.support > 0 or m.false_positives > 0]
        if active_cats:
            macro_f1 = sum(m.f1_score for m in active_cats) / len(active_cats)
        else:
            macro_f1 = 0.0

        # Compute Weighted F1
        if total_support > 0:
            weighted_f1 = sum(m.f1_score * m.support for m in category_metrics.values()) / total_support
        else:
            weighted_f1 = 0.0

        return EvaluationReport(
            total_samples=total,
            correct_predictions=correct,
            overall_accuracy=accuracy,
            macro_f1=macro_f1,
            weighted_f1=weighted_f1,
            category_metrics=category_metrics,
            confusion_matrix=matrix,
            samples=samples,
        )

    def evaluate_batch(
        self,
        cases: List[Dict[str, Any]],
        predictions: Dict[str, Union[AnalysisResponse, str, DefectCategory]],
    ) -> EvaluationReport:
        """Evaluate a batch of ground truth cases against prediction dictionary keyed by case_id."""
        samples: List[EvalSample] = []
        for case in cases:
            case_id = str(case.get("case_id") or case.get("test_id") or case.get("id"))
            expected = case.get("expected_category") or case.get("category") or "none"
            pred = predictions.get(case_id, DefectCategory.NONE)
            samples.append(self.evaluate_pair(case_id=case_id, expected=expected, response_or_pred=pred))

        return self.compute_metrics(samples)

    @staticmethod
    def load_ground_truth(file_path: Union[str, Path]) -> List[Dict[str, Any]]:
        """Load ground truth JSON evaluation fixture."""
        p = Path(file_path)
        if not p.exists():
            raise FileNotFoundError(f"Ground truth file not found: {p}")
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and "cases" in data:
                return data["cases"]
            raise ValueError(f"Unrecognized ground truth format in {p}")