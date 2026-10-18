"""Shared data contracts for the OmniSight backend (Person 3).

Everything the API accepts or returns is defined here so teammates can read one file.
Named job_schemas.py (not schemas.py) so it never collides with ai-engine/schemas.py
when both modules are imported together in Week 2.
"""
from enum import Enum
from typing import Dict, List, Literal, Optional, Set

from pydantic import AliasChoices, AnyHttpUrl, BaseModel, Field


# --------------------------------------------------------------------------- #
# Job lifecycle (state machine)
# --------------------------------------------------------------------------- #
class JobStatus(str, Enum):
    QUEUED = "queued"
    INSPECTING = "inspecting"
    ANALYZING = "analyzing"
    REPAIR_PROPOSED = "repair_proposed"
    APPLYING_PATCH = "applying_patch"
    VALIDATING = "validating"
    PR_CREATED = "pr_created"
    NEEDS_REVIEW = "needs_review"
    COMPLETED = "completed"  # inspection finished, nothing to repair
    FAILED = "failed"


# Which status may follow which. Anything not listed is rejected.
ALLOWED_TRANSITIONS: Dict[JobStatus, Set[JobStatus]] = {
    JobStatus.QUEUED: {JobStatus.INSPECTING, JobStatus.FAILED},
    JobStatus.INSPECTING: {JobStatus.ANALYZING, JobStatus.FAILED},
    JobStatus.ANALYZING: {
        JobStatus.REPAIR_PROPOSED,
        JobStatus.NEEDS_REVIEW,
        JobStatus.COMPLETED,
        JobStatus.FAILED,
    },
    JobStatus.REPAIR_PROPOSED: {JobStatus.APPLYING_PATCH, JobStatus.NEEDS_REVIEW, JobStatus.FAILED},
    JobStatus.APPLYING_PATCH: {JobStatus.VALIDATING, JobStatus.FAILED},
    JobStatus.VALIDATING: {JobStatus.PR_CREATED, JobStatus.NEEDS_REVIEW, JobStatus.FAILED},
    JobStatus.PR_CREATED: set(),
    JobStatus.NEEDS_REVIEW: set(),
    JobStatus.COMPLETED: set(),
    JobStatus.FAILED: set(),
}


class InvalidTransitionError(ValueError):
    """Raised when a job is asked to move to a status it may not move to."""


def check_transition(current: JobStatus, new: JobStatus) -> None:
    if new not in ALLOWED_TRANSITIONS[current]:
        raise InvalidTransitionError(f"Invalid status transition: {current.value} -> {new.value}")


# --------------------------------------------------------------------------- #
# Requests
# --------------------------------------------------------------------------- #
class JobCreateRequest(BaseModel):
    """Manual inspection request. `target_url` is accepted as an alias of `website_url`."""

    website_url: AnyHttpUrl = Field(validation_alias=AliasChoices("website_url", "target_url"))


class CIWebhookRequest(BaseModel):
    """Simulated CI event (for example, a successful build on main)."""

    event_type: str = Field(min_length=1)
    website_url: AnyHttpUrl = Field(validation_alias=AliasChoices("website_url", "target_url"))
    repository: str = Field(pattern=r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", description="owner/name")
    commit_sha: str = Field(pattern=r"^[0-9a-fA-F]{7,40}$")


# --------------------------------------------------------------------------- #
# Artifact references (metadata only: never store screenshots in the database)
# --------------------------------------------------------------------------- #
class ArtifactDraft(BaseModel):
    """What a browser runner returns; the store turns it into an ArtifactRef."""

    kind: Literal["screenshot", "dom_snapshot", "trace", "log", "other"]
    uri: str = Field(min_length=1, description="Path or URI to the artifact; mock:// means a placeholder")
    description: str = ""
    mock: bool = False


class ArtifactRef(ArtifactDraft):
    artifact_id: str
    created_at: str


# --------------------------------------------------------------------------- #
# Inspection result summary and job responses
# --------------------------------------------------------------------------- #
class Inspection(BaseModel):
    mode: Literal["mock", "playwright"]
    executed: bool = Field(description="True only if a real browser actually ran")
    message: str


class JobResponse(BaseModel):
    job_id: str
    website_url: str
    status: JobStatus
    source: Literal["manual", "ci_webhook"]
    repository: Optional[str] = None
    commit_sha: Optional[str] = None
    created_at: str
    updated_at: str
    inspection: Optional[Inspection] = None
    error: Optional[str] = None
    artifacts: List[ArtifactRef] = Field(default_factory=list)


class JobListResponse(BaseModel):
    items: List[JobResponse]
    total: int
    limit: int
    offset: int


class BrowserResultNote(BaseModel):
    type: str
    executed: bool
    message: str


class CIWebhookResponse(BaseModel):
    message: str
    job_id: str
    website_url: str
    repository: str
    commit_sha: str
    status: JobStatus
    browser_result: BrowserResultNote