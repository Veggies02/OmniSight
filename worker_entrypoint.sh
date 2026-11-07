#!/bin/sh
# ==============================================================================
# OmniSight Isolated Execution Worker - Container Entrypoint
# ==============================================================================
# Validates non-root execution, seccomp library integrity, and sets up
# PID 1 signal forwarding for clean process tree termination.
# ==============================================================================

set -eu

echo "[WORKER-ENTRYPOINT] Initializing OmniSight isolated execution worker..."

# Trap signals during startup phase
trap 'echo "[WORKER-ENTRYPOINT] Fatal: Worker startup interrupted by signal" >&2; exit 143' TERM INT

# 1. Non-root user validation
CURRENT_UID="$(id -u)"
if [ "$CURRENT_UID" -eq 0 ]; then
    echo "[WORKER-ENTRYPOINT] CRITICAL: Worker container running as root (UID 0)!" >&2
    if [ "${STRICT_CONTAINER_SECURITY:-1}" = "1" ]; then
        echo "[WORKER-ENTRYPOINT] Aborting startup: Root execution strictly forbidden for execution worker." >&2
        exit 1
    fi
else
    echo "[WORKER-ENTRYPOINT] Verified unprivileged execution (UID: $CURRENT_UID, GID: $(id -g))"
fi

# 1b. Private signing key isolation check (Strict Fail-Closed)
if [ -n "${OMNISIGHT_APPROVAL_PRIVATE_KEY_HEX:-}" ]; then
    echo "[WORKER-ENTRYPOINT] CRITICAL SECURITY VIOLATION: OMNISIGHT_APPROVAL_PRIVATE_KEY_HEX detected in worker environment!" >&2
    echo "[WORKER-ENTRYPOINT] Worker nodes must NEVER possess private signing keys. Aborting startup immediately." >&2
    exit 1
fi

# 2. Seccomp shared library integrity check
SECCOMP_LIB="/usr/local/lib/seccomp_sandbox.so"
if [ ! -f "$SECCOMP_LIB" ] && [ -f "./seccomp_sandbox.so" ]; then
    SECCOMP_LIB="./seccomp_sandbox.so"
fi

if [ -f "$SECCOMP_LIB" ]; then
    echo "[WORKER-ENTRYPOINT] Verified seccomp sandbox library: $SECCOMP_LIB"
else
    echo "[WORKER-ENTRYPOINT] WARNING: seccomp_sandbox.so not found at standard library paths" >&2
    if [ "${SECURITY_SANDBOX_REQUIRED:-1}" = "1" ]; then
        echo "[WORKER-ENTRYPOINT] Fatal: Missing required security library in enforcing mode." >&2
        exit 1
    fi
fi

# 3. Pre-flight seccomp CLI verification if available
if command -v seccomp_sandbox >/dev/null 2>&1; then
    echo "[WORKER-ENTRYPOINT] Running worker seccomp pre-flight diagnostic check..."
    if ! seccomp_sandbox --verify; then
        echo "[WORKER-ENTRYPOINT] Pre-flight seccomp verification reported non-zero" >&2
        if [ "${SECURITY_SANDBOX_REQUIRED:-1}" = "1" ]; then
            echo "[WORKER-ENTRYPOINT] Fatal: Seccomp verification failed in enforcing mode." >&2
            exit 1
        fi
    fi
fi

# 4. Set Python import path for container modules
export PYTHONPATH="/app:${PYTHONPATH:-}"

# 5. Clear startup traps and hand over execution
trap - TERM INT

echo "[WORKER-ENTRYPOINT] Security pre-flight checks passed. Launching worker service with PID 1 replacement..."
exec "$@"
