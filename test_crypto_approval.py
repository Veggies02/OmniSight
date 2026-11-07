"""Unit and integration tests for OmniSight Cryptographic Human Approval Infrastructure.

Verifies:
- Ed25519 keypair generation and serialization.
- Canonical signing and verification of ApprovedProposalRef.
- Rejection of forged reviewer identities.
- Rejection of tampered proposal/source/patch fields.
- Rejection of expired approvals.
- Rejection of replayed approvals (nonce / signature replay protection).
- Fail-closed behavior on missing or invalid keys.
- WorkerService REST API enforcement of cryptographic approvals.
"""

import os
import secrets
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from crypto_approval import (
    ApprovalReplayCache,
    ApprovalSigner,
    ApprovalSigningPayload,
    ApprovalVerifier,
    compute_digest_sha256,
)
from execution_schemas import ApprovedProposalRef, ExecutionTaskRequest, TaskOperationType
from worker_service import create_worker_app


@pytest.fixture
def test_keypair():
    """Generates an ephemeral Ed25519 signer and verifier pair."""
    signer = ApprovalSigner.generate(key_id="qa-lead-01")
    verifier = ApprovalVerifier(
        trusted_public_keys={"qa-lead-01": signer.private_key.public_key()},
        default_public_key=signer.private_key.public_key(),
        enforce_signatures=True,
    )
    return signer, verifier


class TestCryptoApprovalPrimitives:
    """Tests core cryptographic operations and data canonicalization."""

    def test_keypair_generation_and_export(self):
        signer = ApprovalSigner.generate(key_id="key-01")
        assert len(signer.public_key_hex) == 64
        assert len(signer.private_key_hex) == 64

        # Re-import from hex
        reimported = ApprovalSigner.from_hex(signer.private_key_hex, key_id="key-01")
        assert reimported.public_key_hex == signer.public_key_hex

    def test_canonical_bytes_deterministic(self):
        payload1 = ApprovalSigningPayload(
            proposal_id="p1",
            scenario_id="s1",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="a" * 64,
            patch_id="patch-1",
            patch_digest_sha256="b" * 64,
            reviewed_by="Alice",
            reviewed_at="2026-11-07T12:00:00Z",
            expires_at="2026-11-07T13:00:00Z",
            approval_nonce="nonce123",
            signer_key_id="key-01",
        )
        payload2 = ApprovalSigningPayload(
            proposal_id="p1",
            scenario_id="s1",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="a" * 64,
            patch_id="patch-1",
            patch_digest_sha256="b" * 64,
            reviewed_by="Alice",
            reviewed_at="2026-11-07T12:00:00Z",
            expires_at="2026-11-07T13:00:00Z",
            approval_nonce="nonce123",
            signer_key_id="key-01",
        )
        assert payload1.canonical_bytes() == payload2.canonical_bytes()
        assert b"OMNISIGHT_APPROVAL_V1:" in payload1.canonical_bytes()


