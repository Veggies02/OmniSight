"""Benchmark runner for the V2 evidence dataset.

Folder layout (from the browser automation team):
    <data>/model_inputs/baseline/case_NN/{evidence.json, dom.html, screenshot.png}
    <data>/model_inputs/defective/case_NN/{evidence.json, dom.html, screenshot.png}

Baseline cases are clean pages and defective cases contain one seeded defect.
Labels are only used to score answers after the model has replied. The model
never sees labels, folder names, measurements or computed styles: it gets the
screenshot, URL, route, viewport, journey step and the DOM excerpt, exactly as
in production.

Mock-model runs only check the plumbing. They are not accuracy numbers.

Usage:
    python benchmark.py --data <folder> [--labels labels.json] [--mock] [--output results.json]
"""
import argparse
import json
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from pydantic import BaseModel, Field

from defect_analyzer import analyze_evidence
from evaluator import BenchmarkEvaluator, EvalSample, EvaluationReport, normalize_category
from schemas import AnalysisResponse, DefectCategory, EvidenceContext, ViewportConfig
from vlm_client import MockVisionModel, VisionModel

_GROUPS = (("baseline", False), ("defective", True))
_PLACEHOLDER_STEPS = frozenset({"", "not_recorded"})
_FORBIDDEN_EVIDENCE_KEYS = frozenset({
    "expected", "expected_category", "category", "ground_truth", "label",
})
_MAX_ERROR_CHARS = 300
_WIDTH = 78


@dataclass(frozen=True)
class BenchmarkCase:
    """One case. expected is for scoring only: "none" for clean pages, a
    category for labelled defects, or None when the label is unknown."""

    case_key: str
    evidence: EvidenceContext
    is_defective: bool
    expected: Optional[str]


class CaseOutcome(BaseModel):
    case_key: str
    is_defective: bool
    expected_category: Optional[DefectCategory] = None
    predicted_category: DefectCategory = DefectCategory.NONE
    confidence: float = 0.0
    detected: bool = False
    inconclusive: bool = False
    needs_review: bool = False
    latency_ms: Optional[float] = None
    error: Optional[str] = None


class RunSummary(BaseModel):
    total_cases: int = 0
    defective_cases: int = 0
    clean_cases: int = 0
    detected_defects: int = 0
    false_alarms: int = 0
    detection_recall: Optional[float] = None
    false_positive_rate: Optional[float] = None
    category_accuracy_on_detected: Optional[float] = None
    review_rate: float = 0.0
    inconclusive_count: int = 0
    error_count: int = 0
    mean_latency_ms: Optional[float] = None
    median_latency_ms: Optional[float] = None
    max_latency_ms: Optional[float] = None


def _pct(value: Optional[float]) -> str:
    return "n/a" if value is None else f"{value:.0%}"


def _ms(value: Optional[float]) -> str:
    return "n/a" if value is None else f"{value:.1f} ms"


class BenchmarkResult(BaseModel):
    summary: RunSummary
    report: EvaluationReport
    outcomes: List[CaseOutcome] = Field(default_factory=list)
    errors: Dict[str, str] = Field(default_factory=dict)

    def format_summary(self) -> str:
        """Render the category report, the detection block and the per-case table."""
        s = self.summary
        lines: List[str] = []
        if self.report.total_samples:
            lines.append(self.report.format_summary())
        lines.extend([
            "DETECTION AND RELIABILITY",
            "-" * _WIDTH,
            f"Defects detected         : {s.detected_defects}/{s.defective_cases} (recall {_pct(s.detection_recall)})",
            f"False alarms on clean    : {s.false_alarms}/{s.clean_cases} (rate {_pct(s.false_positive_rate)})",
            f"Category right if found  : {_pct(s.category_accuracy_on_detected)}",
            f"Flagged for human review : {s.review_rate:.0%}",
            f"Inconclusive or failed   : {s.inconclusive_count} (errors: {s.error_count})",
            f"Latency mean/median/max  : {_ms(s.mean_latency_ms)} / {_ms(s.median_latency_ms)} / {_ms(s.max_latency_ms)}",
            "=" * _WIDTH,
            "PER-CASE RESULTS",
            "-" * _WIDTH,
        ])
        for o in self.outcomes:
            expected = o.expected_category.value if o.expected_category is not None else "unlabelled defect"
            flags = " ".join(
                name for name, on in (("inconclusive", o.inconclusive), ("review", o.needs_review)) if on
            )
            lines.append(
                f"{o.case_key:<22} expected {expected:<22} got {o.predicted_category.value:<22} "
                f"conf {o.confidence:.2f} {flags}".rstrip()
            )
        lines.append("=" * _WIDTH)
        return "\n".join(lines)


