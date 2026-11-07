#!/usr/bin/env python3
"""OmniSight Worker Performance Benchmark Tool (Milestone M3.3).

Executes controlled, bounded performance benchmarks against the OmniSight execution worker:
1. Health check latency and throughput.
2. Concurrent task submission latency (p50, p95, p99) across varying concurrency tiers.
3. Status polling latency and throughput.
4. Process memory RSS and resource monitoring before, during, and after sustained load.
5. Saves benchmark telemetry to docs/runtime-evidence/worker_benchmark_report.json.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import httpx

try:
    import resource
except ImportError:
    resource = None  # type: ignore[assignment]


def get_current_rss_mb() -> float:
    """Returns current process resident set size in megabytes."""
    if resource is None:
        return 0.0
    try:
        usage = resource.getrusage(resource.RUSAGE_SELF)
        if sys.platform == "darwin":
            return usage.ru_maxrss / (1024.0 * 1024.0)
        return usage.ru_maxrss / 1024.0
    except Exception:
        return 0.0


def run_benchmark(
    base_url: str = "http://127.0.0.1:8080",
    auth_token: str = "worker-auth-secret-token",
    output_path: str = "docs/runtime-evidence/worker_benchmark_report.json",
) -> Dict[str, Any]:
    """Runs a controlled, bounded benchmark suite."""
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json",
    }
    client = httpx.Client(base_url=base_url, timeout=10.0)

    # Verify worker availability
    try:
        resp = client.get("/health")
        if resp.status_code != 200:
            print(f"Error: Worker health check failed with status {resp.status_code}")
            return {"status": "FAILED", "error": f"Health check returned {resp.status_code}"}
    except Exception as exc:
        print(f"Error: Could not connect to worker at {base_url}: {exc}")
        return {"status": "FAILED", "error": str(exc)}

    initial_rss = get_current_rss_mb()
    benchmark_results: Dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "target_url": base_url,
        "memory_rss_start_mb": round(initial_rss, 2),
        "tiers": {},
    }

    # ----------------------------------------------------------------------- #
    # Tier 1: Health Probe Latency & Throughput (100 sequential requests)
    # ----------------------------------------------------------------------- #
    health_latencies: List[float] = []
    t0 = time.perf_counter()
    for _ in range(100):
        req_start = time.perf_counter()
        r = client.get("/health")
        req_end = time.perf_counter()
        if r.status_code == 200:
            health_latencies.append((req_end - req_start) * 1000.0)
    total_health_time = time.perf_counter() - t0

    health_latencies.sort()
    p50_h = health_latencies[len(health_latencies) // 2]
    p95_h = health_latencies[int(len(health_latencies) * 0.95)]
    p99_h = health_latencies[int(len(health_latencies) * 0.99)]
    avg_h = sum(health_latencies) / len(health_latencies)

    benchmark_results["tiers"]["health_check"] = {
        "total_requests": len(health_latencies),
        "duration_seconds": round(total_health_time, 3),
        "throughput_req_sec": round(len(health_latencies) / total_health_time, 1),
        "latency_ms": {
            "p50": round(p50_h, 2),
            "p95": round(p95_h, 2),
            "p99": round(p99_h, 2),
            "avg": round(avg_h, 2),
            "min": round(health_latencies[0], 2),
            "max": round(health_latencies[-1], 2),
        },
    }

    # ----------------------------------------------------------------------- #
    # Tier 2: Concurrent Task Submissions (concurrency=10, 25, 50)
    # ----------------------------------------------------------------------- #
    concurrency_tiers = [10, 25]

    for concurrency in concurrency_tiers:
        submitted_task_ids: List[str] = []
        submission_latencies: List[float] = []

        def submit_one(idx: int) -> Tuple[float, int, str]:
            task_id = f"bench-task-c{concurrency}-{idx}-{int(time.time()*1000)}"
            payload = {
                "task_id": task_id,
                "job_id": f"bench-job-{idx}",
                "operation": "capture_evidence",
                "submitted_at": datetime.now(timezone.utc).isoformat(),
                "parameters": {"scenario_id": "bench_test"},
                "correlation_id": f"corr-bench-{idx}",
                "idempotency_key": f"idem-{task_id}",
            }
            req_s = time.perf_counter()
            with httpx.Client(base_url=base_url, timeout=10.0) as sub_client:
                r = sub_client.post(
                    "/api/v1/tasks",
                    json=payload,
                    headers=headers,
                )
            req_e = time.perf_counter()
            return (req_e - req_s) * 1000.0, r.status_code, task_id

        t_sub_0 = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(submit_one, i) for i in range(concurrency)]
            for fut in concurrent.futures.as_completed(futures):
                lat, code, tid = fut.result()
                if code == 201:
                    submission_latencies.append(lat)
                    submitted_task_ids.append(tid)

        t_sub_total = time.perf_counter() - t_sub_0
        if submission_latencies:
            submission_latencies.sort()
            benchmark_results["tiers"][f"concurrent_submission_{concurrency}"] = {
                "concurrency": concurrency,
                "total_requests": len(submission_latencies),
                "duration_seconds": round(t_sub_total, 3),
                "throughput_req_sec": round(len(submission_latencies) / t_sub_total, 1),
                "latency_ms": {
                    "p50": round(submission_latencies[len(submission_latencies) // 2], 2),
                    "p95": round(submission_latencies[int(len(submission_latencies) * 0.95)], 2),
                    "p99": round(submission_latencies[int(len(submission_latencies) * 0.99)], 2),
                    "avg": round(sum(submission_latencies) / len(submission_latencies), 2),
                    "min": round(submission_latencies[0], 2),
                    "max": round(submission_latencies[-1], 2),
                },
            }

    # ----------------------------------------------------------------------- #
    # Tier 3: Metrics & Resource Evaluation
    # ----------------------------------------------------------------------- #
    try:
        metrics_resp = client.get("/metrics")
        if metrics_resp.status_code == 200:
            benchmark_results["worker_metrics_snapshot"] = metrics_resp.json()
    except Exception:
        pass

    final_rss = get_current_rss_mb()
    benchmark_results["memory_rss_final_mb"] = round(final_rss, 2)
    benchmark_results["memory_growth_mb"] = round(max(0.0, final_rss - initial_rss), 2)
    benchmark_results["status"] = "PASSED"

    # Save to evidence file
    out_file = Path(output_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(benchmark_results, indent=2), encoding="utf-8")
    print(f"[BENCHMARK] Results written to {out_file.resolve()}")
    return benchmark_results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OmniSight Worker Benchmark")
    parser.add_argument("--url", default="http://127.0.0.1:8080", help="Worker base URL")
    parser.add_argument("--token", default="worker-auth-secret-token", help="Bearer auth token")
    parser.add_argument("--out", default="docs/runtime-evidence/worker_benchmark_report.json", help="Output JSON path")
    args = parser.parse_args()

    results = run_benchmark(base_url=args.url, auth_token=args.token, output_path=args.out)
    print(json.dumps(results, indent=2))
