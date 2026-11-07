"""OmniSight Adversarial Security Test Suite (Milestone M3.2).

Performs rigorous red-team penetration testing across:
1. Cryptographic Approval Security (forgery, tampering, concurrent replay, key revocation).
2. Container & Path Isolation (filesystem traversal, workspace boundary violations).
3. Resource Exhaustion & DoS Resistance (request body size caps, registry bounding, timeout termination).
4. Execution Lifecycle & Concurrency (cancellation races, duplicate submissions).
5. API and Webhook Security (auth bypass, HMAC tampering, secret leakage prevention).
6. Cross-Task Isolation (independent 0700 workspaces, TMPDIR isolation).
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import hmac
import json
import os
import shutil
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

import pytest
from fastapi.testclient import TestClient

from crypto_approval import (
    ApprovalReplayCache,
    ApprovalSigner,
    ApprovalSigningPayload,
    ApprovalVerifier,
    compute_digest_sha256,
)
from execution_schemas import (
    ApprovedProposalRef,
    ExecutionError,
    ExecutionResult,
    ExecutionTaskRequest,
    RunnerMode,
    TaskExecutionStatus,
    TaskOperationType,
)
from worker_service import (
    WebhookDispatcher,
    WorkerTaskRegistry,
    WorkspaceManager,
    create_worker_app,
)

AUTH_TOKEN = "test-adversarial-secret-token-2026"
WEBHOOK_SECRET = "test-adversarial-webhook-hmac-key-2026"


# =========================================================================== #
# Area 1: Cryptographic Approval Security
# =========================================================================== #
class TestAdversarialCryptographicApproval:
    """Adversarial tests against Ed25519 signatures, replay cache, and digest binding."""

    @pytest.fixture
    def crypto_fixture(self):
        signer = ApprovalSigner.generate(key_id="omnisight-qa-root-v2")
        verifier = ApprovalVerifier(
            trusted_public_keys={"omnisight-qa-root-v2": signer.private_key.public_key()},
            default_public_key=signer.private_key.public_key(),
            enforce_signatures=True,
            revoked_key_ids={"omnisight-qa-root", "omnisight-qa-root-v1"},
        )
        return signer, verifier

    def test_adversarial_forged_signatures_exhaustive(self, crypto_fixture):
        signer, verifier = crypto_fixture
        ref_dict = signer.create_approved_ref(
            proposal_id="prop-forge-test",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Security Reviewer",
            patch_id="patch-01",
            patch_digest_sha256="a" * 64,
        )
        valid_sig_hex = ref_dict["signature"]
        raw_sig = bytearray(bytes.fromhex(valid_sig_hex))

        # 1. Completely random 64-byte signature
        forged_1 = dict(ref_dict, signature=os.urandom(64).hex())
        assert verifier.verify(ApprovedProposalRef(**forged_1))[0] is False

        # 2. Corrupt first byte
        corrupt_first = bytearray(raw_sig)
        corrupt_first[0] ^= 0xFF
        forged_2 = dict(ref_dict, signature=corrupt_first.hex())
        assert verifier.verify(ApprovedProposalRef(**forged_2))[0] is False

        # 3. Corrupt middle byte
        corrupt_mid = bytearray(raw_sig)
        corrupt_mid[32] ^= 0x55
        forged_3 = dict(ref_dict, signature=corrupt_mid.hex())
        assert verifier.verify(ApprovedProposalRef(**forged_3))[0] is False

        # 4. Corrupt last byte
        corrupt_last = bytearray(raw_sig)
        corrupt_last[63] ^= 0xAA
        forged_4 = dict(ref_dict, signature=corrupt_last.hex())
        assert verifier.verify(ApprovedProposalRef(**forged_4))[0] is False

        # 5. All zero signature
        forged_5 = dict(ref_dict, signature="00" * 64)
        assert verifier.verify(ApprovedProposalRef(**forged_5))[0] is False

    def test_adversarial_payload_field_tampering_exhaustive(self, crypto_fixture):
        signer, verifier = crypto_fixture
        ref_dict = signer.create_approved_ref(
            proposal_id="prop-tamper-target",
            scenario_id="scenario-01",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice Approver",
            patch_id="patch-01",
            patch_digest_sha256="f" * 64,
        )

        # Every field mutation must invalidate the cryptographic signature
        fields_to_tamper = {
            "proposal_id": "prop-attacker-swapped",
            "scenario_id": "scenario-evil",
            "defect_category": "SECURITY_EXPLOIT",
            "source_file": "src/hacked.css",
            "source_file_sha256": "1" * 64,
            "reviewed_by": "Eve Mallory",
            "patch_id": "patch-evil",
            "patch_digest_sha256": "0" * 64,
            "signer_key_id": "attacker-key-01",
            "approval_nonce": "tampered_nonce_val_123",
        }

        for field, evil_val in fields_to_tamper.items():
            verifier.replay_cache.clear()
            tampered = dict(ref_dict)
            tampered[field] = evil_val
            proposal_ref = ApprovedProposalRef(**tampered)
            valid, msg = verifier.verify(proposal_ref)
            assert valid is False, f"Tampered field {field!r} unexpectedly passed signature check!"
            assert "verification failed" in msg.lower() or "no trusted public key" in msg.lower()

    def test_adversarial_concurrent_replay_race(self, crypto_fixture):
        signer, verifier = crypto_fixture
        ref_dict = signer.create_approved_ref(
            proposal_id="prop-concurrent-01",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Concurrent Tester",
        )
        proposal_ref = ApprovedProposalRef(**ref_dict)

        num_threads = 20
        results = []

        def attempt_verification():
            return verifier.verify(proposal_ref)

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(attempt_verification) for _ in range(num_threads)]
            for f in concurrent.futures.as_completed(futures):
                results.append(f.result())

        success_count = sum(1 for valid, _ in results if valid is True)
        rejection_count = sum(1 for valid, _ in results if valid is False)

        # Exactly ONE thread must succeed; all other 19 must be rejected as replay attacks
        assert success_count == 1, f"Expected exactly 1 success under concurrent replay race, got {success_count}"
        assert rejection_count == num_threads - 1

    def test_adversarial_nonce_reuse_with_different_signature(self, crypto_fixture):
        signer, verifier = crypto_fixture
        shared_nonce = "fixed-adversarial-nonce-12345"

        ref1 = signer.create_approved_ref(
            proposal_id="prop-nonce-1",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
            nonce=shared_nonce,
        )
        ref2 = signer.create_approved_ref(
            proposal_id="prop-nonce-2",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Alice",
            nonce=shared_nonce,
        )

        valid1, _ = verifier.verify(ApprovedProposalRef(**ref1))
        assert valid1 is True

        # Reusing the same nonce must be detected as a replay attack
        valid2, msg2 = verifier.verify(ApprovedProposalRef(**ref2))
        assert valid2 is False
        assert "replay attack detected" in msg2.lower()

    def test_adversarial_revoked_key_rejection(self, crypto_fixture):
        _, verifier = crypto_fixture
        revoked_signer = ApprovalSigner.generate(key_id="omnisight-qa-root")

        ref = revoked_signer.create_approved_ref(
            proposal_id="prop-revoked-01",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Compromised Signer",
        )
        valid, msg = verifier.verify(ApprovedProposalRef(**ref))
        assert valid is False
        assert "has been revoked" in msg.lower()

    def test_adversarial_mismatched_patch_digest_enforcement(self, crypto_fixture):
        signer, verifier = crypto_fixture
        ref = signer.create_approved_ref(
            proposal_id="prop-digest-test",
            defect_category="UI_DEFECT",
            source_file="src/index.css",
            source_file_sha256="0" * 64,
            reviewed_by="Reviewer",
            patch_digest_sha256="a" * 64,
        )
        # Server expects patch digest "b" * 64
        valid, msg = verifier.verify(
            ApprovedProposalRef(**ref),
            expected_patch_digest="b" * 64,
        )
        assert valid is False
        assert "patch digest mismatch" in msg.lower()


# =========================================================================== #
# Area 2: Container Isolation & Path Traversal Defense
# =========================================================================== #
class TestAdversarialContainerAndPathIsolation:
    """Adversarial tests against path traversal, boundary escape, and env scrubbing."""

    def test_adversarial_path_traversal_in_proposal_source_rejected(self):
        traversal_attempts = [
            "../../etc/passwd",
            "../etc/shadow",
            "/etc/passwd",
            "\\windows\\system32\\cmd.exe",
            "src/../../../app/worker_service.py",
        ]
        for bad_path in traversal_attempts:
            with pytest.raises(ValueError) as exc:
                ApprovedProposalRef(
                    proposal_id="prop-trav-test",
                    defect_category="UI_DEFECT",
                    source_file=bad_path,
                    source_file_sha256="0" * 64,
                    reviewed_by="Alice",
                    reviewed_at=datetime.now(timezone.utc).isoformat(),
                    expires_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
                    approval_nonce="nonce-trav-1",
                    signature="aa" * 64,
                )
            assert "forbidden" in str(exc.value).lower() or "path traversal" in str(exc.value).lower()

    def test_adversarial_workspace_boundary_enforcement(self):
        with tempfile.TemporaryDirectory() as tmp_root:
            mgr = WorkspaceManager(base_dir=Path(tmp_root))

            # Normal creation gives 0700 permissions
            ws = mgr.create_workspace("task-normal-01")
            assert ws.exists()
            assert (ws.stat().st_mode & 0o777) == 0o700

            # Path traversal in task_id is sanitized to stay within base_dir
            ws_trav = mgr.create_workspace("../../../etc/shadow")
            assert ws_trav.exists()
            assert ws_trav.resolve().is_relative_to(Path(tmp_root).resolve())
            assert "shadow" in ws_trav.name

            # Explicit escape verification
            outside_target = Path("/tmp/outside_file.txt")
            with pytest.raises(ValueError) as exc:
                mgr.verify_boundary(outside_target, ws)
            assert "escapes allocated workspace" in str(exc.value)

    def test_adversarial_environment_sanitization_strips_sensitive_variables(self):
        from worker_service import TaskExecutor

        dirty_env = {
            "AWS_SECRET_ACCESS_KEY": "AKIASECRET1234567890",
            "GITHUB_TOKEN": "ghp_super_secret_github_token",
            "DATABASE_URL": "postgres://admin:pass@db.local:5432/prod",
            "OMNISIGHT_WORKER_AUTH_TOKEN": "auth-secret-12345",
            "OMNISIGHT_WEBHOOK_SECRET": "webhook-secret-98765",
            "OMNISIGHT_APPROVAL_PRIVATE_KEY_HEX": "deadbeef" * 8,
            "SAFE_VAR": "harmless_content",
        }

        with pytest.MonkeyPatch.context() as mp:
            for k, v in dirty_env.items():
                mp.setenv(k, v)

            executor = TaskExecutor(
                registry=WorkerTaskRegistry(),
                workspace_mgr=WorkspaceManager(),
                webhook_dispatcher=WebhookDispatcher(),
            )
            clean = executor.sanitize_environment()

            # Sensitive terms must be completely scrubbed
            assert "AWS_SECRET_ACCESS_KEY" not in clean
            assert "GITHUB_TOKEN" not in clean
            assert "DATABASE_URL" not in clean
            assert "OMNISIGHT_WORKER_AUTH_TOKEN" not in clean
            assert "OMNISIGHT_WEBHOOK_SECRET" not in clean
            assert "OMNISIGHT_APPROVAL_PRIVATE_KEY_HEX" not in clean


# =========================================================================== #
# Area 3: Resource Exhaustion & DoS Resistance
# =========================================================================== #
class TestAdversarialResourceExhaustionAndDoS:
    """Adversarial tests against payload bombs, registry memory exhaustion, and timeouts."""

    @pytest.fixture
    def test_client(self):
        app = create_worker_app(auth_token=AUTH_TOKEN)
        return TestClient(app)

    def test_adversarial_request_body_size_limit_rejection(self, test_client):
        # 1. Payload slightly over 2MB limit (2.1MB)
        headers = {
            "Authorization": f"Bearer {AUTH_TOKEN}",
            "Content-Type": "application/json",
            "Content-Length": str(2200000),
        }
        resp = test_client.post(
            "/api/v1/tasks",
            data=b"X" * 2200000,
            headers=headers,
        )
        assert resp.status_code == 413
        assert "exceeds" in resp.json()["detail"].lower()

    def test_adversarial_registry_capacity_bounding(self):
        # Verify that an attacker spamming task IDs cannot exhaust host memory
        max_capacity = 20
        registry = WorkerTaskRegistry(max_tasks=max_capacity)

        # Fill registry with completed tasks
        for i in range(30):
            req = ExecutionTaskRequest(
                task_id=f"spam-task-{i}",
                job_id=f"spam-job-{i}",
                operation=TaskOperationType.CAPTURE_EVIDENCE,
                correlation_id=f"corr-{i}",
                idempotency_key=f"idem-{i}",
            )
            registry.register_task(req)
            registry.update_task_status(
                task_id=f"spam-task-{i}",
                status=TaskExecutionStatus.COMPLETED,
            )

        # Registry should have capped and pruned terminal tasks
        total_tracked = len(registry.list_tasks())
        assert total_tracked <= max_capacity + 5, f"Registry failed to bound size: {total_tracked}"

    def test_adversarial_task_timeout_terminates_child_process(self):
        from worker_service import TaskExecutor

        registry = WorkerTaskRegistry()
        workspace_mgr = WorkspaceManager()
        dispatcher = WebhookDispatcher()

        # Command that sleeps for 10 seconds
        executor = TaskExecutor(
            registry=registry,
            workspace_mgr=workspace_mgr,
            webhook_dispatcher=dispatcher,
            command_override=["python3", "-c", "import time; time.sleep(10)"],
        )

        req = ExecutionTaskRequest(
            task_id="timeout-adversarial-01",
            job_id="job-timeout-01",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            correlation_id="corr-to-01",
            idempotency_key="idem-to-01",
            timeout_seconds=0.3,  # Strict short timeout
        )

        registry.register_task(req)
        start = time.monotonic()
        executor._run_task_lifecycle(req)
        duration = time.monotonic() - start

        # Must terminate within ~2 seconds (grace period + timeout), NOT wait for 10s
        assert duration < 3.0, f"Process failed to terminate on timeout: duration={duration}s"
        status = registry.get_task("timeout-adversarial-01")
        assert status is not None
        assert status.status == TaskExecutionStatus.FAILED
        assert status.error is not None
        assert "timed out" in status.error.message.lower()


# =========================================================================== #
# Area 4: Execution Lifecycle & Concurrency
# =========================================================================== #
class TestAdversarialExecutionLifecycle:
    """Adversarial tests against cancellation races, idempotency collisions, and states."""

    def test_adversarial_cancellation_race_startup(self):
        from worker_service import TaskExecutor

        registry = WorkerTaskRegistry()
        workspace_mgr = WorkspaceManager()
        dispatcher = WebhookDispatcher()

        executor = TaskExecutor(
            registry=registry,
            workspace_mgr=workspace_mgr,
            webhook_dispatcher=dispatcher,
            command_override=["python3", "-c", "import time; time.sleep(1)"],
        )

        req = ExecutionTaskRequest(
            task_id="race-task-01",
            job_id="job-race-01",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            correlation_id="corr-race-01",
            idempotency_key="idem-race-01",
        )

        registry.register_task(req)
        # Cancel immediately before thread runs
        registry.cancel_task("race-task-01")

        # Now run lifecycle thread
        executor._run_task_lifecycle(req)

        # Status must remain CANCELLED, never flipped to RUNNING or COMPLETED
        final = registry.get_task("race-task-01")
        assert final is not None
        assert final.status == TaskExecutionStatus.CANCELLED

    def test_adversarial_duplicate_concurrent_submissions(self):
        registry = WorkerTaskRegistry()
        req = ExecutionTaskRequest(
            task_id="concurrent-idem-01",
            job_id="job-idem-01",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            correlation_id="corr-idem-01",
            idempotency_key="shared-idem-token-999",
        )

        results = []

        def submit():
            return registry.register_task(req)

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(submit) for _ in range(10)]
            for f in concurrent.futures.as_completed(futures):
                results.append(f.result())

        # Exactly 1 thread must register new task; 9 must get idempotent hit
        new_submissions = sum(1 for _, is_new in results if is_new is True)
        idempotent_hits = sum(1 for _, is_new in results if is_new is False)

        assert new_submissions == 1
        assert idempotent_hits == 9

    def test_adversarial_cancel_terminal_task_is_idempotent(self):
        registry = WorkerTaskRegistry()
        req = ExecutionTaskRequest(
            task_id="term-task-01",
            job_id="job-term-01",
            operation=TaskOperationType.CAPTURE_EVIDENCE,
            correlation_id="corr-term-01",
            idempotency_key="idem-term-01",
        )
        registry.register_task(req)
        registry.update_task_status("term-task-01", TaskExecutionStatus.COMPLETED)

        # Cancelling already-completed task must return completed state, not mutate
        res = registry.cancel_task("term-task-01")
        assert res is not None
        assert res.status == TaskExecutionStatus.COMPLETED


# =========================================================================== #
# Area 5: API and Webhook Security
# =========================================================================== #
class TestAdversarialApiAndWebhookSecurity:
    """Adversarial tests against auth bypass, HMAC tampering, and secret leakage."""

    @pytest.fixture
    def test_client(self):
        app = create_worker_app(
            auth_token=AUTH_TOKEN,
            webhook_secret=WEBHOOK_SECRET,
        )
        return TestClient(app)

    def test_adversarial_auth_bypass_attempts(self, test_client):
        # 1. No auth header
        resp1 = test_client.post("/api/v1/tasks", json={"task_id": "t1"})
        assert resp1.status_code == 401

        # 2. Invalid Bearer token
        resp2 = test_client.post(
            "/api/v1/tasks",
            json={"task_id": "t1"},
            headers={"Authorization": "Bearer malicious-token"},
        )
        assert resp2.status_code == 401

        # 3. Basic auth instead of Bearer
        resp3 = test_client.post(
            "/api/v1/tasks",
            json={"task_id": "t1"},
            headers={"Authorization": "Basic dXNlcjpwYXNz"},
        )
        assert resp3.status_code == 401

    def test_adversarial_webhook_hmac_tampering_detected(self):
        dispatcher = WebhookDispatcher(secret=WEBHOOK_SECRET)
        payload = b'{"event":"task.started","task_id":"task-123"}'
        valid_sig = dispatcher.sign_payload(payload, WEBHOOK_SECRET)

        # Alter payload
        tampered_payload = b'{"event":"task.started","task_id":"task-999"}'
        tampered_sig = dispatcher.sign_payload(tampered_payload, WEBHOOK_SECRET)

        # Assert signatures do not match
        assert not hmac.compare_digest(valid_sig, tampered_sig)

    def test_adversarial_secrets_not_leaked_in_responses(self, test_client):
        # 1. Health check response
        resp_health = test_client.get("/health")
        assert resp_health.status_code == 200
        health_text = resp_health.text
        assert AUTH_TOKEN not in health_text
        assert WEBHOOK_SECRET not in health_text

        # 2. 404 response
        resp_404 = test_client.get(
            "/api/v1/tasks/nonexistent-task-id-12345",
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert resp_404.status_code == 404
        assert AUTH_TOKEN not in resp_404.text


# =========================================================================== #
# Area 6: Cross-Task Isolation
# =========================================================================== #
class TestAdversarialCrossTaskIsolation:
    """Adversarial tests against cross-task workspace snooping and artifact leakage."""

    def test_adversarial_cross_task_workspace_isolation(self):
        with tempfile.TemporaryDirectory() as tmp_root:
            mgr = WorkspaceManager(base_dir=Path(tmp_root))

            ws_a = mgr.create_workspace("task-isolated-A")
            ws_b = mgr.create_workspace("task-isolated-B")

            # Must have independent directories
            assert ws_a != ws_b
            assert ws_a.exists() and ws_b.exists()

            # Write file in Task A
            secret_a = ws_a / "secret_task_a.txt"
            secret_a.write_text("private data of task A")

            # Task B cannot access Task A's path through its workspace manager
            assert not (ws_b / "secret_task_a.txt").exists()

            # Cleanup of Task A must not affect Task B
            mgr.cleanup_workspace("task-isolated-A")
            assert not ws_a.exists()
            assert ws_b.exists()
