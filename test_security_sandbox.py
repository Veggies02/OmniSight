"""OmniSight Production Security Sandbox - Automated Regression Test Suite.

Comprehensive validation covering:
1. M1 Decoupling: FastAPI startup does NOT install restrictive seccomp filters.
2. Unrestricted Subprocess Execution: Playwright and Git subprocesses function cleanly.
3. Worker Security Foundation: Seccomp-BPF implementation preserved for execution workers.
4. Fail-Closed Enforcement: Mandatory worker protection configuration is strictly enforced.
5. Honest Status Separation: Distinct API vs. Worker security reporting without premature isolation claims.
6. Container Hardening: entrypoint signal forwarding, non-root user, and Dockerfile invariants.
7. Application Integration: FastAPI health, diagnostics endpoints, and backward compatibility.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Ensure root is first on sys.path, and backend is appended
REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
else:
    sys.path.remove(str(REPO_ROOT))
    sys.path.insert(0, str(REPO_ROOT))

BACKEND_DIR = REPO_ROOT / "artifacts" / "integration-backend" / "backend"
if BACKEND_DIR.exists() and str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))

import main
import security_sandbox
from security_sandbox import (
    SandboxStatus,
    SecuritySandboxError,
    SecuritySandboxInitializationError,
    SecuritySandboxViolationError,
    get_sandbox_status,
    initialize_api_security,
    initialize_security_sandbox,
    initialize_worker_security_sandbox,
    is_enforcement_required,
    test_restricted_syscall as run_restricted_syscall_probe,
    verify_sandbox_active,
)


# ==============================================================================
# 1. Module Exports & Decoupled State Verification (M1)
# ==============================================================================


def test_security_sandbox_module_exports() -> None:
    """Verifies that all required functions, exceptions, and classes are exported."""
    assert callable(initialize_security_sandbox)
    assert callable(initialize_api_security)
    assert callable(initialize_worker_security_sandbox)
    assert callable(get_sandbox_status)
    assert callable(verify_sandbox_active)
    assert callable(security_sandbox.test_restricted_syscall)
    assert issubclass(SecuritySandboxError, Exception)
    assert issubclass(SecuritySandboxInitializationError, SecuritySandboxError)
    assert issubclass(SecuritySandboxViolationError, SecuritySandboxError)
    assert SandboxStatus.ACTIVE.value == "active"
    assert SandboxStatus.READY.value == "ready"
    assert SandboxStatus.UNSUPPORTED.value == "unsupported"
    assert SandboxStatus.FAILED.value == "failed"
    assert SandboxStatus.DISABLED.value == "disabled"


def test_fastapi_process_is_decoupled_from_seccomp() -> None:
    """M1 Requirement: FastAPI process does NOT apply restrictive seccomp filters."""
    status_data = initialize_api_security(enforce_worker_readiness=False)
    assert isinstance(status_data, dict)
    assert "api_process" in status_data

    api_profile = status_data["api_process"]
    assert api_profile["role"] == "web_api_gateway"
    assert api_profile["seccomp_applied"] is False, (
        "FastAPI main process must NOT have restrictive seccomp filters applied"
    )
    assert api_profile["subprocess_dispatch_ready"] is True
    assert api_profile["status"] == "ready"


def test_worker_security_profile_preserved_and_isolated() -> None:
    """M1 Requirement: Worker seccomp capability is preserved and tracked separately."""
    status_data = initialize_api_security(enforce_worker_readiness=False)
    assert "worker_security" in status_data

    worker_profile = status_data["worker_security"]
    assert worker_profile["role"] == "execution_worker"
    assert worker_profile["blocked_syscalls"] >= 25
    assert worker_profile["allowed_syscalls"] >= 80


def test_worker_isolation_honestly_disclosed_not_claimed_prematurely() -> None:
    """M1 Requirement: Do NOT claim worker isolation until dedicated worker service exists."""
    status_data = initialize_api_security(enforce_worker_readiness=False)
    worker_profile = status_data["worker_security"]

    # Explicitly verify we do not claim full worker container isolation in M1
    assert worker_profile["worker_isolation_verified"] is False
    assert worker_profile["isolation_model"] == "in_process_decoupled"
    assert worker_profile["worker_service_status"] == "pending_m3_worker_service"


def test_sandbox_initialization_status_schema() -> None:
    """Verifies backward compatibility of top-level status report fields."""
    status_data = initialize_security_sandbox(enforce=False)
    required_keys = {
        "status",
        "platform",
        "is_linux",
        "kernel_supported",
        "initialized",
        "enforced",
        "message",
        "blocked_syscalls",
        "allowed_syscalls",
        "policy_version",
        "api_process",
        "worker_security",
    }
    assert required_keys.issubset(status_data.keys())
    assert status_data["policy_version"] == "1.1.0-decoupled"


# ==============================================================================
# 2. Subprocess & Tooling Execution Compatibility (Integration Tests)
# ==============================================================================


def test_subprocess_execution_functional_from_fastapi_process() -> None:
    """M1 Requirement: FastAPI process retains unrestricted subprocess functionality."""
    # Ensure API security is initialized
    initialize_api_security(enforce_worker_readiness=False)

    # Spawn an actual Python subprocess to verify execve / fork are not blocked
    proc = subprocess.Popen(
        [sys.executable, "-c", "import sys; sys.exit(42)"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    stdout, stderr = proc.communicate(timeout=5)
    assert proc.returncode == 42, f"Subprocess execution failed: {stderr.decode()}"


def test_git_operations_functional_from_fastapi_process() -> None:
    """M1 Requirement: Git commands are not blocked by inherited seccomp restrictions."""
    initialize_api_security(enforce_worker_readiness=False)

    git_bin = shutil.which("git")
    if not git_bin:
        pytest.skip("git not installed on host")

    proc = subprocess.Popen(
        [git_bin, "status", "--porcelain"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    stdout, stderr = proc.communicate(timeout=5)
    assert proc.returncode == 0, f"Git status execution failed: {stderr}"


def test_playwright_runner_importable_and_dispatchable() -> None:
    """M1 Requirement: Playwright runner components in backend remain functional."""
    try:
        from browser_runner import PlaywrightCliRunner
        runner = PlaywrightCliRunner(repo_root=REPO_ROOT, base_url="http://127.0.0.1:5173", check_app=False)
        assert runner.mode == "playwright"
        command = runner._resolve_command()
        assert len(command) >= 2
    except ImportError:
        pytest.skip("browser_runner not in path")


# ==============================================================================
# 3. Worker Seccomp Filter & C Implementation Verification
# ==============================================================================


def test_seccomp_c_source_blocks_dangerous_syscalls() -> None:
    """Inspects seccomp_sandbox.c to verify explicit blocking of high-risk syscalls."""
    c_source_path = REPO_ROOT / "seccomp_sandbox.c"
    assert c_source_path.exists(), "seccomp_sandbox.c must exist in repository root"

    content = c_source_path.read_text(encoding="utf-8")

    critical_blocked_syscalls = [
        "__NR_ptrace",
        "__NR_kexec_load",
        "__NR_reboot",
        "__NR_mount",
        "__NR_umount2",
        "__NR_pivot_root",
        "__NR_chroot",
        "__NR_setuid",
        "__NR_setgid",
        "__NR_init_module",
        "__NR_delete_module",
        "__NR_bpf",
        "__NR_userfaultfd",
    ]
    for syscall_macro in critical_blocked_syscalls:
        assert syscall_macro in content, f"Missing critical dangerous syscall check: {syscall_macro}"

    assert "PR_SET_NO_NEW_PRIVS" in content, "Filter must enforce PR_SET_NO_NEW_PRIVS"
    assert "init_seccomp_sandbox" in content, "Must export init_seccomp_sandbox C ABI function"
    assert "is_seccomp_supported" in content, "Must export is_seccomp_supported C ABI function"


def test_seccomp_c_source_whitelists_runtime_syscalls() -> None:
    """Verifies that Python and Uvicorn runtime syscalls are explicitly whitelisted."""
    content = (REPO_ROOT / "seccomp_sandbox.c").read_text(encoding="utf-8")

    runtime_syscalls = [
        "__NR_read",
        "__NR_write",
        "__NR_openat",
        "__NR_close",
        "__NR_mmap",
        "__NR_mprotect",
        "__NR_brk",
        "__NR_clone",
        "__NR_futex",
        "__NR_socket",
        "__NR_bind",
        "__NR_listen",
        "__NR_accept4",
        "__NR_epoll_wait",
        "__NR_rt_sigaction",
        "__NR_clock_gettime",
    ]
    for sc in runtime_syscalls:
        assert sc in content, f"Missing essential runtime syscall in whitelist: {sc}"


def test_worker_seccomp_filter_installation_mocked_success() -> None:
    """Verifies worker filter installation logic using mocked Linux C-library bindings."""
    mock_lib = MagicMock()
    mock_lib.is_seccomp_supported.return_value = 1
    mock_lib.init_seccomp_sandbox.return_value = 0
    mock_lib.get_sandbox_status_msg.return_value = b"Mocked worker seccomp active"
    mock_lib.get_blocked_syscall_count.return_value = 27
    mock_lib.get_allowed_syscall_count.return_value = 85

    with patch("security_sandbox._get_c_bindings", return_value=mock_lib), \
         patch("sys.platform", "linux"):
        result = initialize_worker_security_sandbox(enforce=True)
        assert result["status"] == SandboxStatus.ACTIVE.value
        assert result["seccomp_applied"] is True


def test_worker_seccomp_filter_installation_mocked_failure() -> None:
    """Verifies fail-closed behavior when worker seccomp initialization returns an error code."""
    mock_lib = MagicMock()
    mock_lib.is_seccomp_supported.return_value = 1
    mock_lib.init_seccomp_sandbox.return_value = -5  # SECCOMP_STATUS_ERR_LOAD
    mock_lib.get_sandbox_status_msg.return_value = b"Failed to load filter into kernel"
    mock_lib.get_blocked_syscall_count.return_value = 27
    mock_lib.get_allowed_syscall_count.return_value = 85

    with patch("security_sandbox._get_c_bindings", return_value=mock_lib), \
         patch("sys.platform", "linux"):
        with pytest.raises(SecuritySandboxInitializationError, match="Worker seccomp installation failed"):
            initialize_worker_security_sandbox(enforce=True)

        result = initialize_worker_security_sandbox(enforce=False)
        assert result["status"] == SandboxStatus.FAILED.value


def test_restricted_syscall_blocked_behavior() -> None:
    """Verifies probe behavior of test_restricted_syscall."""
    code = run_restricted_syscall_probe()
    assert isinstance(code, int)


# ==============================================================================
# 4. Fail-Closed & Policy Enforcement Logic
# ==============================================================================


def test_worker_enforcement_fail_closed_on_unsupported_host_without_bypass(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """M1 Requirement: In enforcing mode, lack of worker protection fails closed."""
    monkeypatch.delenv("OMNISIGHT_ALLOW_DEV_SANDBOX_BYPASS", raising=False)
    monkeypatch.setenv("OMNISIGHT_ENFORCE_SANDBOX", "1")

    # On macOS host (non-Linux), enforcing worker protection must fail closed
    if not sys.platform.startswith("linux"):
        with pytest.raises(SecuritySandboxInitializationError, match="Worker seccomp protection mandatory"):
            initialize_api_security(enforce_worker_readiness=True)


def test_dev_bypass_allows_unsupported_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """Setting OMNISIGHT_ALLOW_DEV_SANDBOX_BYPASS allows non-Linux startup with warning."""
    monkeypatch.setenv("OMNISIGHT_ALLOW_DEV_SANDBOX_BYPASS", "1")
    monkeypatch.setenv("OMNISIGHT_ENFORCE_SANDBOX", "1")

    result = initialize_api_security(enforce_worker_readiness=True)
    assert result["status"] == SandboxStatus.UNSUPPORTED.value
    assert result["enforced"] is True
    assert result["api_process"]["subprocess_dispatch_ready"] is True


def test_is_enforcement_required_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies parsing of enforcement environment flags."""
    monkeypatch.delenv("OMNISIGHT_ENFORCE_SANDBOX", raising=False)
    monkeypatch.delenv("OMNISIGHT_ENFORCE_WORKER_SANDBOX", raising=False)
    monkeypatch.delenv("SECURITY_SANDBOX_REQUIRED", raising=False)
    assert is_enforcement_required() is False

    monkeypatch.setenv("OMNISIGHT_ENFORCE_WORKER_SANDBOX", "1")
    assert is_enforcement_required() is True

    monkeypatch.setenv("OMNISIGHT_ENFORCE_WORKER_SANDBOX", "0")
    monkeypatch.setenv("SECURITY_SANDBOX_REQUIRED", "true")
    assert is_enforcement_required() is True


