# OmniSight Software Dependency Inventory & Supply Chain Security Audit

**Milestone:** M3.3 (Production Readiness & Reliability Engineering)  
**Date:** 2026-11-07  
**Scope:** Execution Worker Service, Orchestrator Backend, Container Base Images, and Frontend

---

## 1. Container Base Image & Build Reproducibility

| Component | Specification | Base Image Digest / Version | Security Properties |
|---|---|---|---|
| **Builder Stage** | GCC, Make, libseccomp-dev | `python:3.11-slim-bookworm` | Minimal Debian Bookworm slim; discarded after compilation. |
| **Runtime Stage** | Python 3.11, libseccomp2, Node.js runtime | `python:3.11-slim-bookworm` | Non-root UID `10001:10001`; compiler and headers excluded. |
| **Compiler Flags** | Seccomp C library hardening | `-O2 -Wall -fstack-protector-strong -D_FORTIFY_SOURCE=2 -Wformat -Werror=format-security` | Stack smashing protection, format string protection, buffer overflow checks. |

---

## 2. Python Production Dependencies (Worker Service)

Pinned via `requirements-worker.lock` for deterministic, bit-for-bit reproducible installs:

| Package | Version | License | Direct / Transitive | Purpose |
|---|---|---|---|---|
| `fastapi` | 0.162.0 | MIT | Direct | REST API framework for execution worker service |
| `uvicorn` | 0.54.0 | BSD-3-Clause | Direct | High-performance ASGI web server |
| `pydantic` | 2.14.1 | MIT | Direct | Contract schemas and runtime data validation |
| `pydantic_core` | 2.50.1 | MIT | Transitive | Rust validation engine for Pydantic v2 |
| `cryptography` | 50.0.2 | Apache-2.0 / BSD | Direct | Ed25519 signature verification and cryptographic hashing |
| `httpx` | 0.28.1 | BSD-3-Clause | Direct | HTTP client for webhook delivery and health probes |
| `starlette` | 1.10.0 | BSD-3-Clause | Transitive | Core ASGI middleware and routing primitives |
| `anyio` | 4.15.1 | MIT | Transitive | Structured concurrency and asynchronous event loops |
| `cffi` | 2.1.1 | MIT | Transitive | Foreign Function Interface for low-level cryptographic libraries |
| `pytest` | 9.2.0 | MIT | Dev/Test | Automated test runner and assertion library |

---

## 3. Node.js Frontend Dependencies

Audited via `npm audit`:
- **Result:** **0 vulnerabilities found** (all low, moderate, high, and critical tiers clean).
- **Package Lock:** `package-lock.json` version 3 with exact sub-dependency hashes.

---

## 4. Software Bill of Materials (SBOM)

A standardized CycloneDX v1.5 JSON SBOM is maintained at:
`docs/sbom/omnisight-worker-sbom.json`
