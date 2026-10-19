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


def extract_json_from_response(raw: str) -> dict:
    """Extract a JSON object from raw model output.

    Handles common VLM quirks:
    - Markdown fenced code blocks (```json ... ```)
    - Leading/trailing whitespace or explanation text
    - Minor formatting issues

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
        return parsed

    # Try to find a JSON object anywhere in the text
    brace_match = re.search(r'\{.*\}', text, re.DOTALL)
    if brace_match:
        parsed = _as_object(brace_match.group())
        if parsed is not None:
            return parsed

    raise ValueError(f"Could not extract valid JSON from model response: {text[:200]}")


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
        if confidence < 0.5:
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
        dom_snippet=evidence.dom_snippet,
        step_name=evidence.step_name,
    )

    # Step 3: Call VLM
    start_time = time.perf_counter()
    raw_response = model.analyze(evidence.screenshot_path, prompt)
    latency_ms = (time.perf_counter() - start_time) * 1000

    # Step 4: Parse response
    try:
        parsed = extract_json_from_response(raw_response)
    except ValueError:
        # Model returned unparseable output — report as inconclusive
        return AnalysisResponse(
            job_id=evidence.job_id,
            has_defect=False,
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

    return AnalysisResponse(
        job_id=evidence.job_id,
        has_defect=has_defect,
        findings=findings,
        analysis_latency_ms=latency_ms,
        raw_model_response=raw_response,
    )