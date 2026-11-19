"""Confidence scoring and uncertainty reporting for AI findings.

Decides when a finding needs human review and records why, so the
orchestrator and reviewers can see the reason instead of just a flag.
"""
import os
from typing import List, Optional

from schemas import AIFinding

DEFAULT_REVIEW_THRESHOLD = 0.5
THRESHOLD_ENV_VAR = "REVIEW_CONFIDENCE_THRESHOLD"

REPAIRED_RESPONSE_NOTE = (
    "Model response was malformed and had to be repaired, "
    "so some fields may be missing or incomplete."
)
MODEL_REVIEW_NOTE = "Model requested human review."


def get_review_threshold() -> float:
    """Return the confidence below which findings need human review.

    Read from the REVIEW_CONFIDENCE_THRESHOLD environment variable on every
    call. Missing, non-numeric or out-of-range values fall back to 0.5.
    """
    raw = os.getenv(THRESHOLD_ENV_VAR)
    if raw is None:
        return DEFAULT_REVIEW_THRESHOLD
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_REVIEW_THRESHOLD
    if 0.0 <= value <= 1.0:
        return value
    return DEFAULT_REVIEW_THRESHOLD


def _add_note(notes: List[str], text: str) -> None:
    """Append a note unless the same text is already present."""
    if not any(text in existing for existing in notes):
        notes.append(text)


def annotate_findings(
    findings: List[AIFinding],
    response_repaired: bool = False,
    threshold: Optional[float] = None,
) -> List[AIFinding]:
    """Flag findings that need human review and record the reasons.

    - confidence below the threshold: flagged, with a note
    - model asked for review itself: kept flagged, with a note
    - response had to be repaired: flagged, with a note

    Existing notes from the model are kept. Calling this twice does not
    duplicate notes. The findings are updated in place and also returned.
    """
    limit = get_review_threshold() if threshold is None else threshold

    for finding in findings:
        notes: List[str] = []
        existing = (finding.uncertainty_notes or "").strip()
        if existing:
            notes.append(existing)

        if finding.confidence < limit:
            finding.requires_human_review = True
            _add_note(
                notes,
                f"Low confidence ({finding.confidence:.2f}) is below the "
                f"review threshold ({limit:.2f}).",
            )
        elif finding.requires_human_review:
            _add_note(notes, MODEL_REVIEW_NOTE)

        if response_repaired:
            finding.requires_human_review = True
            _add_note(notes, REPAIRED_RESPONSE_NOTE)

        finding.uncertainty_notes = " ".join(notes) if notes else None

    return findings