class TestApprovalVerificationRules:
    """Tests the cryptographic verification rules, tampering defenses, and replay detection."""

    def test_valid_approval_signature_verified(self, test_keypair):
        signer, verifier = test_keypair

        ref_dict = signer.create_approved_ref(
            proposal_id="prop-valid-01",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice Lead QA",
            scenario_id="product-image-distortion",
            patch_id="patch-01",
            patch_digest_sha256="f" * 64,
        )
        proposal_ref = ApprovedProposalRef(**ref_dict)

        valid, msg = verifier.verify(proposal_ref, expected_patch_digest="f" * 64)
        assert valid is True
        assert "cryptographically verified" in msg

    def test_forged_reviewer_identity_rejected(self, test_keypair):
        signer, verifier = test_keypair

        ref_dict = signer.create_approved_ref(
            proposal_id="prop-forge-01",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice Lead QA",
        )
        # Attacker tampers with reviewer name
        ref_dict["reviewed_by"] = "Eve Attacker"
        proposal_ref = ApprovedProposalRef(**ref_dict)

        valid, msg = verifier.verify(proposal_ref)
        assert valid is False
        assert "signature does not match" in msg or "verification failed" in msg

    def test_tampered_source_file_rejected(self, test_keypair):
        signer, verifier = test_keypair

        ref_dict = signer.create_approved_ref(
            proposal_id="prop-tamper-source",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
        )
        # Attacker redirects repair target to another file
        ref_dict["source_file"] = "src/main.ts"
        proposal_ref = ApprovedProposalRef(**ref_dict)

        valid, msg = verifier.verify(proposal_ref)
        assert valid is False
        assert "verification failed" in msg

    def test_tampered_patch_digest_rejected(self, test_keypair):
        signer, verifier = test_keypair

        ref_dict = signer.create_approved_ref(
            proposal_id="prop-tamper-patch",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
            patch_digest_sha256="1" * 64,
        )
        # Patch modified to malicious payload
        ref_dict["patch_digest_sha256"] = "2" * 64
        proposal_ref = ApprovedProposalRef(**ref_dict)

        valid, msg = verifier.verify(proposal_ref)
        assert valid is False
        assert "verification failed" in msg

    def test_mismatched_expected_patch_digest_rejected(self, test_keypair):
        signer, verifier = test_keypair

        ref_dict = signer.create_approved_ref(
            proposal_id="prop-mismatch-patch",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
            patch_digest_sha256="a" * 64,
        )
        proposal_ref = ApprovedProposalRef(**ref_dict)

        # Worker expects patch digest 'b'*64
        valid, msg = verifier.verify(proposal_ref, expected_patch_digest="b" * 64)
        assert valid is False
        assert "Patch digest mismatch" in msg

    def test_expired_approval_rejected(self, test_keypair):
        signer, verifier = test_keypair

        # Create approval that expired 10 minutes ago
        ref_dict = signer.create_approved_ref(
            proposal_id="prop-expired-01",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
            ttl_seconds=-600,  # Negative TTL
        )
        proposal_ref = ApprovedProposalRef(**ref_dict)

        valid, msg = verifier.verify(proposal_ref)
        assert valid is False
        assert "expired" in msg.lower()

    def test_future_reviewed_at_rejected(self, test_keypair):
        signer, verifier = test_keypair

        future_time = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        ref_dict = signer.create_approved_ref(
            proposal_id="prop-future-01",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
            reviewed_at=future_time,
        )
        proposal_ref = ApprovedProposalRef(**ref_dict)

        valid, msg = verifier.verify(proposal_ref)
        assert valid is False
        assert "in the future" in msg.lower()

    def test_replay_attack_rejected(self, test_keypair):
        signer, verifier = test_keypair

        ref_dict = signer.create_approved_ref(
            proposal_id="prop-replay-01",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
        )
        proposal_ref = ApprovedProposalRef(**ref_dict)

        # First verification succeeds
        valid1, msg1 = verifier.verify(proposal_ref)
        assert valid1 is True

        # Second verification with identical nonce and signature is rejected
        valid2, msg2 = verifier.verify(proposal_ref)
        assert valid2 is False
        assert "replay attack detected" in msg2.lower()

    def test_missing_signature_fail_closed(self, test_keypair):
        _, verifier = test_keypair

        proposal_ref = ApprovedProposalRef(
            proposal_id="prop-unsigned",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
            reviewed_at=datetime.now(timezone.utc).isoformat(),
            signature=None,
        )

        valid, msg = verifier.verify(proposal_ref)
        assert valid is False
        assert "Missing cryptographic signature" in msg

    def test_untrusted_signing_key_rejected(self):
        signer1 = ApprovalSigner.generate(key_id="trusted-key")
        signer2 = ApprovalSigner.generate(key_id="untrusted-key")

        # Verifier ONLY trusts signer1
        verifier = ApprovalVerifier(
            trusted_public_keys={"trusted-key": signer1.private_key.public_key()},
            default_public_key=signer1.private_key.public_key(),
            enforce_signatures=True,
        )

        # Signed by untrusted signer2
        ref_dict = signer2.create_approved_ref(
            proposal_id="prop-untrusted-01",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Mallory",
        )
        proposal_ref = ApprovedProposalRef(**ref_dict)

        valid, msg = verifier.verify(proposal_ref)
        assert valid is False
        assert "verification failed" in msg or "No trusted public key" in msg


class TestWorkerServiceCryptoApprovalIntegration:
    """End-to-end integration tests between WorkerService REST API and Crypto Approval."""

    @pytest.fixture
    def api_client(self):
        signer = ApprovalSigner.generate(key_id="qa-lead-01")
        verifier = ApprovalVerifier(
            trusted_public_keys={"qa-lead-01": signer.private_key.public_key()},
            default_public_key=signer.private_key.public_key(),
            enforce_signatures=True,
        )
        app = create_worker_app(
            auth_token="test-secret-token",
            command_override=["python3", "-c", "print('mock execution')"],
            approval_verifier=verifier,
        )
        client = TestClient(app)
        return client, signer

    def test_api_accepts_valid_signed_repair(self, api_client):
        client, signer = api_client
        ref_dict = signer.create_approved_ref(
            proposal_id="prop-api-01",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
            patch_id="patch-01",
        )

        payload = {
            "task_id": f"task-valid-{int(time.time())}",
            "job_id": "job-repair-01",
            "operation": "execute_repair",
            "correlation_id": "corr-01",
            "idempotency_key": "idem-01",
            "proposal_ref": ref_dict,
        }

        resp = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": "Bearer test-secret-token"},
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "queued"

    def test_api_rejects_forged_reviewer_signature(self, api_client):
        client, signer = api_client
        ref_dict = signer.create_approved_ref(
            proposal_id="prop-api-forge",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
        )
        # Attacker tries to impersonate another reviewer
        ref_dict["reviewed_by"] = "SuperAdmin"

        payload = {
            "task_id": "task-forge-01",
            "job_id": "job-repair-02",
            "operation": "execute_repair",
            "correlation_id": "corr-02",
            "idempotency_key": "idem-02",
            "proposal_ref": ref_dict,
        }

        resp = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": "Bearer test-secret-token"},
        )
        assert resp.status_code == 400
        assert "Cryptographic human approval verification failed" in resp.json()["detail"]

    def test_api_rejects_replayed_approval(self, api_client):
        client, signer = api_client
        ref_dict = signer.create_approved_ref(
            proposal_id="prop-api-replay",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
        )

        payload1 = {
            "task_id": "task-replay-01",
            "job_id": "job-repair-03",
            "operation": "execute_repair",
            "correlation_id": "corr-03",
            "idempotency_key": "idem-03",
            "proposal_ref": ref_dict,
        }
        resp1 = client.post(
            "/api/v1/tasks",
            json=payload1,
            headers={"Authorization": "Bearer test-secret-token"},
        )
        assert resp1.status_code == 201

        # Replay same proposal_ref with different task_id
        payload2 = {
            "task_id": "task-replay-02",
            "job_id": "job-repair-04",
            "operation": "execute_repair",
            "correlation_id": "corr-04",
            "idempotency_key": "idem-04",
            "proposal_ref": ref_dict,
        }
        resp2 = client.post(
            "/api/v1/tasks",
            json=payload2,
            headers={"Authorization": "Bearer test-secret-token"},
        )
        assert resp2.status_code == 400
        assert "replay attack detected" in resp2.json()["detail"].lower()


