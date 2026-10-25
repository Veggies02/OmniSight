import React, { useState } from "react";
import { type VisualEvidencePair, type ClientRepairJobResult } from "../../types/review-types";

export type ComparisonMode = "side-by-side" | "slider" | "before-only" | "after-only";

export interface EvidenceViewerProps {
  scenarioId: string;
  defectCategory: string;
  visualEvidence?: VisualEvidencePair;
  repairResult?: ClientRepairJobResult | null;
}

export const EvidenceViewer: React.FC<EvidenceViewerProps> = ({
  scenarioId,
  defectCategory,
  visualEvidence,
  repairResult,
}) => {
  const [mode, setMode] = useState<ComparisonMode>("side-by-side");
  const [sliderPos, setSliderPos] = useState<number>(50);
  const [beforeImgError, setBeforeImgError] = useState(false);
  const [afterImgError, setAfterImgError] = useState(false);
  const [beforeLoading, setBeforeLoading] = useState(true);
  const [afterLoading, setAfterLoading] = useState(true);

  // Before image: Defective screenshot (or baseline if defective is missing)
  const beforeUrl = visualEvidence?.defectiveScreenshotUrl;
  // After image: Real post-repair screenshot if available, or static post_repair.png, or clean baseline
  const afterUrl =
    repairResult?.postRepairScreenshotUrl ||
    visualEvidence?.postRepairScreenshotUrl ||
    (repairResult?.status === "PASSED" ? "/evidence/verification/post_repair.png" : undefined) ||
    visualEvidence?.baselineScreenshotUrl;

  const hasBefore = Boolean(beforeUrl) && !beforeImgError;
  const hasAfter = Boolean(afterUrl) && !afterImgError;


  return (
    <div className="evidence-viewer-root" data-testid="evidence-viewer-root">
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
            className={`evidence-status-pill ${
              repairResult?.verificationStatus === "passed" || repairResult?.visualPassed
                ? "pill-passed"
                : repairResult?.verificationStatus === "failed"
                ? "pill-failed"
                : "pill-inconclusive"
            }`}
            data-testid="verification-status-pill"
          >
            {repairResult
              ? (repairResult.verificationStatus || (repairResult.visualPassed ? "passed" : "failed")).toUpperCase()
              : "INCONCLUSIVE"}
          </span>
          <span className="viewport-badge" data-testid="viewer-viewport">
            {visualEvidence?.viewport.width || 1440} × {visualEvidence?.viewport.height || 900}
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
                      onLoad={() => setBeforeLoading(false)}
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
                  {repairResult ? `Job ${repairResult.jobId}` : "Expected Repaired Flow"}
                </span>
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
                      onLoad={() => setAfterLoading(false)}
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
              <div className="slider-canvas" data-testid="slider-canvas">
                {/* Underneath: After image */}
                <img
                  src={afterUrl!}
                  alt={`Post-repair state for ${scenarioId}`}
                  className="slider-base-img"
                  data-testid="slider-img-after"
                />
                <span className="slider-tag tag-after">After Repair</span>

                {/* Overlay: Before image clipped by slider position */}
                <div
                  className="slider-overlay-clip"
                  style={{ width: `${sliderPos}%` }}
                  data-testid="slider-overlay-clip"
                >
                  <img
                    src={beforeUrl!}
                    alt={`Defective state for ${scenarioId}`}
                    className="slider-overlay-img"
                    data-testid="slider-img-before"
                  />
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
      {repairResult?.verificationChecks && repairResult.verificationChecks.length > 0 && (
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
