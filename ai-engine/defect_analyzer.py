"""Visual defect analysis pipeline.

Orchestrates:
1. Evidence validation (screenshot existence, format, size)
2. Prompt construction with DOM sanitisation
3. VLM inference via the configured provider
4. Robust JSON extraction and parsing of model output
5. Pydantic-validated AIFinding / AnalysisResponse generation

This module is detection-only. It never modifies source code, executes
shell commands, or creates Git commits.
"""
import json
import os
import re
import time
from typing import List, Optional

from prompts import build_analysis_prompt, AJAY_CATEGORY_MAP
from schemas import (
    AIFinding,
    AnalysisResponse,
    DefectCategory,
    EvidenceContext,
)
from vlm_client import VisionModel, VLMError
from uncertainty import annotate_findings, get_review_threshold
from dom_utils import prepare_dom_context


# =====================================================================
# Constants
# =====================================================================

ALLOWED_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
VALID_CATEGORIES = set(e.value for e in DefectCategory)

# Ajay's seeded defect IDs, keyed the way normalize_category() cleans input
# (hyphens become underscores). Built from the shared map in prompts.py so
# there is a single source of truth.
_AJAY_ID_MAP = {
    key.replace("-", "_"): value for key, value in AJAY_CATEGORY_MAP.items()
}


# =====================================================================
# Evidence Validation
# =====================================================================