def summarise_outcomes(outcomes: Sequence[CaseOutcome]) -> RunSummary:
    """Detection, false alarm, review and latency numbers.

    Inconclusive answers (unparseable replies and errors) count as neither a
    detection nor a false alarm, and they are reported separately.
    """
    total = len(outcomes)
    if total == 0:
        return RunSummary()
    defective = [o for o in outcomes if o.is_defective]
    clean = [o for o in outcomes if not o.is_defective]
    detected = [o for o in defective if o.detected]
    false_alarms = [o for o in clean if o.detected]
    labelled = [o for o in detected if o.expected_category is not None]
    latencies = [o.latency_ms for o in outcomes if o.latency_ms is not None]
    return RunSummary(
        total_cases=total,
        defective_cases=len(defective),
        clean_cases=len(clean),
        detected_defects=len(detected),
        false_alarms=len(false_alarms),
        detection_recall=len(detected) / len(defective) if defective else None,
        false_positive_rate=len(false_alarms) / len(clean) if clean else None,
        category_accuracy_on_detected=(
            sum(1 for o in labelled if o.predicted_category == o.expected_category) / len(labelled)
            if labelled else None
        ),
        review_rate=sum(1 for o in outcomes if o.needs_review) / total,
        inconclusive_count=sum(1 for o in outcomes if o.inconclusive),
        error_count=sum(1 for o in outcomes if o.error),
        mean_latency_ms=statistics.fmean(latencies) if latencies else None,
        median_latency_ms=statistics.median(latencies) if latencies else None,
        max_latency_ms=max(latencies) if latencies else None,
    )


def _outcome(case: BenchmarkCase, response: AnalysisResponse, expected) -> CaseOutcome:
    if BenchmarkEvaluator.is_inconclusive(response):
        predicted, confidence, detected, inconclusive = DefectCategory.OTHER, 0.0, False, True
    else:
        predicted, confidence = BenchmarkEvaluator.extract_predicted_category(response)
        detected = response.has_defect and predicted != DefectCategory.NONE
        inconclusive = False
    return CaseOutcome(
        case_key=case.case_key,
        is_defective=case.is_defective,
        expected_category=expected,
        predicted_category=predicted,
        confidence=confidence,
        detected=detected,
        inconclusive=inconclusive,
        needs_review=inconclusive or any(f.requires_human_review for f in response.findings),
        latency_ms=response.analysis_latency_ms,
        error=response.error,
    )


def run_benchmark(
    cases: Sequence[BenchmarkCase],
    model: VisionModel,
    evaluator: Optional[BenchmarkEvaluator] = None,
) -> BenchmarkResult:
    """Run the pipeline on every case and score the answers.

    A failing case is recorded as inconclusive and the run continues. The
    category report only covers cases whose expected label is known.
    """
    evaluator = evaluator or BenchmarkEvaluator()
    outcomes: List[CaseOutcome] = []
    samples: List[EvalSample] = []
    errors: Dict[str, str] = {}

    for case in cases:
        expected = normalize_category(case.expected) if case.expected is not None else None
        try:
            response = analyze_evidence(case.evidence, model)
        except Exception as exc:  # one failing case must not stop the whole run
            message = f"{type(exc).__name__}: {exc}"[:_MAX_ERROR_CHARS]
            errors[case.case_key] = message
            outcomes.append(CaseOutcome(
                case_key=case.case_key,
                is_defective=case.is_defective,
                expected_category=expected,
                predicted_category=DefectCategory.OTHER,
                inconclusive=True,
                needs_review=True,
                error=message,
            ))
            if expected is not None:
                samples.append(EvalSample(
                    case_id=case.case_key,
                    expected_category=expected,
                    predicted_category=DefectCategory.OTHER,
                    is_match=False,
                    notes=f"Error: {message}",
                    needs_review=True,
                    inconclusive=True,
                ))
            continue

        outcomes.append(_outcome(case, response, expected))
        if expected is not None:
            samples.append(evaluator.evaluate_pair(case.case_key, expected, response))

    return BenchmarkResult(
        summary=summarise_outcomes(outcomes),
        report=evaluator.compute_metrics(samples),
        outcomes=outcomes,
        errors=errors,
    )


