"""OmniSight Worker Reliability, Observability & Recovery Tests (Milestone M3.3).

Verifies production readiness across:
1. Structured JSON logging and context propagation.
2. Request correlation ID tracing and response header injection.
3. Operational and security telemetry metrics collection (/metrics and /api/v1/metrics).
4. Graceful shutdown, service draining, and 503 rejection during shutdown.
5. Abandoned workspace scavenging across ungraceful terminations/restarts.
6. Formal task retryability classification (idempotent inspection vs single-use repair).
7. Strict configuration security (private key rejection and production secret enforcement).
8. Bounded concurrency load verification.
"""

from __future__ import annotations

import concurrent.futures
import json
import logging
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

from crypto_approval import ApprovalSigner, ApprovalVerifier
from execution_schemas import (
    ApprovedProposalRef,
    ExecutionTaskRequest,
    RunnerMode,
    TaskExecutionStatus,
    TaskOperationType,
)
from worker_service import (
    OmniSightJsonFormatter,
    TaskRetryPolicy,
    WorkerMetricsCollector,
    WorkerTaskRegistry,
    WorkspaceManager,
    correlation_id_var,
    create_worker_app,
    setup_worker_logging,
    task_id_var,
    verify_worker_environment_security,
)

AUTH_TOKEN = "reliability-test-bearer-token-2026"
WEBHOOK_SECRET = "reliability-test-webhook-secret-2026"


# =========================================================================== #
# Area 1: Structured Observability & Telemetry Metrics
# =========================================================================== #
class TestWorkerObservability:
    """Verifies structured logging, correlation IDs, and metrics telemetry."""

    def test_json_formatter_produces_valid_structured_log(self):
        formatter = OmniSightJsonFormatter()
        record = logging.LogRecord(
            name="omnisight.test",
            level=logging.INFO,
            pathname=__file__,
            lineno=42,
            msg="Task execution started for proposal",
            args=(),
            exc_info=None,
        )
        record.task_id = "task-json-001"
        record.correlation_id = "corr-json-001"

        formatted = formatter.format(record)
        parsed = json.loads(formatted)

        assert parsed["level"] == "INFO"
        assert parsed["service"] == "omnisight-execution-worker"
        assert parsed["message"] == "Task execution started for proposal"
        assert parsed["task_id"] == "task-json-001"
        assert parsed["correlation_id"] == "corr-json-001"
        assert "timestamp" in parsed

    def test_correlation_id_header_extracted_and_echoed(self):
        app = create_worker_app(auth_token=AUTH_TOKEN)
        client = TestClient(app)

        # 1. Client provides explicit correlation ID
        resp1 = client.get("/health", headers={"X-Correlation-ID": "corr-client-provided-999"})
        assert resp1.status_code == 200
        assert resp1.headers.get("X-Correlation-ID") == "corr-client-provided-999"

        # 2. Client omits correlation ID -> Worker generates one
        resp2 = client.get("/health")
        assert resp2.status_code == 200
        gen_corr = resp2.headers.get("X-Correlation-ID")
        assert gen_corr is not None and len(gen_corr) > 10

    def test_metrics_collector_tracks_lifecycle_and_security(self):
        metrics = WorkerMetricsCollector()

        # Operational metrics
        metrics.record_request()
        metrics.record_request()
        metrics.record_task_submission()
        metrics.record_task_completion(0.125)
        metrics.record_task_failure(is_timeout=False)
        metrics.record_task_failure(is_timeout=True)
        metrics.record_task_cancellation()

        # Security audit events
        metrics.record_security_event("auth_failure")
        metrics.record_security_event("replay_attack")
        metrics.record_security_event("invalid_signature")
        metrics.record_security_event("revoked_key")
        metrics.record_security_event("payload_too_large")

        snap = metrics.snapshot()

        assert snap["total_requests"] == 2
        assert snap["tasks"]["submitted"] == 1
        assert snap["tasks"]["completed"] == 1
        assert snap["tasks"]["failed"] == 2
        assert snap["tasks"]["timed_out"] == 1
        assert snap["tasks"]["cancelled"] == 1
        assert snap["tasks"]["duration_seconds"]["average"] == 0.125

        assert snap["security_events"]["auth_failures"] == 1
        assert snap["security_events"]["replay_attacks_blocked"] == 1
        assert snap["security_events"]["invalid_signatures_blocked"] == 1
        assert snap["security_events"]["revoked_keys_blocked"] == 1
        assert snap["security_events"]["payload_size_rejections"] == 1

        assert "memory_rss_mb" in snap["resources"]
        assert "uptime_seconds" in snap

    def test_metrics_endpoint_exposed_and_accessible(self):
        app = create_worker_app(auth_token=AUTH_TOKEN)
        client = TestClient(app)

        resp1 = client.get("/metrics")
        assert resp1.status_code == 200
        data1 = resp1.json()
        assert "uptime_seconds" in data1
        assert "tasks" in data1
        assert "security_events" in data1

        resp2 = client.get("/api/v1/metrics")
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2["tasks"]["submitted"] == 0


