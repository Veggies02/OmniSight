"""OmniSight Production Security Sandbox - Python Integration & Enforcement Module.

Binds to OS-level Linux seccomp-BPF filters via ctypes, providing:
- Fail-closed security initialization in production environments.
- Principle of least-privilege enforcement.
- Granular diagnostic status and audit reporting.
- Graceful non-Linux platform detection for local development workflows.
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
    DISABLED = "disabled"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"


# Internal state tracker
_SANDBOX_STATE: Dict[str, Any] = {
    "status": SandboxStatus.DISABLED.value,
    "platform": sys.platform,
    "is_linux": sys.platform.startswith("linux"),
    "kernel_supported": False,
    "initialized": False,
    "enforced": False,
    "message": "Not initialized",
    "blocked_syscalls": 27,
    "allowed_syscalls": 85,
    "policy_version": "1.0.0-hardened",
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
    """Loads and sets up C library bindings."""
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
    """Evaluates whether strict security sandbox enforcement is required by configuration."""
    enforce_env = os.environ.get("OMNISIGHT_ENFORCE_SANDBOX", "").strip().lower()
    security_req = os.environ.get("SECURITY_SANDBOX_REQUIRED", "").strip().lower()
    return enforce_env in ("1", "true", "yes", "on") or security_req in ("1", "true", "yes", "on")


def initialize_security_sandbox(enforce: Optional[bool] = None) -> Dict[str, Any]:
    """Initializes and activates the OS-level security sandbox.

    Args:
        enforce: Explicit enforcement boolean override. If None, checks environment variables.

    Returns:
        Dict containing current sandbox diagnostic state and metadata.

    Raises:
        SecuritySandboxInitializationError: If enforcement is required but the sandbox
            fails to initialize or is unsupported on the host kernel.
    """
    global _SANDBOX_STATE

    if enforce is None:
        enforce = is_enforcement_required()

    _SANDBOX_STATE["enforced"] = enforce
    is_linux = sys.platform.startswith("linux")
    _SANDBOX_STATE["is_linux"] = is_linux

    logger.info(
        "[SECURITY-SANDBOX] Initializing sandbox (platform=%s, enforce=%s)",
        sys.platform,
        enforce,
    )

    bindings = _get_c_bindings()
    if not bindings:
        msg = "Seccomp C library could not be loaded or compiled"
        _SANDBOX_STATE["status"] = SandboxStatus.FAILED.value
        _SANDBOX_STATE["message"] = msg
        if enforce:
            logger.critical("[SECURITY-SANDBOX] Fatal initialization failure: %s", msg)
            raise SecuritySandboxInitializationError(msg)
        logger.warning("[SECURITY-SANDBOX] %s; continuing in permissive development mode", msg)
        return dict(_SANDBOX_STATE)

    supported = bool(bindings.is_seccomp_supported())
    _SANDBOX_STATE["kernel_supported"] = supported
    _SANDBOX_STATE["blocked_syscalls"] = bindings.get_blocked_syscall_count()
    _SANDBOX_STATE["allowed_syscalls"] = bindings.get_allowed_syscall_count()

    if not is_linux or not supported:
        msg = f"Host kernel/OS ({platform.system()} {platform.release()}) does not support Linux seccomp-BPF"
        _SANDBOX_STATE["status"] = SandboxStatus.UNSUPPORTED.value
        _SANDBOX_STATE["message"] = msg

        # Check if dev bypass is explicitly allowed
        allow_dev_bypass = os.environ.get("OMNISIGHT_ALLOW_DEV_SANDBOX_BYPASS", "").lower() in (
            "1",
            "true",
            "yes",
        )

        if enforce and not allow_dev_bypass:
            logger.critical("[SECURITY-SANDBOX] Enforced environment lacks seccomp support: %s", msg)
            raise SecuritySandboxInitializationError(msg)

        logger.warning("[SECURITY-SANDBOX] %s. Running in permissive mode.", msg)
        return dict(_SANDBOX_STATE)

    # Linux kernel with seccomp support: Install the filter
    rc = bindings.init_seccomp_sandbox()
    status_msg = bindings.get_sandbox_status_msg().decode("utf-8", errors="replace")
    _SANDBOX_STATE["message"] = status_msg

    if rc == 0:
        _SANDBOX_STATE["status"] = SandboxStatus.ACTIVE.value
        _SANDBOX_STATE["initialized"] = True
        logger.info(
            "[SECURITY-SANDBOX] Successfully applied seccomp-BPF filter (whitelisted=%d, blocked=%d)",
            _SANDBOX_STATE["allowed_syscalls"],
            _SANDBOX_STATE["blocked_syscalls"],
        )
    else:
        _SANDBOX_STATE["status"] = SandboxStatus.FAILED.value
        _SANDBOX_STATE["initialized"] = False
        err_msg = f"Seccomp initialization failed with code {rc}: {status_msg}"
        if enforce:
            logger.critical("[SECURITY-SANDBOX] %s", err_msg)
            raise SecuritySandboxInitializationError(err_msg)
        logger.error("[SECURITY-SANDBOX] %s", err_msg)

    return dict(_SANDBOX_STATE)


def get_sandbox_status() -> Dict[str, Any]:
    """Returns a copy of the current sandbox status and diagnostic information."""
    return dict(_SANDBOX_STATE)


def verify_sandbox_active() -> bool:
    """Returns True if the sandbox is active and enforcing."""
    return _SANDBOX_STATE.get("status") == SandboxStatus.ACTIVE.value


def test_restricted_syscall() -> int:
    """Triggers a restricted system call to verify that the sandbox traps or denies it."""
    bindings = _get_c_bindings()
    if not bindings:
        return -1
    return bindings.trigger_test_blocked_syscall()
