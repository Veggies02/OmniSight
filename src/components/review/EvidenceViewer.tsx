import React, { useState } from "react";
import { type VisualEvidencePair, type ClientRepairJobResult } from "../../types/review-types";

export type ComparisonMode = "side-by-side" | "slider" | "before-only" | "after-only";

export interface EvidenceViewerProps {
  scenarioId: string;
  defectCategory: string;
  proposalId?: string;
  visualEvidence?: VisualEvidencePair;
  repairResult?: ClientRepairJobResult | null;
}

interface ImageDimension {
  width: number;
  height: number;
  aspectRatio: number;
}

export const EvidenceViewer: React.FC<EvidenceViewerProps> = ({
  scenarioId,
  defectCategory,
  proposalId,
  visualEvidence,
  repairResult,
}) => {
  const [mode, setMode] = useState<ComparisonMode>("side-by-side");
  const [sliderPos, setSliderPos] = useState<number>(50);
  const [beforeImgError, setBeforeImgError] = useState(false);
  const [afterImgError, setAfterImgError] = useState(false);
  const [beforeLoading, setBeforeLoading] = useState(true);
  const [afterLoading, setAfterLoading] = useState(true);

  // Natural dimensions recorded on image load
  const [beforeDims, setBeforeDims] = useState<ImageDimension | null>(null);
  const [afterDims, setAfterDims] = useState<ImageDimension | null>(null);

  // Evidence integrity validation:
  // Check if repairResult belongs to this proposal/scenario
  const hasProposalMismatch = Boolean(
    repairResult && proposalId && repairResult.proposalId && repairResult.proposalId !== proposalId
  );

  // Check if visualEvidence scenario matches component scenario
  const hasScenarioMismatch = Boolean(
    visualEvidence && visualEvidence.scenarioId && visualEvidence.scenarioId !== scenarioId
  );

  // Before image: Defective screenshot
  const beforeUrl = visualEvidence?.defectiveScreenshotUrl;

  // After image provenance:
  // If repairResult has mismatched proposalId, do NOT silently use its screenshot
  const afterUrl = hasProposalMismatch
    ? visualEvidence?.baselineScreenshotUrl
    : repairResult?.postRepairScreenshotUrl ||
      visualEvidence?.postRepairScreenshotUrl ||
      visualEvidence?.baselineScreenshotUrl;

  const hasBefore = Boolean(beforeUrl) && !beforeImgError;
  const hasAfter = Boolean(afterUrl) && !afterImgError;

  // Dimension and aspect ratio comparison
  const aspectTolerance = 0.05; // 5% ratio variance tolerance
  const aspectMismatch = Boolean(
    beforeDims &&
      afterDims &&
      Math.abs(beforeDims.aspectRatio - afterDims.aspectRatio) > aspectTolerance
  );

  const dimensionMismatch = Boolean(
    beforeDims &&
      afterDims &&
      (Math.abs(beforeDims.width - afterDims.width) > 5 ||
        Math.abs(beforeDims.height - afterDims.height) > 5)
  );

  // Compute common aspect ratio for consistent slider canvas
  // When dimensions differ, canvas uses the base image's ratio and scales overlay with contain/alignment
  const canvasAspectRatio = afterDims
    ? afterDims.aspectRatio
    : beforeDims
    ? beforeDims.aspectRatio
    : (visualEvidence?.viewport.width || 1440) / (visualEvidence?.viewport.height || 900);

  const handleBeforeLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setBeforeLoading(false);
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      setBeforeDims({
        width: img.naturalWidth,
        height: img.naturalHeight,
        aspectRatio: img.naturalWidth / img.naturalHeight,
      });
    }
  };

  const handleAfterLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setAfterLoading(false);
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      setAfterDims({
        width: img.naturalWidth,
        height: img.naturalHeight,
        aspectRatio: img.naturalWidth / img.naturalHeight,
      });
    }
  };

  // Determine authoritative verification status
  // Missing evidence must NEVER be treated as successful
  let verificationStatusText = "INCONCLUSIVE";
  let verificationStatusClass = "pill-inconclusive";

  if (hasProposalMismatch) {
    verificationStatusText = "PROVENANCE MISMATCH";
    verificationStatusClass = "pill-failed";
  } else if (repairResult) {
    if (repairResult.verificationStatus === "passed" || repairResult.visualPassed) {
      // Must have actual post-repair evidence or baseline verification
      if (!hasAfter) {
        verificationStatusText = "INCONCLUSIVE (MISSING EVIDENCE)";
        verificationStatusClass = "pill-inconclusive";
      } else {
        verificationStatusText = (repairResult.verificationStatus || "PASSED").toUpperCase();
        verificationStatusClass = "pill-passed";
      }
    } else if (repairResult.verificationStatus === "failed") {
      verificationStatusText = "FAILED";
      verificationStatusClass = "pill-failed";
    } else {
      verificationStatusText = (repairResult.verificationStatus || "INCONCLUSIVE").toUpperCase();
      verificationStatusClass = "pill-inconclusive";
    }
  }

  return (
    <div className="evidence-viewer-root" data-testid="evidence-viewer-root">
      {/* Integrity & Metadata Alerts */}
      {hasProposalMismatch && (
        <div className="evidence-integrity-alert alert-warning" data-testid="integrity-mismatch-alert">
          <span className="alert-icon">⚠️</span>
          <div className="alert-content">
            <strong>Evidence Provenance Warning:</strong> The active repair job result belongs to proposal{" "}
            <code>{repairResult?.proposalId}</code>, but this viewer is displaying proposal <code>{proposalId}</code>.
            Job results and post-repair screenshots have been disassociated to prevent false verification claims.
          </div>
        </div>
      )}

      {hasScenarioMismatch && (
        <div className="evidence-integrity-alert alert-warning" data-testid="scenario-mismatch-alert">
          <span className="alert-icon">⚠️</span>
          <div className="alert-content">
            <strong>Scenario Metadata Inconsistency:</strong> Evidence is tagged with scenario{" "}
            <code>{visualEvidence?.scenarioId}</code> but the proposal is for <code>{scenarioId}</code>.
          </div>
        </div>
      )}

      {/* Alignment & Aspect Ratio Warning Banner */}
      {(aspectMismatch || dimensionMismatch) && mode === "slider" && (
        <div className="evidence-alignment-notice" data-testid="aspect-mismatch-notice">
          <span className="notice-icon">ℹ️</span>
          <div className="notice-text">
            <strong>Mismatched Dimensions:</strong> Before image ({beforeDims?.width}×{beforeDims?.height}) and After image ({afterDims?.width}×{afterDims?.height}) have different {aspectMismatch ? "aspect ratios" : "pixel dimensions"}. Each image preserves its aspect ratio without distortion; visual alignment is centered and not pixel-identical.
          </div>
        </div>
      )}

      {/* Controls & Mode Selection Header */}
      <div className="evidence-viewer-toolbar">
        <div className="mode-toggle-group" data-testid="mode-toggle-group" role="radiogroup" aria-label="Evidence comparison mode">
          <button
            type="button"
            className={`mode-btn ${mode === "side-by-side" ? "active" : ""}`}
            onClick={() => setMode("side-by-side")}
            data-testid="mode-btn-side-by-side"
            aria-pressed={mode === "side-by-side"}
          >
            Side-by-Side
          </button>
          <button
            type="button"
            className={`mode-btn ${mode === "slider" ? "active" : ""}`}
            onClick={() => setMode("slider")}
            data-testid="mode-btn-slider"
            aria-pressed={mode === "slider"}
          >
            Interactive Slider
          </button>
          <button
            type="button"
            className={`mode-btn ${mode === "before-only" ? "active" : ""}`}
            onClick={() => setMode("before-only")}
            data-testid="mode-btn-before-only"
            aria-pressed={mode === "before-only"}
          >
            Before Only
          </button>
          <button
            type="button"
            className={`mode-btn ${mode === "after-only" ? "active" : ""}`}
            onClick={() => setMode("after-only")}
            data-testid="mode-btn-after-only"
            aria-pressed={mode === "after-only"}
          >
            After Only
          </button>
        </div>

        {/* Status Chip & Viewport */}
        <div className="evidence-status-bar">
          <span
            className={`evidence-status-pill ${verificationStatusClass}`}
            data-testid="verification-status-pill"
          >
            {verificationStatusText}
          </span>
          <span className="viewport-badge" data-testid="viewer-viewport">
            {visualEvidence?.viewport ? `${visualEvidence.viewport.width} × ${visualEvidence.viewport.height}` : "1440 × 900"}
          </span>
        </div>
      </div>

      {/* Main Comparison Canvas */}
      <div className="evidence-canvas-wrapper" data-testid="evidence-canvas">
        {mode === "side-by-side" && (
          <div className="comparison-side-by-side" data-testid="comparison-side-by-side">
            {/* Before / Defective Side */}
            <div className="side-card" data-testid="side-card-before">
              <div className="side-card-header before-header">
                <span className="label-badge badge-before">Original Defective UI</span>
                <span className="meta-text">{defectCategory}</span>
                {beforeDims && (
                  <span className="dim-tag" data-testid="before-dim-tag">
                    {beforeDims.width}×{beforeDims.height}
                  </span>
                )}
              </div>
              <div className="image-view-box">
                {beforeUrl && !beforeImgError ? (
                  <>
                    {beforeLoading && <div className="img-loading-indicator" data-testid="before-loading">Loading...</div>}
                    <img
                      src={beforeUrl}
                      alt={`Defective UI for ${scenarioId}`}
                      className="comparison-img"
                      data-testid="defective-image"
                      onLoad={handleBeforeLoad}
                      onError={() => {
                        setBeforeImgError(true);
                        setBeforeLoading(false);
                      }}
                    />
                  </>
                ) : (
                  <div className="image-fallback" data-testid="defective-placeholder">
                    {beforeImgError ? "Failed to load defective screenshot" : "Before-repair screenshot not available"}
                  </div>
                )}
              </div>
            </div>

            {/* After / Repaired Side */}
            <div className="side-card" data-testid="side-card-after">
              <div className="side-card-header after-header">
                <span className="label-badge badge-after">Post-Repair Verified State</span>
                <span className="meta-text">
                  {repairResult && !hasProposalMismatch ? `Job ${repairResult.jobId}` : "Expected Repaired Flow"}
                </span>
                {afterDims && (
                  <span className="dim-tag" data-testid="after-dim-tag">
                    {afterDims.width}×{afterDims.height}
                  </span>
                )}
              </div>
              <div className="image-view-box">
                {afterUrl && !afterImgError ? (
                  <>
                    {afterLoading && <div className="img-loading-indicator" data-testid="after-loading">Loading...</div>}
                    <img
                      src={afterUrl}
                      alt={`Post-repair state for ${scenarioId}`}
                      className="comparison-img"
                      data-testid="baseline-image"
                      onLoad={handleAfterLoad}
                      onError={() => {
                        setAfterImgError(true);
                        setAfterLoading(false);
                      }}
                    />
                  </>
                ) : (
                  <div className="image-fallback" data-testid="baseline-placeholder">
                    {afterImgError ? "Failed to load post-repair screenshot" : "Post-repair screenshot not available"}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {mode === "slider" && (
          <div className="comparison-slider-container" data-testid="comparison-slider">
            {hasBefore && hasAfter ? (
              <div
                className="slider-canvas"
                data-testid="slider-canvas"
                style={{ aspectRatio: `${canvasAspectRatio}` }}
              >
                {/* Underneath: After image */}
                <div className="slider-base-container" style={{ width: "100%", height: "100%" }}>
                  <img
                    src={afterUrl!}
                    alt={`Post-repair state for ${scenarioId}`}
                    className="slider-base-img"
                    data-testid="slider-img-after"
                  />
                  <span className="slider-tag tag-after">After Repair</span>
                </div>

                {/* Overlay: Before image clipped by slider position */}
                <div
                  className="slider-overlay-clip"
                  style={{ width: `${sliderPos}%` }}
                  data-testid="slider-overlay-clip"
                >
                  <div
                    className="slider-overlay-inner"
                    style={{ width: `${100 / (sliderPos / 100 || 0.001)}%` }}
                  >
                    <img
                      src={beforeUrl!}
                      alt={`Defective state for ${scenarioId}`}
                      className="slider-overlay-img"
                      data-testid="slider-img-before"
                    />
                  </div>
                  <span className="slider-tag tag-before">Before Repair</span>
                </div>

                {/* Draggable Divider Line & Handle */}
                <div className="slider-divider" style={{ left: `${sliderPos}%` }} data-testid="slider-divider">
                  <div className="slider-handle" aria-hidden="true" data-testid="slider-handle">
                    <span>⇄</span>
                  </div>
                </div>

                {/* Range Input for Mouse and Keyboard accessibility */}
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={sliderPos}
                  onChange={(e) => setSliderPos(Number(e.target.value))}
                  className="slider-range-input"
                  aria-label="Before and after comparison slider"
                  data-testid="slider-range-input"
                />
              </div>
            ) : (
              <div className="image-fallback slider-fallback" data-testid="slider-fallback">
                Both before and after screenshots are required for interactive slider comparison.
              </div>
            )}
          </div>
        )}

        {mode === "before-only" && (
          <div className="single-view-container" data-testid="comparison-single-before">
            <div className="single-view-header" data-testid="single-card-before">
              <span className="label-badge badge-before">Original Defective UI</span>
              {beforeDims && (
                <span className="dim-tag">{beforeDims.width}×{beforeDims.height}</span>
              )}
            </div>
            <div className="image-view-box">
              {hasBefore ? (
                <img
                  src={beforeUrl!}
                  alt={`Defective UI for ${scenarioId}`}
                  className="comparison-img"
                  data-testid="img-before-only"
                />
              ) : (
                <div className="image-fallback" data-testid="fallback-before">
                  Defective screenshot not available
                </div>
              )}
            </div>
          </div>
        )}

        {mode === "after-only" && (
          <div className="single-view-container" data-testid="comparison-single-after">
            <div className="single-view-header" data-testid="single-card-after">
              <span className="label-badge badge-after">Post-Repair Verified State</span>
              {afterDims && (
                <span className="dim-tag">{afterDims.width}×{afterDims.height}</span>
              )}
            </div>
            <div className="image-view-box">
              {hasAfter ? (
                <img
                  src={afterUrl!}
                  alt={`Post-repair state for ${scenarioId}`}
                  className="comparison-img"
                  data-testid="img-after-only"
                />
              ) : (
                <div className="image-fallback" data-testid="fallback-after">
                  Post-repair screenshot not available
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Verification Check Badges & Quantitative Metrics */}
      {repairResult?.verificationChecks && repairResult.verificationChecks.length > 0 && !hasProposalMismatch && (
        <div className="viewer-checks-panel" data-testid="verification-checks-summary">
          <div className="checks-header">
            <h4>Automated Verification Checks ({repairResult.verificationChecks.length})</h4>
          </div>
          <div className="checks-badges-grid">
            {repairResult.verificationChecks.map((chk, i) => (
              <div key={i} className={`check-chip ${chk.passed ? "chip-pass" : "chip-fail"}`}>
                <span className="chip-icon">{chk.passed ? "✓" : "✕"}</span>
                <span className="chip-name">{chk.name}:</span>
                <span className="chip-val">{String(chk.actual)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
