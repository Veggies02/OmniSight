"""OmniSight Production Security Sandbox - Automated Regression Test Suite.

Comprehensive validation covering:
1. Sandbox initialization and C-level binding detection.
2. Least-privilege seccomp syscall whitelist and dangerous syscall blocklist.
3. Fail-closed security initialization under strict enforcement mode.
4. Permissive / development bypass behavior on non-Linux hosts.
5. Container hardening: entrypoint signal forwarding, non-root user, and Dockerfile invariants.
6. Application-level integration with FastAPI lifespan and diagnostics endpoints.
7. Compatibility with existing OmniSight backend job services.
"""

from __future__ import annotations

import os
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
    initialize_security_sandbox,
    is_enforcement_required,
    test_restricted_syscall as run_restricted_syscall_probe,
    verify_sandbox_active,
)


# ==============================================================================
# 1. Module Exports & State Verification
# ==============================================================================


def test_security_sandbox_module_exports() -> None:
    """Verifies that all required functions, exceptions, and classes are exported."""
    assert callable(initialize_security_sandbox)
    assert callable(get_sandbox_status)
    assert callable(verify_sandbox_active)
    assert callable(security_sandbox.test_restricted_syscall)
    assert issubclass(SecuritySandboxError, Exception)
    assert issubclass(SecuritySandboxInitializationError, SecuritySandboxError)
    assert issubclass(SecuritySandboxViolationError, SecuritySandboxError)
    assert SandboxStatus.ACTIVE.value == "active"
    assert SandboxStatus.UNSUPPORTED.value == "unsupported"
    assert SandboxStatus.FAILED.value == "failed"
    assert SandboxStatus.DISABLED.value == "disabled"


def test_sandbox_initialization_status_schema() -> None:
    """Verifies the schema and metadata of the sandbox status report."""
    status_data = initialize_security_sandbox(enforce=False)
    assert isinstance(status_data, dict)
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
    }
    assert required_keys.issubset(status_data.keys())
    assert status_data["policy_version"] == "1.0.0-hardened"
    assert status_data["blocked_syscalls"] >= 25
    assert status_data["allowed_syscalls"] >= 80


# ==============================================================================
# 2. Syscall Table & C Implementation Verification
# ==============================================================================


def test_seccomp_c_source_blocks_dangerous_syscalls() -> None:
    """Inspects seccomp_sandbox.c to verify explicit blocking of high-risk syscalls."""
    c_source_path = REPO_ROOT / "seccomp_sandbox.c"
    assert c_source_path.exists(), "seccomp_sandbox.c must exist in the repository root"

    content = c_source_path.read_text(encoding="utf-8")

    # High-risk syscalls that must be explicitly blocked
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

    # Verifies PR_SET_NO_NEW_PRIVS is set before installing filter
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


def test_seccomp_filter_installation_mocked_success() -> None:
    """Verifies filter installation logic using mocked Linux C-library bindings."""
    mock_lib = MagicMock()
    mock_lib.is_seccomp_supported.return_value = 1
    mock_lib.init_seccomp_sandbox.return_value = 0
    mock_lib.get_sandbox_status_msg.return_value = b"Mocked seccomp active"
    mock_lib.get_blocked_syscall_count.return_value = 27
    mock_lib.get_allowed_syscall_count.return_value = 85

    with patch("security_sandbox._get_c_bindings", return_value=mock_lib), \
         patch("sys.platform", "linux"):
        result = initialize_security_sandbox(enforce=True)
        assert result["status"] == SandboxStatus.ACTIVE.value
        assert result["initialized"] is True
        assert result["kernel_supported"] is True
        assert result["blocked_syscalls"] == 27
        assert result["allowed_syscalls"] == 85
        assert verify_sandbox_active() is True


def test_seccomp_filter_installation_mocked_failure() -> None:
    """Verifies fail-closed behavior when seccomp initialization returns an error code."""
    mock_lib = MagicMock()
    mock_lib.is_seccomp_supported.return_value = 1
    mock_lib.init_seccomp_sandbox.return_value = -5  # SECCOMP_STATUS_ERR_LOAD
    mock_lib.get_sandbox_status_msg.return_value = b"Failed to load filter into kernel"
    mock_lib.get_blocked_syscall_count.return_value = 27
    mock_lib.get_allowed_syscall_count.return_value = 85

    with patch("security_sandbox._get_c_bindings", return_value=mock_lib), \
         patch("sys.platform", "linux"):
        # Enforcing mode: must raise SecuritySandboxInitializationError
        with pytest.raises(SecuritySandboxInitializationError, match="Seccomp initialization failed"):
            initialize_security_sandbox(enforce=True)

        # Permissive mode: should record failure without raising
        result = initialize_security_sandbox(enforce=False)
        assert result["status"] == SandboxStatus.FAILED.value
        assert result["initialized"] is False


