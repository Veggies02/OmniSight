"""The Python approval digest must equal the TypeScript one, byte for byte.
tests/fixtures/proposal_digest_vectors.json was produced by running proposalDigestPayload() from
scripts/vlm/proposal-digest.ts (commit df238f5) and hashing its output with Node's crypto."""
import json
from pathlib import Path

import pytest

from proposal_digest import (
    DigestError, REGISTERED_PATCH_IDS, _js_number, check_approval, proposal_digest,
    proposal_digest_payload,
)

VECTORS = json.loads((Path(__file__).parent / "fixtures" / "proposal_digest_vectors.json").read_text(encoding="utf-8"))
SID = "product-image-distortion"


def test_there_are_vectors():
    assert len(VECTORS) >= 10


@pytest.mark.parametrize("vector", VECTORS, ids=[v["name"] for v in VECTORS])
def test_python_matches_typescript(vector):
    assert proposal_digest_payload(vector["proposal"]) == vector["payload"]
    assert proposal_digest(vector["proposal"]) == vector["sha256"]


@pytest.mark.parametrize("value, text", [
    (0, "0"), (-0.0, "0"), (1.0, "1"), (0.1, "0.1"), (1e21, "1e+21"), (1e20, "100000000000000000000"),
    (1e-6, "0.000001"), (1e-7, "1e-7"), (1.5e-7, "1.5e-7"), (123.456, "123.456"), (-0.5, "-0.5"), (5e-324, "5e-324"),
])
def test_number_formatting_follows_javascript(value, text):
    assert _js_number(float(value)) == text


@pytest.mark.parametrize("value, text", [
    (2**53, "9007199254740992"), (2**53 + 1, "9007199254740992"), (12345678901234567890, "12345678901234567000"),
    (-(2**53) - 3, "-9007199254740996"), (7, "7"),
])
def test_integers_beyond_2_53_are_rounded_like_javascript(value, text):
    from proposal_digest import stable_stringify
    assert stable_stringify(value) == text


def proposal(**extra):
    base = {"schemaVersion": "1.0", "proposalId": "prop-1", "scenarioId": SID, "status": "proposed",
            "defectCategory": "image_distortion", "humanReviewStatus": "pending_review"}
    base.update(extra)
    return base


def test_review_state_never_changes_the_digest():
    p = proposal()
    approved = dict(p, humanReviewStatus="approved", reviewedBy="qa", reviewedAt="now", approvalDigest="x")
    assert proposal_digest(p) == proposal_digest(approved)


def test_any_immutable_change_changes_the_digest():
    base = proposal_digest(proposal())
    assert proposal_digest(proposal(status="unsupported_category")) != base
    assert proposal_digest(proposal(proposedCorrection={"patchId": "x"})) != base


# ---- the approval check: matching, missing, altered, stale ----
def test_a_matching_digest_is_accepted_and_bound():
    p = proposal(runId="run-1", attemptId="attempt-1-a", registeredPatchId=REGISTERED_PATCH_IDS[SID])
    b = check_approval(p, SID, proposal_digest(p).upper(), "run-1")  # case does not matter
    assert b["patch_digest_sha256"] == proposal_digest(p) and b["digest_verified"] is True
    assert (b["run_id"], b["attempt_id"], b["registered_patch_id"]) == ("run-1", "attempt-1-a", REGISTERED_PATCH_IDS[SID])


def test_a_missing_digest_is_refused():
    with pytest.raises(DigestError) as e:
        check_approval(proposal(), SID, None, None)
    assert e.value.status == 422
    with pytest.raises(DigestError):
        check_approval(proposal(), SID, "", None)


@pytest.mark.parametrize("bad", ["abc", "g" * 64, "a" * 63, "a" * 65, " " + "a" * 63])
def test_a_malformed_digest_is_refused(bad):
    with pytest.raises(DigestError) as e:
        check_approval(proposal(), SID, bad, None)
    assert e.value.status == 422


def test_an_altered_digest_is_refused():
    with pytest.raises(DigestError) as e:
        check_approval(proposal(), SID, "0" * 64, None)
    assert e.value.status == 409


def test_a_stale_digest_is_refused():
    shown = proposal()
    changed = proposal(proposedCorrection={"patchId": "different"})
    with pytest.raises(DigestError) as e:
        check_approval(changed, SID, proposal_digest(shown), None)
    assert e.value.status == 409 and "changed" in str(e.value)


def test_the_digest_inside_the_proposal_is_never_trusted():
    p = proposal(proposalDigest="1" * 64)  # claims a digest that is not its own
    with pytest.raises(DigestError):
        check_approval(p, SID, "1" * 64, None)
    with pytest.raises(DigestError) as e:  # even when the caller sends the digest the content really has
        check_approval(p, SID, proposal_digest(p), None)
    assert "proposalDigest" in str(e.value)
    good = proposal()
    good["proposalDigest"] = proposal_digest(good)
    assert check_approval(good, SID, good["proposalDigest"], None)["digest_verified"]


@pytest.mark.parametrize("extra", [
    {"scenarioId": "low-contrast-text"}, {"runId": "run-OTHER"}, {"attemptId": "nope"}, {"attemptId": "attempt-"},
    {"registeredPatchId": "patch-low-contrast-text-003"}, {"registeredPatchId": "patch-evil"},
])
def test_binding_fields_must_match_this_scenario_and_run(extra):
    p = proposal(**extra)
    with pytest.raises(DigestError) as e:
        check_approval(p, SID, proposal_digest(p), "run-1")
    assert e.value.status == 409


def test_with_the_requirement_off_a_missing_digest_is_allowed_but_recorded_as_unverified():
    b = check_approval(proposal(), SID, None, None, required=False)
    assert b["digest_verified"] is False and b["patch_digest_sha256"] is None
    with pytest.raises(DigestError):  # a wrong digest is still refused
        check_approval(proposal(), SID, "0" * 64, None, required=False)
