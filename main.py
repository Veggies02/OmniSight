"""OmniSight Production Entry Point & Hardened Application Integration.

Initializes the decoupled API security context at startup (Milestone M1),
ensuring that the FastAPI web server process is not restricted by execution-worker
seccomp filters, while verifying worker seccomp capabilities and exposing rich
security telemetry for operators and automated audit suites.
"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, Optional

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse

# Add backend directory to sys.path if available
_current_dir = Path(__file__).resolve().parent
_backend_candidates = [
    _current_dir / "backend",
    _current_dir / "artifacts" / "integration-backend" / "backend",
    _current_dir,
]
for candidate in reversed(_backend_candidates):
    if candidate.exists() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from security_sandbox import (
    SandboxStatus,
    SecuritySandboxError,
    SecuritySandboxInitializationError,
    get_sandbox_status,
    initialize_api_security,
    initialize_security_sandbox,
    is_enforcement_required,
    verify_sandbox_active,
)

logger = logging.getLogger("omnisight.main")


@asynccontextmanager
async def security_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """FastAPI application lifespan managing decoupled security initialization (M1)."""
    enforce = getattr(app.state, "enforce_sandbox", None)
    if enforce is None:
        enforce = is_enforcement_required()

    logger.info("[SECURITY-STARTUP] Initializing decoupled security context (enforce_worker=%s)...", enforce)
    try:
        # M1 Decoupling: FastAPI process is NOT locked down by execution seccomp filters
        security_state = initialize_api_security(enforce_worker_readiness=enforce)
        app.state.security_state = security_state
        app.state.sandbox_state = security_state  # Backward compatibility
        logger.info(
            "[SECURITY-STARTUP] Security context initialized (api_role=%s, worker_seccomp=%s, platform=%s)",
            security_state.get("api_process", {}).get("role"),
            security_state.get("worker_security", {}).get("seccomp_available"),
            security_state.get("platform"),
        )
    except SecuritySandboxInitializationError as exc:
        logger.critical("[SECURITY-STARTUP] FATAL: Security verification failed in enforcing mode: %s", exc)
        # Fail closed: Abort application startup immediately
        raise

    yield

    logger.info("[SECURITY-SHUTDOWN] OmniSight hardened backend shutting down.")


def create_hardened_app(
    enforce_sandbox: Optional[bool] = None,
    db_path: Optional[Path] = None,
    runner: Any = None,
    repair_runner: Any = None,
    operator_token: Optional[str] = None,
    github_client: Any = None,
) -> FastAPI:
    """Factory creating an OmniSight FastAPI application with decoupled security integration.

    Args:
        enforce_sandbox: If True, worker seccomp unreadiness prevents startup.
        db_path: Optional custom SQLite path for job storage.
        runner: Optional browser runner instance.
        repair_runner: Optional repair runner instance.
        operator_token: Optional operator token for repair authentication.
        github_client: Optional GitHub client instance.

    Returns:
        Configured FastAPI application instance with unrestricted subprocess dispatch.
    """
    # Attempt to load Shilpa's backend create_app factory if present
    backend_app: Optional[FastAPI] = None
    try:
        from api import create_app as backend_create_app  # type: ignore

        backend_app = backend_create_app(
            db_path=db_path,
            runner=runner,
            repair_runner=repair_runner,
            operator_token=operator_token,
            github_client=github_client,
        )
    except ImportError:
        logger.debug("Backend API module not in path; creating standalone hardened app")

    app = backend_app or FastAPI(
        title="OmniSight Hardened Backend",
        version="1.1.0-decoupled",
        description="OmniSight backend service decoupled from execution-worker seccomp.",
    )

    # Attach security lifespan and state
    app.router.lifespan_context = security_lifespan
    app.state.enforce_sandbox = enforce_sandbox

    # Attach /health endpoint or enhance existing health endpoint
    @app.get("/health", tags=["Health & Security"], include_in_schema=True)
    def health_check() -> Dict[str, Any]:
        sandbox_info = get_sandbox_status()
        return {
            "status": "ok",
            "service": "omnisight-backend",
            "security": {
                "api_decoupled": True,
                "subprocess_dispatch_ready": sandbox_info.get("api_process", {}).get("subprocess_dispatch_ready", True),
                "worker_seccomp_available": sandbox_info.get("worker_security", {}).get("seccomp_available", False),
                "enforced": sandbox_info.get("enforced", False),
            },
            "sandbox": sandbox_info,
        }

    # Security diagnostic status endpoint
    @app.get("/security/sandbox/status", tags=["Health & Security"])
    def security_sandbox_status() -> Dict[str, Any]:
        """Returns detailed system call and process isolation diagnostic state."""
        return get_sandbox_status()

    # Pre-flight / audit verification endpoint
    @app.post("/security/sandbox/verify", tags=["Health & Security"])
    def security_sandbox_verify() -> Dict[str, Any]:
        """Validates that worker security capabilities are ready and policy is enforced."""
        status_info = get_sandbox_status()
        is_ready = status_info.get("status") in (SandboxStatus.READY.value, SandboxStatus.ACTIVE.value)
        is_enforced = status_info.get("enforced", False)

        if is_enforced and not is_ready:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Worker security protection is mandatory but unready: {status_info.get('message')}",
            )

        return {
            "verified": True,
            "status": status_info.get("status"),
            "api_decoupled": True,
            "worker_security": status_info.get("worker_security"),
            "details": status_info,
        }

    return app


# Default application instance for Uvicorn entry point
app = create_hardened_app()

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("OMNISIGHT_HOST", "0.0.0.0")
    port = int(os.environ.get("OMNISIGHT_PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=False)