def _inside(case_dir: Path, value, key: str, field: str) -> Path:
    """Resolve a path from evidence.json, which must be a file inside the case folder."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key}: {field} is missing")
    base = case_dir.resolve()
    target = (case_dir / value).resolve()
    if base != target and base not in target.parents:
        raise ValueError(f"{key}: {field} points outside the case folder")
    if not target.is_file():
        raise ValueError(f"{key}: {field} file not found: {value}")
    return target


def _load_case(case_dir: Path, key: str, is_defective: bool, labels) -> BenchmarkCase:
    evidence_file = case_dir / "evidence.json"
    if not evidence_file.is_file():
        raise ValueError(f"{key}: evidence.json not found")
    data = json.loads(evidence_file.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{key}: evidence.json must be an object")
    leaked = _FORBIDDEN_EVIDENCE_KEYS & set(data)
    if leaked:
        raise ValueError(f"{key}: evidence contains label fields {sorted(leaked)}")

    screenshot = _inside(case_dir, data.get("screenshot_path"), key, "screenshot_path")
    dom_text = None
    if data.get("dom_path"):
        dom_file = _inside(case_dir, data["dom_path"], key, "dom_path")
        dom_text = dom_file.read_text(encoding="utf-8", errors="ignore")

    raw_viewport = data.get("viewport")
    if not isinstance(raw_viewport, dict) or "width" not in raw_viewport or "height" not in raw_viewport:
        raise ValueError(f"{key}: viewport must have width and height")
    url = data.get("url")
    if not isinstance(url, str) or not url:
        raise ValueError(f"{key}: url is missing")
    step = data.get("step_name")
    step_name = step if isinstance(step, str) and step.strip() not in _PLACEHOLDER_STEPS else None
    route = data.get("route") if isinstance(data.get("route"), str) else None

    evidence = EvidenceContext(
        job_id=key,
        screenshot_path=str(screenshot),
        url=url,
        route=route,
        viewport=ViewportConfig(
            width=raw_viewport["width"],
            height=raw_viewport["height"],
            is_mobile=bool(data.get("is_mobile", False)),
        ),
        dom_snippet=dom_text,
        step_name=step_name,
    )

    if not is_defective:
        expected: Optional[str] = "none"
    elif labels is None:
        expected = None
    elif key in labels:
        expected = labels[key]
    else:
        raise ValueError(f"{key}: no label provided in the labels file")
    return BenchmarkCase(case_key=key, evidence=evidence, is_defective=is_defective, expected=expected)


def load_labels(path) -> Dict[str, str]:
    """Read a labels file: a JSON object such as {"defective/case_01": "product-image-distortion"}."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in data.items()
    ):
        raise ValueError("Labels file must be a JSON object of case key to category")
    return data


def load_v2_cases(data_dir, labels: Optional[Dict[str, str]] = None) -> List[BenchmarkCase]:
    """Load every case from the V2 folder layout (baseline cases first)."""
    root = Path(data_dir)
    if (root / "model_inputs").is_dir():
        root = root / "model_inputs"

    cases: List[BenchmarkCase] = []
    for group, is_defective in _GROUPS:
        group_dir = root / group
        if not group_dir.is_dir():
            continue
        for case_dir in sorted(p for p in group_dir.iterdir() if p.is_dir()):
            cases.append(_load_case(case_dir, f"{group}/{case_dir.name}", is_defective, labels))
    if not cases:
        raise ValueError(f"No cases found under {root} (expected baseline/ and defective/ folders)")

    if labels is not None:
        known = {c.case_key for c in cases if c.is_defective}
        unknown = set(labels) - known
        if unknown:
            raise ValueError(f"Labels refer to unknown cases: {sorted(unknown)}")
    return cases


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the AI engine on the V2 evidence dataset and score the results."
    )
    parser.add_argument("--data", required=True, help="dataset folder (contains model_inputs/)")
    parser.add_argument("--labels", help="JSON file mapping defective case keys to categories")
    parser.add_argument("--mock", action="store_true", help="use the mock model (checks plumbing only)")
    parser.add_argument("--output", help="write the full results to this JSON file")
    args = parser.parse_args(argv)

    try:
        labels = load_labels(args.labels) if args.labels else None
        cases = load_v2_cases(args.data, labels)
    except (OSError, ValueError) as exc:
        print(f"Could not load cases: {exc}", file=sys.stderr)
        return 2

    if args.mock:
        model: VisionModel = MockVisionModel()
    else:
        from vlm_client import get_vision_client
        model = get_vision_client()
    if isinstance(model, MockVisionModel):
        print("Note: the mock model ignores the screenshots. These numbers check the plumbing, not accuracy.")
    if labels is None:
        print("Note: no labels file, so category accuracy for defective cases is skipped.")

    result = run_benchmark(cases, model)
    print(result.format_summary())
    if args.output:
        Path(args.output).write_text(result.model_dump_json(indent=2), encoding="utf-8")
        print(f"Results written to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())