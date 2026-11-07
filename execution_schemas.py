"""OmniSight Inter-Service Execution Payload Contracts.

Milestone M2: Formal schemas for asynchronous execution task submission,
status tracking, result reporting, error propagation, and webhook events.

Enforces:
- Strict field validation and type safety using Pydantic v2.
- Elimination of unrestricted filesystem paths, shell injection vectors, and secrets.
- Deterministic correlation IDs and idempotency tokens for distributed execution.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator


class TaskOperationType(str, Enum):
    """Supported execution task operations."""

    CAPTURE_EVIDENCE = "capture_evidence"
    EXECUTE_REPAIR = "execute_repair"
    VERIFY_REPAIR = "verify_repair"


class TaskExecutionStatus(str, Enum):
    """Lifecycle status of an execution task."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    REJECTED = "rejected"
    UNSUPPORTED = "unsupported"
    CANCELLED = "cancelled"


class RunnerMode(str, Enum):
    """Underlying runner execution adapter mode."""

    LOCAL_CLI = "local_cli"
    WORKER_SERVICE = "worker_service"


# Safe identifier regex: alphanumeric, hyphens, underscores (1 to 100 characters)
_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_BRANCH_PATTERN = re.compile(r"^[A-Za-z0-9_./-]{1,150}$")
_SHA256_PATTERN = re.compile(r"^[a-fA-F0-9]{64}$")


class ApprovedProposalRef(BaseModel):
    """Cryptographically pinned reference to an approved repair proposal."""

    proposal_id: str = Field(min_length=1, max_length=100)
    scenario_id: Optional[str] = Field(default=None, max_length=100)
    defect_category: str = Field(min_length=1, max_length=100)
    source_file: str = Field(min_length=1, max_length=255, description="Relative path in repo")
    source_file_sha256: str = Field(min_length=64, max_length=64, description="64-char hex SHA-256")
    reviewed_by: str = Field(min_length=1, max_length=200)
    reviewed_at: str = Field(min_length=1, max_length=64, description="ISO 8601 timestamp")
    patch_id: Optional[str] = Field(default=None, max_length=100)
    patch_digest_sha256: Optional[str] = Field(default=None, max_length=64, description="64-char hex SHA-256")
    expires_at: Optional[str] = Field(default=None, max_length=64, description="ISO 8601 UTC timestamp")
    approval_nonce: Optional[str] = Field(default=None, max_length=128, description="Anti-replay nonce")
    signer_key_id: Optional[str] = Field(default=None, max_length=100, description="Authoritative signing key ID")
    signature: Optional[str] = Field(default=None, max_length=256, description="Hex-encoded Ed25519 digital signature")

    @field_validator("source_file")
    @classmethod
    def validate_source_path(cls, v: str) -> str:
        trimmed = v.strip().replace("\\", "/")
        if ".." in trimmed or trimmed.startswith("/") or trimmed.startswith("./"):
            raise ValueError(f"Path traversal or absolute path forbidden in source_file: {v!r}")
        return trimmed

    @field_validator("source_file_sha256")
    @classmethod
    def validate_hash(cls, v: str) -> str:
        if not _SHA256_PATTERN.fullmatch(v):
            raise ValueError(f"Invalid SHA-256 hash: {v!r}")
        return v.lower()

    @field_validator("patch_digest_sha256")
    @classmethod
    def validate_patch_digest(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _SHA256_PATTERN.fullmatch(v):
            raise ValueError(f"Invalid patch digest SHA-256: {v!r}")
        return v.lower() if v is not None else None


class WorktreeRef(BaseModel):
    """Specification for isolated Git worktree execution."""

    branch: str = Field(min_length=1, max_length=150)
    base_commit: str = Field(default="HEAD", min_length=1, max_length=100)
    relative_worktree_path: Optional[str] = Field(default=None, max_length=255)

    @field_validator("branch")
    @classmethod
    def validate_branch(cls, v: str) -> str:
        if not _BRANCH_PATTERN.fullmatch(v) or ".." in v or v.startswith("-"):
            raise ValueError(f"Invalid or unsafe branch name: {v!r}")
        return v

    @field_validator("base_commit")
    @classmethod
    def validate_base_commit(cls, v: str) -> str:
        if " " in v or ";" in v or "&" in v or v.startswith("-"):
            raise ValueError(f"Unsafe base_commit reference: {v!r}")
        return v


class ArtifactItem(BaseModel):
    """Metadata reference for an execution artifact."""

    artifact_id: str = Field(min_length=1, max_length=100)
    kind: str = Field(min_length=1, max_length=50)  # screenshot, dom_snapshot, report, metrics, other
    relative_uri: str = Field(min_length=1, max_length=500)
    description: str = Field(min_length=1, max_length=500)
    size_bytes: Optional[int] = None
    sha256: Optional[str] = None

    @field_validator("relative_uri")
    @classmethod
    def validate_uri(cls, v: str) -> str:
        if ".." in v:
            raise ValueError(f"Path traversal forbidden in artifact relative_uri: {v!r}")
        return v


class ExecutionResult(BaseModel):
    """Detailed outcome of a completed execution task."""

    passed: bool
    final_state: str = Field(description="PASSED, FAILED, REJECTED, or UNSUPPORTED")
    exit_code: int = Field(ge=0, le=255)
    message: str = Field(max_length=2000)
    artifacts: List[ArtifactItem] = Field(default_factory=list)
    build_passed: Optional[bool] = None
    test_passed: Optional[bool] = None
    visual_passed: Optional[bool] = None
    commit_sha: Optional[str] = None
    branch: Optional[str] = None
    duration_seconds: float = Field(ge=0.0)
    stdout_tail: Optional[str] = Field(default=None, max_length=4000)
    stderr_tail: Optional[str] = Field(default=None, max_length=4000)


class ExecutionError(BaseModel):
    """Standardized error payload for execution failures."""

    code: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=2000)
    details: Optional[Dict[str, Any]] = None
    retryable: bool = False