def validate_screenshot(path: str) -> None:
    """Verify that the screenshot file exists, has a supported format,
    and does not exceed the size limit.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the format is unsupported or file is too large.
    """
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Screenshot not found: {path}")

    ext = os.path.splitext(path)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(
            f"Unsupported image format '{ext}'. "
            f"Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    file_size = os.path.getsize(path)
    if file_size > MAX_FILE_SIZE_BYTES:
        raise ValueError(
            f"Screenshot exceeds 10 MB limit ({file_size:,} bytes): {path}"
        )

    if file_size == 0:
        raise ValueError(f"Screenshot file is empty: {path}")


# =====================================================================
# Response Parsing
# =====================================================================

def _as_object(text: str) -> Optional[dict]:
    """Parse text as JSON and return it only if it is a JSON object."""
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _to_bool(value) -> bool:
    """Interpret a model-supplied value as a boolean.

    Models sometimes send "false" or "true" as strings. In Python a
    non-empty string is always truthy, so plain truthiness would turn
    "false" into True.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("true", "yes", "1")
    if isinstance(value, (int, float)):
        return value != 0
    return False


def _outside_strings(text: str, fn) -> str:
    """Apply fn to the parts of text that are outside double-quoted strings."""
    out = []
    buf = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == '"':
            out.append(fn("".join(buf)))
            buf = []
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == '"':
                    break
                j += 1
            out.append(text[i:j + 1])
            i = j + 1
        else:
            buf.append(ch)
            i += 1
    out.append(fn("".join(buf)))
    return "".join(out)


def _fix_python_literals(segment: str) -> str:
    segment = re.sub(r'\bTrue\b', 'true', segment)
    segment = re.sub(r'\bFalse\b', 'false', segment)
    return re.sub(r'\bNone\b', 'null', segment)


def _fix_trailing_commas(segment: str) -> str:
    return re.sub(r',(\s*[}\]])', r'\1', segment)


def _scan_structure(text: str):
    """Walk the text tracking strings and brackets.

    Returns (end_index, open_brackets, in_string). end_index is the position
    where the first top-level object or array closes, or None if the text
    ends before that happens (a truncated response).
    """
    stack = []
    in_string = False
    escaped = False
    for i, ch in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if stack:
                stack.pop()
            if not stack:
                return i, stack, False
    return None, stack, in_string


def _close_truncated(text: str) -> str:
    """Cut trailing text after a complete object, or close a truncated one."""
    end, stack, in_string = _scan_structure(text)
    if end is not None:
        return text[:end + 1]
    result = text
    if in_string:
        result += '"'
    result = result.rstrip()
    if result.endswith(","):
        result = result[:-1]
    elif result.endswith(":"):
        result += " null"
    return result + "".join(reversed(stack))


def repair_json(text: str) -> Optional[str]:
    """Attempt to repair common model mistakes in a JSON object.

    Fixes: single-quoted JSON, Python literals (True/False/None), trailing
    commas, text after the object, and truncated output with missing closing
    quotes or brackets. Returns the repaired text, or None if the text has no
    object to repair. The result may still be invalid JSON, so callers must
    parse it.

    Single quotes are only converted when the text contains no double quotes,
    because apostrophes inside normal descriptions would otherwise break it.
    """
    start = text.find("{")
    if start == -1:
        return None
    candidate = text[start:]

    if '"' not in candidate and "'" in candidate:
        candidate = candidate.replace("'", '"')

    candidate = _outside_strings(candidate, _fix_python_literals)
    candidate = _close_truncated(candidate)
    candidate = _outside_strings(candidate, _fix_trailing_commas)
    return candidate

def extract_json_with_status(raw: str) -> tuple:
    """Extract a JSON object from raw model output.

    Returns (parsed_object, was_repaired). was_repaired is True when the
    response only parsed after repair_json() fixed it, which means some
    fields may be missing or incomplete.

    Handles common VLM quirks:
    - Markdown fenced code blocks (```json ... ```)
    - Leading/trailing whitespace or explanation text
    - Trailing commas, single quotes, Python literals, truncated output

    Only JSON objects are accepted. A bare array, string or number is
    treated as unparseable.

    Raises:
        ValueError: If no valid JSON object can be extracted.
    """
    if not raw or not raw.strip():
        raise ValueError("Model returned an empty response")

    text = raw.strip()

    # Strip markdown code fences
    fence_match = re.search(r'```(?:json)?\s*\n?(.*?)```', text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()

    # Try direct parse first
    parsed = _as_object(text)
    if parsed is not None:
        return parsed, False

    # Try to find a JSON object anywhere in the text
    brace_match = re.search(r'\{.*\}', text, re.DOTALL)
    if brace_match:
        parsed = _as_object(brace_match.group())
        if parsed is not None:
            return parsed, False

    # Last resort: repair common formatting mistakes and truncation
    repaired = repair_json(text)
    if repaired is not None:
        parsed = _as_object(repaired)
        if parsed is not None:
            return parsed, True

    raise ValueError(f"Could not extract valid JSON from model response: {text[:200]}")


def extract_json_from_response(raw: str) -> dict:
    """Extract a JSON object from raw model output (see extract_json_with_status)."""
    return extract_json_with_status(raw)[0]


def normalize_category(raw_category: str) -> str:
    """Map a raw category string to a valid DefectCategory value.

    Accepts the exact taxonomy values, common variations, and Ajay's
    seeded defect IDs. Unknown values are mapped to 'other'.
    """
    cleaned = raw_category.strip().lower().replace("-", "_").replace(" ", "_")

    if cleaned in VALID_CATEGORIES:
        return cleaned

    if cleaned in _AJAY_ID_MAP:
        return _AJAY_ID_MAP[cleaned]

    return "other"


def parse_findings(
    raw_data: dict,
    job_id: str,
    evidence_reference: str,
) -> List[AIFinding]:
    """Convert parsed JSON into a list of validated AIFinding objects.

    Low-confidence findings (< 0.5) are automatically flagged for human review.
    Invalid or missing fields are handled gracefully without crashing.
    """
    findings: List[AIFinding] = []
    raw_findings = raw_data.get("findings", [])

    if not isinstance(raw_findings, list):
        return findings

    for item in raw_findings:
        if not isinstance(item, dict):
            continue

        category_str = normalize_category(
            str(item.get("defect_category", "other"))
        )

        # Clamp confidence to valid range
        raw_confidence = item.get("confidence", 0.5)
        try:
            confidence = max(0.0, min(1.0, float(raw_confidence)))
        except (TypeError, ValueError):
            confidence = 0.5

        requires_review = _to_bool(item.get("requires_human_review", False))
        if confidence < get_review_threshold():
            requires_review = True

        # Do not fabricate selectors — keep null if absent
        selector = item.get("target_selector")
        if selector and not isinstance(selector, str):
            selector = None

        component = item.get("target_component")
        if component and not isinstance(component, str):
            component = None

        try:
            finding = AIFinding(
                job_id=job_id,
                defect_category=DefectCategory(category_str),
                description=str(item.get("description", "No description provided")),
                evidence_reference=evidence_reference,
                target_selector=selector,
                target_component=component,
                confidence=confidence,
                requires_human_review=requires_review,
                uncertainty_notes=item.get("uncertainty_notes"),
                suggested_next_step=item.get("suggested_next_step"),
            )
            findings.append(finding)
        except Exception:
            # Skip malformed individual findings rather than crashing the pipeline
            continue

    return findings


# =====================================================================
# Main Analysis Function
# =====================================================================

def analyze_evidence(
    evidence: EvidenceContext,
    model: VisionModel,
) -> AnalysisResponse:
    """Run the full defect-detection pipeline on a single piece of evidence.

    Steps:
    1. Validate the screenshot file.
    2. Build the analysis prompt with sanitised context.
    3. Call the VLM provider.
    4. Extract and parse the JSON response.
    5. Return a validated AnalysisResponse.

    This function never modifies source code, executes commands, or
    creates Git commits. It is detection-only.

    Args:
        evidence: Validated EvidenceContext with screenshot path and metadata.
        model: A configured VisionModel provider (mock or real).

    Returns:
        An AnalysisResponse containing structured findings.

    Raises:
        FileNotFoundError: If the screenshot does not exist.
        ValueError: If the screenshot format is invalid or too large.
        VLMError: If the model provider fails after retries.
    """
    # Step 1: Validate screenshot
    validate_screenshot(evidence.screenshot_path)

    # Step 2: Build prompt
    prompt = build_analysis_prompt(
        url=evidence.url,
        route=evidence.route,
        viewport_width=evidence.viewport.width,
        viewport_height=evidence.viewport.height,
        is_mobile=evidence.viewport.is_mobile,
        dom_snippet=prepare_dom_context(evidence.dom_snippet),
        step_name=evidence.step_name,
    )

    # Step 3: Call VLM
    start_time = time.perf_counter()
    raw_response = model.analyze(evidence.screenshot_path, prompt)
    latency_ms = (time.perf_counter() - start_time) * 1000

    # Step 4: Parse response
    try:
            parsed, was_repaired = extract_json_with_status(raw_response)
    except ValueError:
        # Model returned unparseable output — report as inconclusive
        is_mock = getattr(model, "is_mock", True)
        provider = getattr(model, "provider_name", "mock" if is_mock else "unknown")
        return AnalysisResponse(
            job_id=evidence.job_id,
            has_defect=False,
            is_mock=is_mock,
            provider=provider,
            findings=[
                AIFinding(
                    job_id=evidence.job_id,
                    defect_category=DefectCategory.OTHER,
                    description="Model response could not be parsed into structured findings.",
                    evidence_reference=evidence.screenshot_path,
                    confidence=0.0,
                    requires_human_review=True,
                    uncertainty_notes=f"Raw response: {raw_response[:500]}",
                )
            ],
            analysis_latency_ms=latency_ms,
            raw_model_response=raw_response,
            error="Model response could not be parsed into structured findings.",
        )

    # Step 5: Build findings
    has_defect = _to_bool(parsed.get("has_defect", False))
    all_findings = parse_findings(parsed, evidence.job_id, evidence.screenshot_path)

    # A finding with category "none" means "nothing wrong", so it is not a defect
    findings = [f for f in all_findings if f.defect_category != DefectCategory.NONE]

    if findings:
        # Trust real findings even if the model said has_defect is false
        has_defect = True
    elif has_defect:
        # Model claimed a defect but gave nothing usable: flag for review
        findings.append(
            AIFinding(
                job_id=evidence.job_id,
                defect_category=DefectCategory.OTHER,
                description="Model indicated a defect but provided no structured findings.",
                evidence_reference=evidence.screenshot_path,
                confidence=0.3,
                requires_human_review=True,
            )
        )
    findings = annotate_findings(findings, response_repaired=was_repaired)

    is_mock = getattr(model, "is_mock", True)
    provider = getattr(model, "provider_name", "mock" if is_mock else "unknown")
    return AnalysisResponse(
        job_id=evidence.job_id,
        has_defect=has_defect,
        is_mock=is_mock,
        provider=provider,
        findings=findings,
        analysis_latency_ms=latency_ms,
        raw_model_response=raw_response,
        error=None,
    )