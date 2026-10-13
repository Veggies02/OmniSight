"""Pydantic data contracts for defect findings, evidence context, and VLM analysis results.

These schemas define the agreed integration contracts with:
- Person 1 (Browser Automation): Evidence inputs (screenshots, DOM snippets, viewport)
- Person 3 (Backend Orchestrator): Structured defect findings and confidence scores
"""
from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional
import uuid
from pydantic import BaseModel, Field


class DefectCategory(str, Enum):
    """Explicit taxonomy of supported visual defect types."""
    MOBILE_BUTTON_CLIPPING = "mobile_button_clipping"
    OVERLAPPING_TEXT = "overlapping_text"
    HIDDEN_CONTROL = "hidden_control"
    INCORRECT_SPACING = "incorrect_spacing"
    MODAL_OVERFLOW = "modal_overflow"
    OTHER = "other"
    NONE = "none"


class ViewportConfig(BaseModel):
    """Browser viewport configuration at time of capture."""
    width: int = Field(default=1280, ge=1, description="Viewport width in pixels")
    height: int = Field(default=720, ge=1, description="Viewport height in pixels")
    is_mobile: bool = Field(default=False, description="Whether mobile emulation is enabled")
    device_scale_factor: float = Field(default=1.0, ge=0.5, le=4.0, description="DPI scale factor")


class BoundingBox(BaseModel):
    """Normalized coordinates [0, 1] of defective region within screenshot."""
    x: float = Field(ge=0.0, le=1.0, description="Top-left X coordinate normalized")
    y: float = Field(ge=0.0, le=1.0, description="Top-left Y coordinate normalized")
    width: float = Field(ge=0.0, le=1.0, description="Width normalized")
    height: float = Field(ge=0.0, le=1.0, description="Height normalized")


class EvidenceContext(BaseModel):
    """Input payload provided by browser runner / orchestrator for analysis."""
    job_id: str = Field(description="Unique identifier for the inspection job")
    screenshot_path: str = Field(description="Local path or URI to the captured screenshot")
    url: str = Field(description="Page URL where the evidence was captured")
    route: Optional[str] = Field(default=None, description="Application route path, e.g. '/products/1'")
    viewport: ViewportConfig = Field(default_factory=ViewportConfig)
    dom_snippet: Optional[str] = Field(default=None, description="Relevant HTML/DOM excerpt surrounding target area")
    step_name: Optional[str] = Field(default=None, description="Name of the user journey step executed")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AIFinding(BaseModel):
    """A single defect hypothesis identified and structured by the VLM pipeline."""
    finding_id: str = Field(
        default_factory=lambda: f"fnd_{uuid.uuid4().hex[:8]}",
        description="Unique identifier for this finding"
    )
    job_id: str = Field(description="Associated inspection job ID")
    defect_category: DefectCategory = Field(description="Classified defect type from taxonomy")
    description: str = Field(description="Human-readable description of the visual defect")
    evidence_reference: str = Field(description="Reference to the screenshot or artifact backing this finding")
    target_selector: Optional[str] = Field(default=None, description="Likely CSS/DOM selector if identifiable")
    target_component: Optional[str] = Field(default=None, description="Likely React component or file name if inferred")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence score between 0.0 and 1.0")
    uncertainty_notes: Optional[str] = Field(default=None, description="Notes on model uncertainty or ambiguities")
    requires_human_review: bool = Field(default=False, description="Flag indicating high uncertainty requiring human review")
    suggested_next_step: Optional[str] = Field(default=None, description="Recommended remediation or inspection step")
    bounding_box: Optional[BoundingBox] = Field(default=None, description="Optional bounding box of defect region")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AnalysisResponse(BaseModel):
    """Complete structured response returned by defect_analyzer to the orchestrator."""
    job_id: str = Field(description="Inspection job ID")
    has_defect: bool = Field(description="Whether one or more defects were identified")
    findings: List[AIFinding] = Field(default_factory=list, description="List of structured findings")
    analysis_latency_ms: Optional[float] = Field(default=None, description="VLM inference & parsing time in milliseconds")
    raw_model_response: Optional[str] = Field(default=None, description="Raw unparsed model text for auditing")
