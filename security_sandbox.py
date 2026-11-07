"""OmniSight Production Security Sandbox - Python Integration & Enforcement Module.

Implements Milestone M1: Decoupling OS-level seccomp enforcement from the FastAPI
web application process while preserving seccomp-BPF capabilities, strict enforcement
configuration, and explicit status separation for future dedicated execution workers.

Key Architectural Principles (M1):
1. FastAPI Web Process: Unrestricted by seccomp filters to ensure uninterrupted
   subprocess dispatch for Playwright browser automation and Git worktree pipelines.
2. Worker Security Profile: Seccomp-BPF implementation preserved for execution workers,
   with strict fail-closed enforcement when mandatory protection is configured.
3. Explicit Status Separation: Distinct reporting for API process vs. worker execution
   security without claiming unverified worker isolation.
"""

from __future__ import annotations

import ctypes
import logging
import os
import platform
import subprocess
import sys
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("omnisight.security.sandbox")


class SecuritySandboxError(Exception):
    """Base exception for all security sandbox errors."""


class SecuritySandboxInitializationError(SecuritySandboxError):
    """Raised when the security sandbox fails to initialize in an enforcing environment."""


class SecuritySandboxViolationError(SecuritySandboxError):
    """Raised when an unauthorized or blocked operation occurs within the sandbox."""


class SecurityConfigurationError(SecuritySandboxError):
    """Raised when sandbox security parameters or environment flags are invalid."""


class SandboxStatus(str, Enum):
    """Possible runtime states of the security sandbox."""

    ACTIVE = "active"
    READY = "ready"
    DISABLED = "disabled"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"


# Internal state tracker with distinct API and Worker security profiles
_SANDBOX_STATE: Dict[str, Any] = {
    # Top-level backward-compatible keys
    "status": SandboxStatus.DISABLED.value,
    "platform": sys.platform,
    "is_linux": sys.platform.startswith("linux"),
    "kernel_supported": False,
    "initialized": False,
    "enforced": False,
    "message": "Not initialized",
    "blocked_syscalls": 27,
    "allowed_syscalls": 85,
    "policy_version": "1.1.0-decoupled",
    # M1 Decoupled Architecture Profiles
    "api_process": {
        "role": "web_api_gateway",
        "seccomp_applied": False,  # Decoupled to allow subprocess dispatch
        "subprocess_dispatch_ready": True,
        "status": "uninitialized",
    },
    "worker_security": {
        "role": "execution_worker",
        "seccomp_available": False,
        "enforcement_required": False,
        "isolation_model": "in_process_decoupled",
        "worker_isolation_verified": False,  # Honest status: dedicated service pending M3
        "worker_service_status": "pending_m3_worker_service",
        "blocked_syscalls": 27,
        "allowed_syscalls": 85,
    },
}

_C_LIB: Optional[ctypes.CDLL] = None


def _find_or_build_library() -> Optional[Path]:
    """Locates the compiled seccomp_sandbox.so library or compiles it if C compiler exists."""
    search_paths = [
        Path("/usr/local/lib/seccomp_sandbox.so"),
        Path(__file__).resolve().parent / "seccomp_sandbox.so",
        Path.cwd() / "seccomp_sandbox.so",
        Path("/app/seccomp_sandbox.so"),
    ]

    for p in search_paths:
        if p.exists() and p.is_file():
            return p

    # Attempt on-the-fly compilation if source file is present
    src_candidates = [
        Path(__file__).resolve().parent / "seccomp_sandbox.c",
        Path.cwd() / "seccomp_sandbox.c",
        Path("/app/seccomp_sandbox.c"),
    ]
    src_file = next((f for f in src_candidates if f.exists()), None)
    if src_file:
        out_so = src_file.parent / "seccomp_sandbox.so"
        compiler = "gcc" if sys.platform.startswith("linux") else "cc"
        try:
            cmd = [compiler, "-shared", "-fPIC", "-O2", str(src_file), "-o", str(out_so)]
            logger.debug("Compiling seccomp_sandbox: %s", " ".join(cmd))
            subprocess.run(cmd, check=True, capture_output=True)
            if out_so.exists():
                return out_so
        except Exception as exc:  # noqa: BLE001
            logger.debug("Failed on-the-fly compile of seccomp_sandbox.c: %s", exc)

    return None


