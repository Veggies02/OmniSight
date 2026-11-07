# ==============================================================================
# OmniSight Production Hardened Security Container
# Multi-stage build enforcing non-root execution and seccomp-BPF least-privilege
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Builder - Compile seccomp C sandbox shared library and CLI helper
# ------------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS builder

WORKDIR /build

# Install compilation toolchain and libseccomp development headers
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    libseccomp-dev \
    make \
    && rm -rf /var/lib/apt/lists/*

COPY seccomp_sandbox.c /build/

# Compile shared library with compiler hardening flags
RUN gcc -shared -fPIC -O2 -Wall \
    -fstack-protector-strong \
    -D_FORTIFY_SOURCE=2 \
    -Wformat -Werror=format-security \
    seccomp_sandbox.c -o /build/seccomp_sandbox.so -lseccomp

# Compile standalone CLI tool for pre-flight verification
RUN gcc -O2 -Wall \
    -fstack-protector-strong \
    -D_FORTIFY_SOURCE=2 \
    -DSECCOMP_STANDALONE \
    seccomp_sandbox.c -o /build/seccomp_sandbox -lseccomp

# ------------------------------------------------------------------------------
# Stage 2: Runtime - Minimal, unprivileged runtime environment
# ------------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS runtime

# Security environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMNISIGHT_ENFORCE_SANDBOX=1 \
    SECURITY_SANDBOX_REQUIRED=1 \
    PORT=8000

# Install runtime libseccomp library only (no compiler/build tools in runtime image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libseccomp2 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create unprivileged system group and user (UID 10001, GID 10001)
RUN groupadd -g 10001 -r omnisight && \
    useradd -u 10001 -r -g omnisight -s /sbin/nologin -d /app -M omnisight

# Install compiled seccomp shared library and verification helper from builder
COPY --from=builder /build/seccomp_sandbox.so /usr/local/lib/seccomp_sandbox.so
COPY --from=builder /build/seccomp_sandbox /usr/local/bin/seccomp_sandbox
RUN chmod 0644 /usr/local/lib/seccomp_sandbox.so && \
    chmod 0755 /usr/local/bin/seccomp_sandbox && \
    ldconfig

WORKDIR /app

# Install Python production dependencies
COPY artifacts/integration-backend/backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy entrypoint script and configure permissions
COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

# Copy application source code and set ownership
COPY . /app/
RUN chown -R omnisight:omnisight /app

# Switch to unprivileged user
USER omnisight:omnisight

# Expose backend service port
EXPOSE 8000

# Health check using non-root probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

# Launch through hardened entrypoint with PID 1 signal forwarding
ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