# ==============================================================================
# 5. Container Hardening (entrypoint.sh & Dockerfile)
# ==============================================================================


def test_entrypoint_script_executable() -> None:
    """Verifies that entrypoint.sh exists and is executable."""
    entrypoint_path = REPO_ROOT / "entrypoint.sh"
    assert entrypoint_path.exists(), "entrypoint.sh must exist"
    mode = entrypoint_path.stat().st_mode
    is_executable = bool(mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH))
    assert is_executable, "entrypoint.sh must be executable (chmod +x)"


def test_entrypoint_script_security_invariants() -> None:
    """Inspects entrypoint.sh for POSIX safety, non-root check, and exec signal forwarding."""
    content = (REPO_ROOT / "entrypoint.sh").read_text(encoding="utf-8")

    assert content.startswith("#!/bin/sh"), "entrypoint.sh must have a valid POSIX shebang"
    assert "set -eu" in content, "entrypoint.sh must run with set -eu for strict error handling"
    assert "trap" in content, "entrypoint.sh must configure signal traps during startup"
    assert "CURRENT_UID" in content or "id -u" in content, "entrypoint.sh must validate user UID"
    assert "exec \"$@\"" in content, "entrypoint.sh must use exec \"$@\" for PID 1 signal forwarding"


def test_dockerfile_security_invariants() -> None:
    """Inspects Dockerfile to verify multi-stage build, unprivileged user, and least privilege."""
    dockerfile_path = REPO_ROOT / "Dockerfile"
    assert dockerfile_path.exists(), "Dockerfile must exist"

    content = dockerfile_path.read_text(encoding="utf-8")

    assert "AS builder" in content, "Dockerfile should use multi-stage build for compilation safety"
    assert "AS runtime" in content, "Dockerfile must define clean runtime stage"
    assert "USER omnisight" in content, "Dockerfile must run as non-root user omnisight"
    assert "OMNISIGHT_ENFORCE_SANDBOX=1" in content, "Container must default to enforcing sandbox"
    assert "ENTRYPOINT [\"/entrypoint.sh\"]" in content, "Dockerfile must configure entrypoint.sh"
    assert "EXPOSE 8000" in content, "Dockerfile should expose port 8000"
    assert "HEALTHCHECK" in content, "Dockerfile must define a container HEALTHCHECK"


