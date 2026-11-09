"""Rules for scenarios: one defect scenario of a capture job, with its own review, repair and PR state.

Pure functions only (no database, no network) so they are easy to test.
See backend/CONTRACT_V2_DRAFT.md for the agreed contract.
"""
import json
import re
from typing import Any, Dict, List, Optional, Tuple

# Letters, digits, '-' and '_' only. '--' is refused because the repair job id is "<job_id>--<scenario_id>".
SCENARIO_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
MAX_SCENARIO_PROPOSAL_BYTES = 200_000

FINAL_REPAIR_STATES = ("passed", "failed", "rejected", "unsupported", "error")
SUMMARY_KEYS = (
    "total", "pending_review", "approved", "repairing",
    "passed", "failed", "rejected", "unsupported", "error", "prs_created",
)


def valid_scenario_id(scenario_id: Any) -> bool:
    return isinstance(scenario_id, str) and bool(SCENARIO_ID_RE.match(scenario_id)) and "--" not in scenario_id


def repair_job_id(job_id: str, scenario_id: str) -> str:
    return f"{job_id}--{scenario_id}"


def clean_proposal(scenario_id: str, proposal: Any) -> Dict[str, Any]:
    """Copy of a generated proposal that is safe to store. Whatever it claims about review is discarded:
    approval has one source only, the approval endpoint. Raises ValueError for an unusable proposal."""
    if not isinstance(proposal, dict):
        raise ValueError(f"Proposal for '{scenario_id}' is not an object.")
    if not isinstance(proposal.get("proposalId"), str) or not proposal["proposalId"]:
        raise ValueError(f"Proposal for '{scenario_id}' needs a proposalId string.")
    if len(json.dumps(proposal)) > MAX_SCENARIO_PROPOSAL_BYTES:
        raise ValueError(f"Proposal for '{scenario_id}' is too large.")
    cleaned = dict(proposal)
    cleaned["humanReviewStatus"] = "pending_review"
    cleaned.pop("reviewedBy", None)
    cleaned.pop("reviewedAt", None)
    return cleaned


def describe_proposal(proposal: Dict[str, Any]) -> Tuple[Optional[str], bool, Dict[str, Any]]:
    """(defect_category, is_mock, diagnosis) read defensively from a generated proposal.
    Nothing is invented: a field that is not there stays None."""
    ref = proposal.get("diagnosisRef")
    ref = ref if isinstance(ref, dict) else {}
    category = (
        proposal.get("defectCategory") or proposal.get("defect_category")
        or proposal.get("category") or ref.get("category")
    )
    provider = ref.get("provider")
    is_mock = bool(
        proposal.get("is_mock") or proposal.get("isMock") or ref.get("is_mock") or provider == "mock"
    )
    diagnosis = {"provider": provider, "model": ref.get("model") or ref.get("modelName"), "status": ref.get("status")}
    return (category if isinstance(category, str) else None), is_mock, diagnosis


def is_open(scenario: Dict[str, Any]) -> bool:
    """Still needs a decision or a repair to finish."""
    if scenario["review_status"] == "pending_review":
        return True
    return scenario["review_status"] == "approved" and scenario["repair_state"] in ("not_started", "running")


def summarize(scenarios: List[Dict[str, Any]]) -> Dict[str, int]:
    summary = {key: 0 for key in SUMMARY_KEYS}
    for sc in scenarios:
        summary["total"] += 1
        if sc["review_status"] == "pending_review":
            summary["pending_review"] += 1
        if sc["review_status"] == "approved" and sc["repair_state"] == "not_started":
            summary["approved"] += 1
        if sc["repair_state"] == "running":
            summary["repairing"] += 1
        if sc["repair_state"] in FINAL_REPAIR_STATES:
            summary[sc["repair_state"]] += 1
        if sc["pr_status"] == "created":
            summary["prs_created"] += 1
    return summary


def outcome_for(scenarios: List[Dict[str, Any]]) -> Optional[str]:
    """None while any scenario is open, then all_passed / partial / all_failed / all_rejected / no_repairs_needed."""
    if not scenarios:
        return "no_repairs_needed"
    if any(is_open(sc) for sc in scenarios):
        return None
    total = len(scenarios)
    passed = sum(1 for sc in scenarios if sc["repair_state"] == "passed")
    rejected = sum(1 for sc in scenarios if sc["repair_state"] == "rejected")
    if passed == total:
        return "all_passed"
    if rejected == total:
        return "all_rejected"
    if passed >= 1:
        return "partial"
    return "all_failed"