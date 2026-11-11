"""Adapt the AI engine's per-scenario AnalysisResponse into the TypeScript DiagnosisResult shape."""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from scenario_logic import valid_scenario_id

# Python engine category -> TypeScript category. The engine has no image_distortion or low_contrast yet.
# 'other' stays 'unknown' on purpose: it must end up unsupported, never turned into an actionable category.
CATEGORY_MAP = {
    "mobile_button_clipping": "responsive_overflow",
    "modal_overflow": "responsive_overflow",
    "overlapping_text": "layout_breakage",
    "incorrect_spacing": "layout_breakage",
    "hidden_control": "layout_breakage",
    "other": "unknown",
}
# Verified by Ajay against SCENARIO_TO_PATCH_MAP in scripts/repair/patch-registry.ts.
# Used only to flag mismatches for the reviewer. The patch is chosen by scenario id, never by category.
EXPECTED_CATEGORY = {
    "product-image-distortion": "image_distortion",
    "product-card-layout-break": "layout_breakage",
    "low-contrast-text": "low_contrast",
    "mobile-nav-overflow": "responsive_overflow",
}
# The engine's own default viewport, i.e. what it analysed with when none was supplied.
DEFAULT_VIEWPORT = {"width": 1280, "height": 720}
_NOT_REPORTED = "Not reported by the AI engine."


def _text(value: Any, fallback: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else fallback


def _real_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def severity_for(confidence: float, requires_human_review: bool) -> str:
    """Agreed with Ajay: human review needed -> high; otherwise confidence above 0.7 -> medium; else low."""
    if requires_human_review:
        return "high"
    return "medium" if confidence > 0.7 else "low"


def _usable_confidence(value: Any) -> Optional[float]:
    """The engine's own number, clamped to 0..1. None when it is missing: a confidence is never invented."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return min(1.0, max(0.0, number))


def adapt_scenario(scenario_id: str, response: Dict[str, Any], viewport: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    error = response.get("error")
    provider = _text(response.get("provider"), "unknown")
    limitations = []
    defects = []
    ignored = 0
    for f in response.get("findings") or []:
        if f.get("defect_category") == "none":
            continue
        confidence = _usable_confidence(f.get("confidence"))
        # A finding missing what an approver needs is dropped, never filled in to look actionable.
        if confidence is None or not _real_text(f.get("description")) or f.get("defect_category") not in CATEGORY_MAP:
            ignored += 1
            continue
        description = f["description"].strip()
        needs_review = bool(f.get("requires_human_review"))
        defects.append({
            "category": CATEGORY_MAP[f["defect_category"]],
            "severity": severity_for(confidence, needs_review),
            "confidence": confidence,
            "description": description,
            "evidence": [_text(f.get("evidence_reference"), _NOT_REPORTED)],
            "affected_element": {
                "description": _text(f.get("target_component") or f.get("target_selector"), "Element not identified by the AI engine."),
                "selector": f.get("target_selector"),
            },
            "suspected_cause": _text(f.get("uncertainty_notes"), _NOT_REPORTED),
            "suggested_fix": _text(f.get("suggested_next_step"), _NOT_REPORTED),
        })
        expected = EXPECTED_CATEGORY.get(scenario_id)
        if expected and defects[-1]["category"] != expected:
            limitations.append(
                f"Category mismatch: the AI engine said '{f.get('defect_category')}' (mapped to "
                f"'{defects[-1]['category']}'), but scenario '{scenario_id}' expects '{expected}'. "
                "The patch is chosen by scenario id."
            )
        if needs_review:
            limitations.append(f"The AI engine flagged this finding for human review: {description[:120]}")
    if ignored:
        limitations.append(f"{ignored} finding(s) from the AI engine were ignored because required fields were missing or invalid.")
    if defects:
        limitations.append(
            "The AI engine reports no severity; severity is derived: human-review flag -> high, "
            "confidence above 0.7 -> medium, otherwise low."
        )
    if response.get("is_mock"):
        limitations.append("Produced by a mock provider; not a real diagnosis.")

    if error:
        status, summary = "error", f"Analysis failed: {error}"
    elif defects:
        status = "diagnosed"
        summary = defects[0]["description"] + (f" (+{len(defects) - 1} more finding(s))" if len(defects) > 1 else "")
    elif response.get("has_defect") or ignored:
        status, summary = "inconclusive", "The AI engine reported a defect but gave no usable finding."
    else:
        status, summary = "no_defect_detected", "No visual defect detected."

    result = {
        "scenarioId": scenario_id,
        "status": status,
        "diagnosis": {"schema_version": "1.0", "status": status, "summary": summary,
                      "defects": defects, "limitations": limitations},
        "model": f"ai-engine:{provider}",  # the engine's response carries no model name
        "provider": provider,
        "executionTimeMs": int(response.get("analysis_latency_ms") or 0),
        "sanitizedEvidenceRef": {
            "baselineScreenshot": f"{scenario_id}/baseline.png",
            "defectiveScreenshot": f"{scenario_id}/defective.png",
            "viewport": dict(viewport or DEFAULT_VIEWPORT),
        },
    }
    if error:
        result["error"] = str(error)
    return result


def adapt_cli_output(cli_output: Dict[str, Any], viewports: Optional[Dict[str, Dict[str, int]]] = None) -> Dict[str, Any]:
    """Whole `diagnose_cli.py --run-dir` output -> {manifest, results}. Scenario keys are folder names."""
    scenarios = cli_output.get("scenarios")
    if not isinstance(scenarios, dict):
        raise ValueError("AI engine output has no 'scenarios' object.")
    results = {}
    for scenario_id, response in scenarios.items():
        if not valid_scenario_id(scenario_id):
            raise ValueError(f"Scenario id {scenario_id!r} is not allowed.")
        results[scenario_id] = adapt_scenario(scenario_id, response, (viewports or {}).get(scenario_id))
    provider = _text(cli_output.get("provider"), "unknown")
    manifest = {
        "runId": cli_output.get("run_id"),
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "provider": provider,
        "model": f"ai-engine:{provider}",
        "scenariosDiagnosed": sum(1 for r in results.values() if r["status"] != "error"),
        "totalScenarios": len(results),
        "results": results,
    }
    return {"manifest": manifest, "results": results}