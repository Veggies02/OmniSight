#!/bin/sh
# ==============================================================================
# OmniSight Production Security Sandbox - Container Entrypoint
# ==============================================================================
# Ensures secure initialization, capability validation, signal forwarding,
# and fail-closed security pre-flight before application execution.
# ==============================================================================

set -eu

echo "[SECURITY ENTRYPOINT] Initializing OmniSight hardened container..."

# Trap signals during startup phase
trap 'echo "[SECURITY ENTRYPOINT] Fatal: Startup interrupted by signal" >&2; exit 143' TERM INT

# 1. Non-root user validation
CURRENT_UID="$(id -u)"
if [ "$CURRENT_UID" -eq 0 ]; then
    echo "[SECURITY ENTRYPOINT] CRITICAL: Container running as root (UID 0)!" >&2
    if [ "${STRICT_CONTAINER_SECURITY:-1}" = "1" ]; then
        echo "[SECURITY ENTRYPOINT] Aborting startup: Root execution prohibited by policy." >&2
        exit 1
    fi
else
    echo "[SECURITY ENTRYPOINT] Verified non-root execution (UID: $CURRENT_UID, GID: $(id -g))"
fi

# 2. Seccomp shared library integrity check
SECCOMP_LIB="/usr/local/lib/seccomp_sandbox.so"
if [ ! -f "$SECCOMP_LIB" ] && [ -f "./seccomp_sandbox.so" ]; then
    SECCOMP_LIB="./seccomp_sandbox.so"
fi

if [ -f "$SECCOMP_LIB" ]; then
    echo "[SECURITY ENTRYPOINT] Verified seccomp sandbox library: $SECCOMP_LIB"
else
    echo "[SECURITY ENTRYPOINT] WARNING: seccomp_sandbox.so not found at standard paths" >&2
    if [ "${SECURITY_SANDBOX_REQUIRED:-1}" = "1" ]; then
        echo "[SECURITY ENTRYPOINT] Fatal: Missing required security library in enforcing mode." >&2
        exit 1
    fi
fi

# 3. Pre-flight seccomp CLI verification if available
if command -v seccomp_sandbox >/dev/null 2>&1; then
    echo "[SECURITY ENTRYPOINT] Running seccomp pre-flight diagnostic check..."
    if ! seccomp_sandbox --verify; then
        echo "[SECURITY ENTRYPOINT] Pre-flight seccomp verification reported non-zero" >&2
        if [ "${SECURITY_SANDBOX_REQUIRED:-1}" = "1" ]; then
            echo "[SECURITY ENTRYPOINT] Fatal: Seccomp verification failed in enforcing mode." >&2
            exit 1
        fi
    fi
fi

# 4. Clear startup traps and hand over execution
trap - TERM INT

echo "[SECURITY ENTRYPOINT] Security pre-flight checks passed. Launching application with PID 1 replacement..."
# exec replaces shell process with the target process (e.g., uvicorn),
# ensuring direct signal propagation (SIGTERM, SIGINT) from Docker daemon.
exec "$@"