def _get_c_bindings() -> Optional[ctypes.CDLL]:
    """Loads and sets up C library bindings for seccomp functionality."""
    global _C_LIB
    if _C_LIB is not None:
        return _C_LIB

    lib_path = _find_or_build_library()
    if not lib_path:
        return None

    try:
        cdll = ctypes.CDLL(str(lib_path))

        cdll.is_seccomp_supported.argtypes = []
        cdll.is_seccomp_supported.restype = ctypes.c_int

        cdll.init_seccomp_sandbox.argtypes = []
        cdll.init_seccomp_sandbox.restype = ctypes.c_int

        cdll.get_sandbox_state.argtypes = []
        cdll.get_sandbox_state.restype = ctypes.c_int

        cdll.get_sandbox_status_msg.argtypes = []
        cdll.get_sandbox_status_msg.restype = ctypes.c_char_p

        cdll.get_blocked_syscall_count.argtypes = []
        cdll.get_blocked_syscall_count.restype = ctypes.c_int

        cdll.get_allowed_syscall_count.argtypes = []
        cdll.get_allowed_syscall_count.restype = ctypes.c_int

        cdll.trigger_test_blocked_syscall.argtypes = []
        cdll.trigger_test_blocked_syscall.restype = ctypes.c_int

        _C_LIB = cdll
        return _C_LIB
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to bind seccomp_sandbox shared library: %s", exc)
        return None


def is_enforcement_required() -> bool:
    """Evaluates whether strict security sandbox enforcement is configured."""
    enforce_env = os.environ.get("OMNISIGHT_ENFORCE_SANDBOX", "").strip().lower()
    enforce_worker = os.environ.get("OMNISIGHT_ENFORCE_WORKER_SANDBOX", "").strip().lower()
    security_req = os.environ.get("SECURITY_SANDBOX_REQUIRED", "").strip().lower()
    return (
        enforce_env in ("1", "true", "yes", "on")
        or enforce_worker in ("1", "true", "yes", "on")
        or security_req in ("1", "true", "yes", "on")
    )


def initialize_api_security(enforce_worker_readiness: Optional[bool] = None) -> Dict[str, Any]:
    """Initializes the FastAPI application security context (Milestone M1).

    Decouples the web API process from restrictive seccomp filters so that
    subprocess execution (Playwright, Git, builds) is not blocked by inherited
    kernel filter rules.

    Validates worker security readiness: if enforcement is mandatory, verifies
    that the worker seccomp capability is present on the host or fails closed.
    """
    global _SANDBOX_STATE

    if enforce_worker_readiness is None:
        enforce_worker_readiness = is_enforcement_required()

    is_linux = sys.platform.startswith("linux")
    _SANDBOX_STATE["is_linux"] = is_linux
    _SANDBOX_STATE["platform"] = sys.platform
    _SANDBOX_STATE["enforced"] = enforce_worker_readiness

    logger.info(
        "[API-SECURITY] Initializing decoupled API security context (platform=%s, enforce_worker=%s)",
        sys.platform,
        enforce_worker_readiness,
    )

    bindings = _get_c_bindings()
    kernel_supported = bool(bindings.is_seccomp_supported()) if bindings else False
    blocked_count = bindings.get_blocked_syscall_count() if bindings else 27
    allowed_count = bindings.get_allowed_syscall_count() if bindings else 85

    _SANDBOX_STATE["kernel_supported"] = kernel_supported
    _SANDBOX_STATE["blocked_syscalls"] = blocked_count
    _SANDBOX_STATE["allowed_syscalls"] = allowed_count

    # Update API process profile: Explicitly UNRESTRICTED by seccomp
    _SANDBOX_STATE["api_process"] = {
        "role": "web_api_gateway",
        "seccomp_applied": False,  # M1 Decoupling: API does not inherit restrictive seccomp
        "subprocess_dispatch_ready": True,
        "status": "ready",
    }

    # Update Worker security profile
    _SANDBOX_STATE["worker_security"] = {
        "role": "execution_worker",
        "seccomp_available": is_linux and kernel_supported,
        "enforcement_required": enforce_worker_readiness,
        "isolation_model": "in_process_decoupled",
        "worker_isolation_verified": False,
        "worker_service_status": "pending_m3_worker_service",
        "blocked_syscalls": blocked_count,
        "allowed_syscalls": allowed_count,
    }

    # Evaluate worker readiness under strict enforcement
    allow_dev_bypass = os.environ.get("OMNISIGHT_ALLOW_DEV_SANDBOX_BYPASS", "").lower() in (
        "1",
        "true",
        "yes",
    )

    if enforce_worker_readiness:
        if not bindings:
            msg = "Worker seccomp C library could not be loaded or compiled"
            _SANDBOX_STATE["status"] = SandboxStatus.FAILED.value
            _SANDBOX_STATE["message"] = msg
            logger.critical("[API-SECURITY] Fatal: %s", msg)
            raise SecuritySandboxInitializationError(msg)

        if not is_linux or not kernel_supported:
            msg = (
                f"Worker seccomp protection mandatory, but host kernel ({platform.system()} "
                f"{platform.release()}) lacks Linux seccomp-BPF support"
            )
            _SANDBOX_STATE["status"] = SandboxStatus.UNSUPPORTED.value
            _SANDBOX_STATE["message"] = msg
            if not allow_dev_bypass:
                logger.critical("[API-SECURITY] %s", msg)
                raise SecuritySandboxInitializationError(msg)
            logger.warning("[API-SECURITY] %s (continuing via developer bypass)", msg)
            _SANDBOX_STATE["initialized"] = True
            return dict(_SANDBOX_STATE)

    # Clean readiness state
    _SANDBOX_STATE["initialized"] = True
    _SANDBOX_STATE["status"] = (
        SandboxStatus.READY.value if (is_linux and kernel_supported) else SandboxStatus.UNSUPPORTED.value
    )
    _SANDBOX_STATE["message"] = (
        "API process decoupled from seccomp; worker execution seccomp ready"
        if (is_linux and kernel_supported)
        else f"API process ready; host ({platform.system()}) does not support Linux seccomp"
    )

    logger.info("[API-SECURITY] %s", _SANDBOX_STATE["message"])
    return dict(_SANDBOX_STATE)