class TestKeyRevocationAndSecretRedaction:
    """Tests key rotation, revocation enforcement, and private key redaction."""

    def test_signer_repr_redacts_private_key(self):
        signer = ApprovalSigner.generate(key_id="test-redaction-key")
        repr_str = repr(signer)
        str_str = str(signer)
        assert signer.private_key_hex not in repr_str
        assert signer.private_key_hex not in str_str
        assert "[REDACTED]" in repr_str
        assert "[REDACTED]" in str_str

    def test_revoked_key_id_rejected(self, test_keypair):
        signer, verifier = test_keypair
        ref_dict = signer.create_approved_ref(
            proposal_id="prop-rev-01",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
        )
        proposal_ref = ApprovedProposalRef(**ref_dict)

        # Valid initially
        valid_before, _ = verifier.verify(proposal_ref)
        assert valid_before is True

        # Revoke key ID
        verifier.revoke_key_id(signer.key_id)

        # Rejected after revocation
        valid_after, msg = verifier.verify(proposal_ref)
        assert valid_after is False
        assert "has been revoked" in msg.lower()

    def test_revoked_public_key_hex_rejected(self, test_keypair):
        signer, verifier = test_keypair
        ref_dict = signer.create_approved_ref(
            proposal_id="prop-rev-02",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
        )
        proposal_ref = ApprovedProposalRef(**ref_dict)

        # Revoke public key hex
        verifier.revoke_public_key_hex(signer.public_key_hex)

        valid, msg = verifier.verify(proposal_ref)
        assert valid is False
        assert "has been revoked" in msg.lower()

    def test_verifier_loads_revocations_from_env(self, monkeypatch):
        signer = ApprovalSigner.generate(key_id="compromised-root")
        monkeypatch.setenv("OMNISIGHT_APPROVAL_PUBLIC_KEY_HEX", signer.public_key_hex)
        monkeypatch.setenv("OMNISIGHT_REVOKED_KEY_IDS", "compromised-root,old-key")

        verifier = ApprovalVerifier.from_env()
        assert "compromised-root" in verifier.revoked_key_ids

        ref_dict = signer.create_approved_ref(
            proposal_id="prop-env-rev",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
        )
        proposal_ref = ApprovedProposalRef(**ref_dict)
        valid, msg = verifier.verify(proposal_ref)
        assert valid is False
        assert "has been revoked" in msg.lower()

    def test_malformed_signature_payloads_rejected(self, test_keypair):
        signer, verifier = test_keypair
        ref_dict = signer.create_approved_ref(
            proposal_id="prop-malformed",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
        )

        # 1. Invalid hex string in signature
        ref_bad_hex = dict(ref_dict)
        ref_bad_hex["signature"] = "not-a-valid-hex-signature-string"
        proposal_bad_hex = ApprovedProposalRef(**ref_bad_hex)
        valid1, msg1 = verifier.verify(proposal_bad_hex)
        assert valid1 is False
        assert "invalid signature format" in msg1.lower()

        # 2. Wrong signature length (32 bytes instead of 64 bytes)
        ref_short = dict(ref_dict)
        ref_short["signature"] = "aa" * 32
        proposal_short = ApprovedProposalRef(**ref_short)
        valid2, msg2 = verifier.verify(proposal_short)
        assert valid2 is False
        assert "expected 64 bytes" in msg2.lower()

        # 3. Malformed expires_at timestamp
        ref_bad_exp = dict(ref_dict)
        ref_bad_exp["expires_at"] = "invalid-date-format"
        proposal_bad_exp = ApprovedProposalRef(**ref_bad_exp)
        valid3, msg3 = verifier.verify(proposal_bad_exp)
        assert valid3 is False
        assert "malformed expires_at timestamp" in msg3.lower()