# =========================================================================== #
# Area 2: Reliability, Lifecycle & Recovery
# =========================================================================== #
class TestWorkerLifecycleAndRecovery:
    """Verifies graceful draining, abandoned workspace scavenging, and retry policy."""

    def test_draining_state_rejects_new_tasks_with_503(self):
        app = create_worker_app(auth_token=AUTH_TOKEN)
        client = TestClient(app)

        # Mark application state as draining
        app.state.is_draining = True

        # Health check reflects draining status
        resp_health = client.get("/health")
        assert resp_health.status_code == 200
        health_data = resp_health.json()
        assert health_data["status"] == "draining"
        assert health_data["available"] is False
        assert health_data["draining"] is True

        # New task submissions are rejected with HTTP 503
        payload = {
            "task_id": "task-drain-test-01",
            "job_id": "job-drain-01",
            "operation": "capture_evidence",
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        }
        resp_submit = client.post(
            "/api/v1/tasks",
            json=payload,
            headers={"Authorization": f"Bearer {AUTH_TOKEN}"},
        )
        assert resp_submit.status_code == 503
        assert "draining" in resp_submit.json()["detail"].lower()

    def test_workspace_janitor_reclaims_abandoned_directories(self):
        with tempfile.TemporaryDirectory() as tmp_root:
            mgr = WorkspaceManager(base_dir=Path(tmp_root))

            # Create three workspaces
            ws1 = mgr.create_workspace("task-active-01")
            ws2 = mgr.create_workspace("task-stale-02")
            ws3 = mgr.create_workspace("task-stale-03")

            # Artificially age ws2 and ws3 by 2 hours
            two_hours_ago = time.time() - 7200
            os.utime(ws2, (two_hours_ago, two_hours_ago))
            os.utime(ws3, (two_hours_ago, two_hours_ago))

            # Scavenge with 1 hour threshold (3600 seconds)
            reclaimed = mgr.cleanup_abandoned_workspaces(max_age_seconds=3600.0)
            assert reclaimed == 2
            assert ws1.exists()  # Active workspace remains
            assert not ws2.exists()  # Stale workspaces purged
            assert not ws3.exists()

    def test_task_retryability_policy_classification(self):
        # 1. CAPTURE_EVIDENCE: Read-only, idempotent -> Safe to retry
        retry_evidence, reason_ev = TaskRetryPolicy.is_retryable(TaskOperationType.CAPTURE_EVIDENCE)
        assert retry_evidence is True
        assert "idempotent" in reason_ev.lower()

        # 2. EXECUTE_REPAIR: State mutating with cryptographic nonce -> Human review required
        retry_repair, reason_rep = TaskRetryPolicy.is_retryable(TaskOperationType.EXECUTE_REPAIR)
        assert retry_repair is False
        assert "nonce" in reason_rep.lower() or "approval" in reason_rep.lower()

        # 3. VERIFY_REPAIR / Unknown operations
        retry_other, _ = TaskRetryPolicy.is_retryable(TaskOperationType.VERIFY_REPAIR)
        assert retry_other is False