def initialize_worker_security_sandbox(enforce: Optional[bool] = None) -> Dict[str, Any]:
    """Installs the OS-level Linux seccomp filter on the CURRENT executing process.

    This function is designated for dedicated execution workers (Playwright, Git,
    repair tasks) to enforce least-privilege system call restrictions.

    It MUST NOT be invoked on the main FastAPI web server process.
    """
    global _SANDBOX_STATE

    if enforce is None:
        enforce = is_enforcement_required()

    is_linux = sys.platform.startswith("linux")
    bindings = _get_c_bindings()

    if not bindings:
        msg = "Worker seccomp C library could not be loaded or compiled"
        if enforce:
            raise SecuritySandboxInitializationError(msg)
        return {"status": SandboxStatus.FAILED.value, "message": msg}

    if not is_linux or not bindings.is_seccomp_supported():
        msg = f"Host kernel ({platform.system()}) does not support Linux seccomp"
        allow_dev_bypass = os.environ.get("OMNISIGHT_ALLOW_DEV_SANDBOX_BYPASS", "").lower() in (
            "1",
            "true",
            "yes",
        )
        if enforce and not allow_dev_bypass:
            raise SecuritySandboxInitializationError(msg)
        return {"status": SandboxStatus.UNSUPPORTED.value, "message": msg}

    # Install seccomp filter in the worker process
    rc = bindings.init_seccomp_sandbox()
    status_msg = bindings.get_sandbox_status_msg().decode("utf-8", errors="replace")

    if rc == 0:
        logger.info("[WORKER-SECURITY] Seccomp filter installed successfully in worker process")
        return {
            "status": SandboxStatus.ACTIVE.value,
            "message": status_msg,
            "seccomp_applied": True,
        }

    err_msg = f"Worker seccomp installation failed ({rc}): {status_msg}"
    if enforce:
        raise SecuritySandboxInitializationError(err_msg)
    return {"status": SandboxStatus.FAILED.value, "message": err_msg}


def initialize_security_sandbox(
    enforce: Optional[bool] = None, scope: str = "api"
) -> Dict[str, Any]:
    """Universal sandbox initialization entrypoint.

    Args:
        enforce: Explicit enforcement boolean override.
        scope: "api" (default, decoupled API context) or "worker" (enforces filter on process).

    Returns:
        Sandbox diagnostic dictionary.
    """
    if scope == "worker":
        return initialize_worker_security_sandbox(enforce=enforce)
    return initialize_api_security(enforce_worker_readiness=enforce)


def get_sandbox_status() -> Dict[str, Any]:
    """Returns a copy of the current security state and diagnostic information."""
    return dict(_SANDBOX_STATE)


def verify_sandbox_active() -> bool:
    """Returns True if worker seccomp capability is ready or active."""
    worker_sec = _SANDBOX_STATE.get("worker_security", {})
    return bool(worker_sec.get("seccomp_available")) or _SANDBOX_STATE.get("status") in (
        SandboxStatus.READY.value,
        SandboxStatus.ACTIVE.value,
    )


def test_restricted_syscall() -> int:
    """Triggers a restricted system call to verify that seccomp traps or denies it."""
    bindings = _get_c_bindings()
    if not bindings:
        return -1
    return bindings.trigger_test_blocked_syscall()