class ExecutionTaskRequest(BaseModel):
    """Dispatched payload for requesting execution on an adapter."""

    schema_version: str = Field(default="1.0.0", pattern=r"^\d+\.\d+\.\d+$")
    task_id: str = Field(min_length=1, max_length=100)
    job_id: str = Field(min_length=1, max_length=100)
    operation: TaskOperationType
    target_url: Optional[str] = Field(default=None, max_length=500)
    proposal_ref: Optional[ApprovedProposalRef] = None
    worktree_ref: Optional[WorktreeRef] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)
    submitted_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    timeout_seconds: float = Field(default=300.0, ge=0.1, le=3600.0)
    correlation_id: str = Field(min_length=1, max_length=100)
    idempotency_key: str = Field(min_length=1, max_length=100)

    @field_validator("job_id", "task_id")
    @classmethod
    def validate_identifier(cls, v: str) -> str:
        if not _ID_PATTERN.fullmatch(v):
            raise ValueError(f"Identifier must be alphanumeric with '-' or '_': {v!r}")
        return v

    @field_validator("target_url")
    @classmethod
    def validate_url(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        parsed = urlparse(v)
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"target_url must have http or https scheme: {v!r}")
        return v


class ExecutionTaskResponse(BaseModel):
    """Immediate acknowledgement returned upon task submission."""

    schema_version: str = "1.0.0"
    task_id: str
    job_id: str
    operation: TaskOperationType
    status: TaskExecutionStatus
    submitted_at: str
    acknowledged_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    runner_mode: RunnerMode
    correlation_id: str
    message: Optional[str] = None


class ExecutionStatusResponse(BaseModel):
    """Current state and diagnostic report for an execution task."""

    schema_version: str = "1.0.0"
    task_id: str
    job_id: str
    operation: TaskOperationType
    status: TaskExecutionStatus
    submitted_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    result: Optional[ExecutionResult] = None
    error: Optional[ExecutionError] = None
    runner_mode: RunnerMode
    correlation_id: str


class StatusWebhookEvent(BaseModel):
    """Asynchronous callback payload delivered upon task state transitions."""

    schema_version: str = "1.0.0"
    event_id: str
    task_id: str
    job_id: str
    event_type: str  # task.started, task.completed, task.failed, task.rejected
    status: TaskExecutionStatus
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    result: Optional[ExecutionResult] = None
    error: Optional[ExecutionError] = None
    signature: Optional[str] = None
