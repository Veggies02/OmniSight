"""The approval digest: a Python port of proposalDigestPayload() in scripts/vlm/proposal-digest.ts.

  payload = stable JSON (keys sorted by UTF-16 code unit, no spaces) of the proposal's immutable fields only
  digest  = SHA-256 of the payload's UTF-8 bytes, as lowercase hex

The field list below must stay identical to the TypeScript one. tests/fixtures/proposal_digest_vectors.json holds
vectors produced by running the real TypeScript function; test_proposal_digest.py checks this port against them.
Review state (humanReviewStatus, reviewedBy, reviewedAt) is NOT in the list, so approving never changes the digest.
(The hash step is SHA-256 of the payload: the TypeScript file defines the payload only, so Ajay needs to confirm that.)
"""
import hashlib
import json
import math
import re
from decimal import Decimal
from typing import Any, Dict, Optional

IMMUTABLE_FIELDS = (
    "schemaVersion", "proposalId", "runId", "attemptId", "diagnosisManifestPath", "registeredPatchId",
    "scenarioId", "diagnosisRef", "defectCategory", "severity", "localization", "suspectedRootCause",
    "evidenceExplanation", "proposedCorrection", "expectedVisualImprovement", "confidence", "confidenceScore",
    "potentialRisks", "requiredValidationTests", "status", "createdAt", "isMock",
)
DIGEST_RE = re.compile(r"^[0-9a-fA-F]{64}$")
ATTEMPT_ID_RE = re.compile(r"^attempt-[A-Za-z0-9-]+$")
# scripts/repair/patch-registry.ts (confirmed by Ajay). Patches are chosen by scenario id.
REGISTERED_PATCH_IDS = {
    "product-image-distortion": "patch-product-image-distortion-001",
    "product-card-layout-break": "patch-product-card-layout-break-002",
    "low-contrast-text": "patch-low-contrast-text-003",
    "mobile-nav-overflow": "patch-mobile-nav-overflow-004",
}


def _js_number(value: float) -> str:
    """Number.prototype.toString, as JSON.stringify prints a finite number."""
    if math.isnan(value) or math.isinf(value):
        return "null"
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    d = Decimal(repr(abs(value)))
    digits = "".join(map(str, d.as_tuple().digits)).lstrip("0") or "0"
    n = d.as_tuple().exponent + len(digits)  # value = 0.<digits> x 10^n
    digits = digits.rstrip("0") or "0"
    k = len(digits)
    if k <= n <= 21:
        body = digits + "0" * (n - k)
    elif 0 < n <= 21:
        body = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        body = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        exp = f"e{'+' if e >= 0 else '-'}{abs(e)}"
        body = digits + exp if k == 1 else digits[0] + "." + digits[1:] + exp
    return sign + body


def _js_string(value: str) -> str:
    out = json.dumps(value, ensure_ascii=False)
    return re.sub("[\ud800-\udfff]", lambda m: "\\u%04x" % ord(m.group()), out)  # lone surrogates, as JS escapes them


def _utf16_key(key: str) -> bytes:
    return key.encode("utf-16-be", "surrogatepass")


def stable_stringify(value: Any) -> str:
    if isinstance(value, list):
        return "[" + ",".join(stable_stringify(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            f"{_js_string(k)}:{stable_stringify(value[k])}" for k in sorted(value, key=_utf16_key)
        ) + "}"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value) if abs(value) <= 2**53 else _js_number(float(value))
    if isinstance(value, float):
        return _js_number(value)
    if isinstance(value, str):
        return _js_string(value)
    raise TypeError(f"cannot digest a {type(value).__name__}")


def proposal_digest_payload(proposal: Dict[str, Any]) -> str:
    return stable_stringify({f: proposal[f] for f in IMMUTABLE_FIELDS if f in proposal})


def proposal_digest(proposal: Dict[str, Any]) -> str:
    return hashlib.sha256(proposal_digest_payload(proposal).encode("utf-8")).hexdigest()


class DigestError(Exception):
    """A digest or binding check failed. `status` is the HTTP status the API answers with."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def check_approval(
    proposal: Dict[str, Any], scenario_id: str, supplied: Optional[str], run_id: Optional[str], required: bool = True
) -> Dict[str, Any]:
    """Verify that the reviewer approved THIS proposal. Returns what to store with the approval.
    Raises DigestError. Never trusts a digest written inside the proposal: it is recomputed from the content."""
    actual = proposal_digest(proposal)
    stored = proposal.get("proposalDigest")
    if stored is not None and (not isinstance(stored, str) or stored.lower() != actual):
        raise DigestError(409, "The stored proposal does not match its own proposalDigest; it will not be approved.")
    declared = proposal.get("scenarioId")
    if declared is not None and declared != scenario_id:
        raise DigestError(409, "The proposal belongs to a different scenario.")
    if "runId" in proposal and run_id is not None and proposal["runId"] != run_id:
        raise DigestError(409, "The proposal was generated for a different capture run.")
    if "attemptId" in proposal and not (isinstance(proposal["attemptId"], str) and ATTEMPT_ID_RE.match(proposal["attemptId"])):
        raise DigestError(409, "The proposal has an invalid attemptId.")
    if "registeredPatchId" in proposal and proposal["registeredPatchId"] != REGISTERED_PATCH_IDS.get(scenario_id):
        raise DigestError(409, "The proposal's registeredPatchId is not the registered patch for this scenario.")
    if supplied is None or supplied == "":
        if required:
            raise DigestError(422, "patch_digest_sha256 is required: approve the exact proposal that was shown.")
    elif not DIGEST_RE.match(supplied):
        raise DigestError(422, "patch_digest_sha256 must be 64 hexadecimal characters.")
    elif supplied.lower() != actual:
        raise DigestError(
            409, "patch_digest_sha256 does not match the proposal as stored (it may have changed since it was shown)."
        )
    binding: Dict[str, Any] = {"patch_digest_sha256": actual, "proposal_id": proposal.get("proposalId")}
    for key, field in (("run_id", "runId"), ("attempt_id", "attemptId"), ("registered_patch_id", "registeredPatchId")):
        if field in proposal:
            binding[key] = proposal[field]
    if supplied in (None, ""):  # only reachable when the digest requirement is switched off
        binding["patch_digest_sha256"] = None
        binding["digest_verified"] = False
    else:
        binding["digest_verified"] = True
    return binding