# ==============================================================================
# 6. Application Integration & FastAPI Compatibility
# ==============================================================================


def test_hardened_app_health_endpoint() -> None:
    """Verifies that the /health endpoint responds successfully."""
    app = main.create_hardened_app(enforce_sandbox=False)
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"


def test_hardened_app_security_status_endpoint() -> None:
    """Verifies that the /security/sandbox/status endpoint returns decoupled diagnostic info."""
    app = main.create_hardened_app(enforce_sandbox=False)
    with TestClient(app) as client:
        response = client.get("/security/sandbox/status")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "policy_version" in data
        assert "api_process" in data
        assert "worker_security" in data

        # Verify decoupled API assertions
        assert data["api_process"]["seccomp_applied"] is False
        assert data["api_process"]["subprocess_dispatch_ready"] is True


def test_hardened_app_security_verify_endpoint() -> None:
    """Verifies that the /security/sandbox/verify endpoint functions properly."""
    app = main.create_hardened_app(enforce_sandbox=False)
    with TestClient(app) as client:
        response = client.post("/security/sandbox/verify")
        assert response.status_code == 200
        data = response.json()
        assert data["verified"] is True
        assert data["api_decoupled"] is True


def test_hardened_app_lifespan_fail_closed_when_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies that FastAPI lifespan fails to start in enforcing mode on unsupported platform."""
    monkeypatch.delenv("OMNISIGHT_ALLOW_DEV_SANDBOX_BYPASS", raising=False)
    monkeypatch.setenv("OMNISIGHT_ENFORCE_SANDBOX", "1")

    if not sys.platform.startswith("linux"):
        app = main.create_hardened_app(enforce_sandbox=True)
        with pytest.raises(SecuritySandboxInitializationError):
            with TestClient(app):
                pass


def test_backend_jobs_api_routes_preserved() -> None:
    """Verifies that existing backend routes (/jobs) remain registered and accessible."""
    app = main.create_hardened_app(enforce_sandbox=False)
    with TestClient(app) as client:
        response = client.get("/jobs")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