# =========================================================================== #
# Area 3: Configuration & Secret Safety Invariants
# =========================================================================== #
class TestWorkerConfigurationSecurity:
    """Verifies that private keys and insecure default secrets are forbidden."""

    def test_private_signing_key_presence_fails_closed(self, monkeypatch):
        # Simulate accidental injection of private signing key into worker environment
        monkeypatch.setenv("OMNISIGHT_APPROVAL_PRIVATE_KEY_HEX", "ab" * 32)

        with pytest.raises(RuntimeError, match="CRITICAL SECURITY VIOLATION"):
            verify_worker_environment_security()

    def test_production_mode_rejects_default_insecure_tokens(self, monkeypatch):
        monkeypatch.setenv("OMNISIGHT_ENVIRONMENT", "production")
        monkeypatch.setenv("OMNISIGHT_WORKER_AUTH_TOKEN", "worker-auth-secret-token")
        monkeypatch.delenv("OMNISIGHT_APPROVAL_PRIVATE_KEY_HEX", raising=False)

        with pytest.raises(RuntimeError, match="Production configuration error"):
            verify_worker_environment_security()

    def test_production_mode_rejects_default_webhook_secret(self, monkeypatch):
        monkeypatch.setenv("OMNISIGHT_ENVIRONMENT", "production")
        monkeypatch.setenv("OMNISIGHT_WORKER_AUTH_TOKEN", "valid-prod-token-super-secure-382910")
        monkeypatch.setenv("OMNISIGHT_WEBHOOK_SECRET", "webhook-signing-secret-key")
        monkeypatch.delenv("OMNISIGHT_APPROVAL_PRIVATE_KEY_HEX", raising=False)

        with pytest.raises(RuntimeError, match="Production configuration error"):
            verify_worker_environment_security()

    def test_development_mode_allows_fallback_tokens(self, monkeypatch):
        monkeypatch.setenv("OMNISIGHT_ENVIRONMENT", "development")
        monkeypatch.setenv("OMNISIGHT_WORKER_AUTH_TOKEN", "worker-auth-secret-token")
        monkeypatch.setenv("OMNISIGHT_WEBHOOK_SECRET", "webhook-signing-secret-key")
        monkeypatch.delenv("OMNISIGHT_APPROVAL_PRIVATE_KEY_HEX", raising=False)

        # In development mode, verify_worker_environment_security should not raise
        verify_worker_environment_security()


# =========================================================================== #
# Area 4: Controlled Concurrency Load Verification
# =========================================================================== #
class TestWorkerControlledLoadBenchmark:
    """Bounded concurrent load verification testing response latency and throughput."""

    def test_concurrent_task_submissions_bounded_latency(self):
        app = create_worker_app(
            auth_token=AUTH_TOKEN,
            command_override=["echo", "benchmark-ok"],
        )
        client = TestClient(app)

        num_tasks = 25
        latencies_ms = []

        def submit_task(idx: int) -> float:
            t0 = time.perf_counter()
            resp = client.post(
                "/api/v1/tasks",
                json={
                    "task_id": f"task-bench-concur-{idx}",
                    "job_id": f"job-bench-{idx}",
                    "operation": "capture_evidence",
                    "submitted_at": datetime.now(timezone.utc).isoformat(),
                    "correlation_id": f"corr-bench-{idx}",
                    "idempotency_key": f"idem-bench-{idx}",
                },
                headers={
                    "Authorization": f"Bearer {AUTH_TOKEN}",
                    "X-Correlation-ID": f"corr-bench-{idx}",
                },
            )
            t1 = time.perf_counter()
            assert resp.status_code == 201
            assert resp.headers.get("X-Correlation-ID") == f"corr-bench-{idx}"
            return (t1 - t0) * 1000.0

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            futures = [pool.submit(submit_task, i) for i in range(num_tasks)]
            for fut in concurrent.futures.as_completed(futures):
                latencies_ms.append(fut.result())

        assert len(latencies_ms) == num_tasks
        latencies_ms.sort()
        p95 = latencies_ms[int(num_tasks * 0.95)]
        # Assert p95 response time is well below 500ms
        assert p95 < 500.0

        # Verify metrics updated
        metrics_resp = client.get("/metrics")
        assert metrics_resp.status_code == 200
        snap = metrics_resp.json()
        assert snap["tasks"]["submitted"] == num_tasks