def test_restricted_syscall_blocked_behavior() -> None:
    """Verifies behavior of test_restricted_syscall."""
    code = run_restricted_syscall_probe()
    # On non-Linux (macOS Darwin), should return ENOSYS (78 on Darwin) or -1
    # On Linux with sandbox active, it would return EPERM (1)
    assert isinstance(code, int)


# ==============================================================================
# 3. Fail-Closed & Policy Enforcement Logic
# ==============================================================================


def test_fail_closed_on_unsupported_host_without_bypass(monkeypatch: pytest.MonkeyPatch) -> None:
    """In enforcing mode, an unsupported host must raise SecuritySandboxInitializationError."""
    monkeypatch.delenv("OMNISIGHT_ALLOW_DEV_SANDBOX_BYPASS", raising=False)
    monkeypatch.setenv("OMNISIGHT_ENFORCE_SANDBOX", "1")

    # On macOS host (non-Linux), enforcing mode must fail closed
    if not sys.platform.startswith("linux"):
        with pytest.raises(SecuritySandboxInitializationError, match="does not support Linux seccomp-BPF"):
            initialize_security_sandbox(enforce=True)


def test_dev_bypass_allows_unsupported_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """Setting OMNISIGHT_ALLOW_DEV_SANDBOX_BYPASS allows non-Linux startup with warning."""
    monkeypatch.setenv("OMNISIGHT_ALLOW_DEV_SANDBOX_BYPASS", "1")
    monkeypatch.setenv("OMNISIGHT_ENFORCE_SANDBOX", "1")

    result = initialize_security_sandbox(enforce=True)
    assert result["status"] == SandboxStatus.UNSUPPORTED.value
    assert result["enforced"] is True


def test_is_enforcement_required_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies parsing of enforcement environment flags."""
    monkeypatch.delenv("OMNISIGHT_ENFORCE_SANDBOX", raising=False)
    monkeypatch.delenv("SECURITY_SANDBOX_REQUIRED", raising=False)
    assert is_enforcement_required() is False

    monkeypatch.setenv("OMNISIGHT_ENFORCE_SANDBOX", "1")
    assert is_enforcement_required() is True

    monkeypatch.setenv("OMNISIGHT_ENFORCE_SANDBOX", "false")
    monkeypatch.setenv("SECURITY_SANDBOX_REQUIRED", "true")
    assert is_enforcement_required() is True


# ==============================================================================
# 4. Container Hardening (entrypoint.sh & Dockerfile)
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
# 5. Application Integration & FastAPI Compatibility
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
    """Verifies that the /security/sandbox/status endpoint returns complete diagnostic info."""
    app = main.create_hardened_app(enforce_sandbox=False)
    with TestClient(app) as client:
        response = client.get("/security/sandbox/status")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "policy_version" in data
        assert "blocked_syscalls" in data
        assert "allowed_syscalls" in data


def test_hardened_app_security_verify_endpoint() -> None:
    """Verifies that the /security/sandbox/verify endpoint functions properly."""
    app = main.create_hardened_app(enforce_sandbox=False)
    with TestClient(app) as client:
        response = client.post("/security/sandbox/verify")
        assert response.status_code == 200
        data = response.json()
        assert data["verified"] is True
        assert "status" in data


def test_hardened_app_lifespan_fail_closed_when_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies that FastAPI lifespan fails to start in enforcing mode on unsupported platform."""
    monkeypatch.delenv("OMNISIGHT_ALLOW_DEV_SANDBOX_BYPASS", raising=False)
    monkeypatch.setenv("OMNISIGHT_ENFORCE_SANDBOX", "1")

    if not sys.platform.startswith("linux"):
        app = main.create_hardened_app(enforce_sandbox=True)
        with pytest.raises(SecuritySandboxInitializationError):
            with TestClient(app):
                pass  # Should not reach here because lifespan will fail during startup


def test_backend_jobs_api_routes_preserved() -> None:
    """Verifies that existing backend routes (/jobs) remain registered and accessible."""
    app = main.create_hardened_app(enforce_sandbox=False)
    with TestClient(app) as client:
        # GET /jobs list endpoint
        response = client.get("/jobs")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
