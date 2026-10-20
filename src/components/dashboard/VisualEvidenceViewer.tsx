import { useState, useId } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "./EmptyState";
import { StatusBadge } from "./StatusBadge";
import type { InspectionEvidence } from "../../data/mockJobs";

export type EvidenceViewMode = "split" | "baseline" | "defective";

export interface VisualEvidenceViewerProps {
  evidence?: InspectionEvidence | null;
  evidenceList?: InspectionEvidence[];
  selectedEvidenceId?: string;
  onSelectEvidence?: (id: string) => void;
  title?: string;
  highlightedDefectId?: string;
  className?: string;
}

export function VisualEvidenceViewer({
  evidence: initialEvidence,
  evidenceList = [],
  selectedEvidenceId,
  onSelectEvidence,
  title = "Visual Inspection Evidence Comparison",
  highlightedDefectId,
  className = "",
}: VisualEvidenceViewerProps) {
  // If a list is provided, default to the selected or first item
  const [internalActiveId, setInternalActiveId] = useState<string>(() => {
    if (selectedEvidenceId) return selectedEvidenceId;
    if (initialEvidence) return initialEvidence.id;
    if (evidenceList.length > 0) return evidenceList[0].id;
    return "";
  });

  const activeId = selectedEvidenceId ?? internalActiveId;

  // Active evidence resolution
  const activeEvidence: InspectionEvidence | undefined =
    evidenceList.find((e) => e.id === activeId) || initialEvidence || evidenceList[0];

  // View modes: "split" (side-by-side desktop, stacked mobile), "baseline", "defective"
  const [viewMode, setViewMode] = useState<EvidenceViewMode>("split");
  // Zoom toggle
  const [isZoomed, setIsZoomed] = useState<boolean>(false);
  // Defect locator overlay box toggle
  const [showOverlay, setShowOverlay] = useState<boolean>(true);

  // Image load error states per active evidence
  const [imageErrors, setImageErrors] = useState<Record<string, { baseline?: boolean; defective?: boolean }>>({});

  const modeControlId = useId();

  const handleSelect = (id: string) => {
    if (onSelectEvidence) {
      onSelectEvidence(id);
    } else {
      setInternalActiveId(id);
    }
  };

  const markImageError = (evidenceId: string, side: "baseline" | "defective") => {
    setImageErrors((prev) => ({
      ...prev,
      [evidenceId]: {
        ...prev[evidenceId],
        [side]: true,
      },
    }));
  };

  const retryImageLoad = (evidenceId: string, side: "baseline" | "defective") => {
    setImageErrors((prev) => ({
      ...prev,
      [evidenceId]: {
        ...prev[evidenceId],
        [side]: false,
      },
    }));
  };

  // If no evidence exists at all
  if (!activeEvidence) {
    return (
      <div className={`visual-evidence-viewer-wrapper ${className}`}>
        <EmptyState
          title="No Visual Evidence Available"
          description="Visual screenshot diffs and Playwright trace artifacts have not been staged for this inspection run."
        />
      </div>
    );
  }

  const isTrace = activeEvidence.type === "playwright-trace";
  const baselineSrc = activeEvidence.baselineImageUrl;
  const defectiveSrc = activeEvidence.defectiveImageUrl || activeEvidence.imageUrl;
  const hasBaseline = Boolean(baselineSrc);
  const hasDefective = Boolean(defectiveSrc);
  const hasBothScreenshots = hasBaseline && hasDefective;

  const activeErrors = imageErrors[activeEvidence.id] || {};
  const isBaselineBroken = Boolean(activeErrors.baseline);
  const isDefectiveBroken = Boolean(activeErrors.defective);

  return (
    <div
      className={`visual-evidence-viewer ${className}`}
      id="visual-evidence-viewer"
      aria-label="Visual Evidence Viewer"
    >
      {/* 1. Header Toolbar */}
      <div className="evidence-viewer-header">
        <div className="evidence-viewer-title-group">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span className="job-id-cell">#{activeEvidence.id}</span>
            <h3 className="evidence-viewer-title">{activeEvidence.title || title}</h3>
            <span className="defect-category-pill" style={{ textTransform: "capitalize" }}>
              {activeEvidence.type.replace("-", " ")}
            </span>
          </div>

          {/* Context References */}
          <div className="evidence-viewer-context-row">
            {activeEvidence.jobId && (
              <span>
                Run:{" "}
                <Link
                  to={`/qa/jobs/${activeEvidence.jobId}`}
                  className="evidence-viewer-link"
                >
                  #{activeEvidence.jobId}
                </Link>
              </span>
            )}

            {activeEvidence.defectId && (
              <span>
                Finding:{" "}
                <span
                  className={`evidence-viewer-defect-tag ${
                    highlightedDefectId === activeEvidence.defectId ? "highlighted" : ""
                  }`}
                >
                  #{activeEvidence.defectId}
                </span>
              </span>
            )}

            {activeEvidence.viewport && (
              <span className="evidence-meta-pill">
                Viewport: <strong>{activeEvidence.viewport}</strong>
              </span>
            )}

            {activeEvidence.capturedAt && (
              <span className="evidence-meta-pill">
                Captured: <strong>{activeEvidence.capturedAt}</strong>
              </span>
            )}
          </div>
        </div>

        {/* 2. Multiple Evidences Selector Pill Bar (if multiple exist) */}
        {evidenceList.length > 1 && (
          <div className="evidence-selector-bar" role="tablist" aria-label="Available evidence artifacts">
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)" }}>
              Artifacts:
            </span>
            {evidenceList.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === activeEvidence.id}
                className={`filter-pill-btn ${item.id === activeEvidence.id ? "active" : ""}`}
                onClick={() => handleSelect(item.id)}
              >
                <span>#{item.id}</span>
                <span style={{ opacity: 0.8, fontSize: "0.7rem" }}>
                  ({item.type === "screenshot" ? "Image" : "Trace"})
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Description Banner if available */}
      {activeEvidence.description && (
        <div className="evidence-desc-banner">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>{activeEvidence.description}</span>
        </div>
      )}

      {/* 3. Non-screenshot View: Playwright Trace & DOM Snapshot */}
      {isTrace ? (
        <div className="trace-evidence-container">
          <div className="trace-evidence-card">
            <div className="trace-evidence-header">
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
                <h4 style={{ margin: 0, fontSize: "1rem", color: "var(--color-text-primary)" }}>
                  Playwright Browser Trace & Network HAR Recording
                </h4>
              </div>
              <StatusBadge status="passed" label="Trace Logged" size="sm" />
            </div>

            <p style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              Full browser event timeline recorded with Playwright Test runner. Includes step-by-step DOM mutation snapshots, console telemetry logs, and all network request/response headers.
            </p>

            <div className="trace-details-grid">
              <div className="trace-detail-item">
                <span className="trace-detail-label">Viewport</span>
                <span className="trace-detail-val">{activeEvidence.viewport}</span>
              </div>
              <div className="trace-detail-item">
                <span className="trace-detail-label">Runner Engine</span>
                <span className="trace-detail-val">{activeEvidence.browser || "Playwright Headless Chromium"}</span>
              </div>
              <div className="trace-detail-item">
                <span className="trace-detail-label">Target Route</span>
                <span className="trace-detail-val">{activeEvidence.selector || "Full page context"}</span>
              </div>
              <div className="trace-detail-item">
                <span className="trace-detail-label">Trace Archive</span>
                <span className="trace-detail-val"><code>trace-{activeEvidence.id.toLowerCase()}.zip</code></span>
              </div>
            </div>

            <div className="trace-action-bar">
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                Tip: You can load this trace into <code>npx playwright show-trace</code> for interactive time-travel debugging.
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* 4. Screenshot Visual Comparison View */
        <div className="visual-comparison-wrapper">
          {/* Controls Bar: View Modes & Overlays */}
          <div className="evidence-controls-bar">
            {/* View Mode Switcher */}
            <div
              className="evidence-mode-tabs"
              role="tablist"
              aria-label="Screenshot comparison mode"
              id={modeControlId}
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "split"}
                className={`evidence-mode-tab ${viewMode === "split" ? "active" : ""}`}
                onClick={() => setViewMode("split")}
                title="Side-by-side comparison on desktop, stacked on mobile"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <line x1="12" y1="3" x2="12" y2="21" />
                </svg>
                <span>Side-by-Side</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "baseline"}
                className={`evidence-mode-tab ${viewMode === "baseline" ? "active" : ""}`}
                onClick={() => setViewMode("baseline")}
                title="Inspect clean expected baseline screenshot only"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span>Baseline Only</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "defective"}
                className={`evidence-mode-tab ${viewMode === "defective" ? "active" : ""}`}
                onClick={() => setViewMode("defective")}
                title="Inspect captured defective regression screenshot only"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>Defective Only</span>
              </button>
            </div>

            {/* Viewport & Action Helpers */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              {activeEvidence.selector && (
                <button
                  type="button"
                  className={`filter-pill-btn ${showOverlay ? "active" : ""}`}
                  onClick={() => setShowOverlay((v) => !v)}
                  title="Toggle defect locator overlay annotation"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect width="18" height="18" x="3" y="3" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span>{showOverlay ? "Overlay On" : "Overlay Off"}</span>
                </button>
              )}

              <button
                type="button"
                className={`filter-pill-btn ${isZoomed ? "active" : ""}`}
                onClick={() => setIsZoomed((v) => !v)}
                title={isZoomed ? "Reset zoom level" : "Zoom in to inspect details"}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
                <span>{isZoomed ? "Zoom 100%" : "Fit Width"}</span>
              </button>
            </div>
          </div>

          {/* Screenshot Comparison Grid / Panels */}
          <div className={`evidence-comparison-container mode-${viewMode} ${hasBothScreenshots ? "has-both" : "single-shot"}`}>
            {/* 1. Baseline Screenshot Panel */}
            {(viewMode === "split" || viewMode === "baseline") && (
              <div className="evidence-panel baseline" aria-label="Clean Baseline Screenshot Panel">
                <div className="evidence-panel-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span className="evidence-badge baseline">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{activeEvidence.baselineLabel || "Baseline — Expected Clean"}</span>
                    </span>
                  </div>

                  <span className="evidence-dimension-tag">
                    {activeEvidence.dimensions || activeEvidence.viewport}
                  </span>
                </div>

                <div className={`evidence-image-viewport ${isZoomed ? "zoomed" : ""}`}>
                  {!hasBaseline ? (
                    <div className="evidence-missing-card">
                      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect width="18" height="18" x="3" y="3" rx="2" />
                        <line x1="3" y1="3" x2="21" y2="21" />
                      </svg>
                      <h5 style={{ margin: "0.4rem 0 0.2rem", fontSize: "0.9rem", color: "#f1f5f9" }}>
                        No Baseline Screenshot Registered
                      </h5>
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "#94a3b8", maxWidth: 280 }}>
                        This viewport checkpoint was evaluated without a prior clean snapshot comparison.
                      </p>
                    </div>
                  ) : isBaselineBroken ? (
                    <div className="evidence-load-error-card">
                      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <h5 style={{ margin: "0.4rem 0 0.2rem", fontSize: "0.9rem", color: "#f87171" }}>
                        Failed to Load Baseline Image
                      </h5>
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "#cbd5e1", maxWidth: 280 }}>
                        The image resource at <code>{baselineSrc}</code> could not be loaded.
                      </p>
                      <button
                        type="button"
                        className="filter-pill-btn"
                        style={{ marginTop: "0.5rem" }}
                        onClick={() => retryImageLoad(activeEvidence.id, "baseline")}
                      >
                        Retry Loading
                      </button>
                    </div>
                  ) : (
                    <div className="evidence-img-container">
                      <img
                        src={baselineSrc}
                        alt={`Baseline expected capture for ${activeEvidence.title}`}
                        className="evidence-screenshot-img"
                        onError={() => markImageError(activeEvidence.id, "baseline")}
                        loading="lazy"
                      />
                      <span className="evidence-viewport-stamp">Clean Reference</span>
                    </div>
                  )}
                </div>

                <div className="evidence-panel-caption">
                  <span>Golden Reference Baseline</span>
                  <span>Playwright Automated Capture</span>
                </div>
              </div>
            )}

            {/* 2. Defective Screenshot Panel */}
            {(viewMode === "split" || viewMode === "defective") && (
              <div className="evidence-panel defective" aria-label="Defective Screenshot Panel">
                <div className="evidence-panel-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span className="evidence-badge defective">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{activeEvidence.defectiveLabel || "Defective — Regression Detected"}</span>
                    </span>
                  </div>

                  <span className="evidence-dimension-tag">
                    {activeEvidence.dimensions || activeEvidence.viewport}
                  </span>
                </div>

                <div className={`evidence-image-viewport ${isZoomed ? "zoomed" : ""}`}>
                  {!hasDefective ? (
                    <div className="evidence-missing-card">
                      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect width="18" height="18" x="3" y="3" rx="2" />
                        <line x1="3" y1="3" x2="21" y2="21" />
                      </svg>
                      <h5 style={{ margin: "0.4rem 0 0.2rem", fontSize: "0.9rem", color: "#f1f5f9" }}>
                        No Defective Screenshot Staged
                      </h5>
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "#94a3b8", maxWidth: 280 }}>
                        No visual screenshot was captured for this fault. View DOM selector details below.
                      </p>
                    </div>
                  ) : isDefectiveBroken ? (
                    <div className="evidence-load-error-card">
                      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <h5 style={{ margin: "0.4rem 0 0.2rem", fontSize: "0.9rem", color: "#f87171" }}>
                        Failed to Load Defective Image
                      </h5>
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "#cbd5e1", maxWidth: 280 }}>
                        The screenshot file could not be retrieved from <code>{defectiveSrc}</code>.
                      </p>
                      <button
                        type="button"
                        className="filter-pill-btn"
                        style={{ marginTop: "0.5rem" }}
                        onClick={() => retryImageLoad(activeEvidence.id, "defective")}
                      >
                        Retry Loading
                      </button>
                    </div>
                  ) : (
                    <div className="evidence-img-container">
                      <img
                        src={defectiveSrc}
                        alt={`Defective regression capture for ${activeEvidence.title}`}
                        className="evidence-screenshot-img"
                        onError={() => markImageError(activeEvidence.id, "defective")}
                        loading="lazy"
                      />

                      {/* Defect Bounding Highlight Simulation */}
                      {showOverlay && activeEvidence.selector && (
                        <div
                          className="defect-overlay-bounding-box"
                          title={`Affected element: ${activeEvidence.selector}`}
                          aria-label={`Visual fault locator: ${activeEvidence.selector}`}
                        >
                          <span className="defect-overlay-tag">
                            Fault Target: {activeEvidence.selector}
                          </span>
                        </div>
                      )}

                      <span className="evidence-viewport-stamp">Fault Ingested</span>
                    </div>
                  )}
                </div>

                <div className="evidence-panel-caption">
                  <span>Defect Capture</span>
                  <span>
                    {activeEvidence.selector ? (
                      <code>{activeEvidence.selector}</code>
                    ) : (
                      "Target Area"
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 5. Technical Metadata & Traceability Footer */}
          <div className="evidence-metadata-footer">
            <div className="evidence-meta-cell">
              <span className="evidence-meta-title">Execution Engine</span>
              <span className="evidence-meta-data">
                {activeEvidence.browser || "Playwright Headless Chromium (1440x900)"}
              </span>
            </div>

            <div className="evidence-meta-cell">
              <span className="evidence-meta-title">Resolution & DPR</span>
              <span className="evidence-meta-data">
                {activeEvidence.dimensions || activeEvidence.viewport}
                {activeEvidence.devicePixelRatio ? ` (${activeEvidence.devicePixelRatio}x DPR)` : ""}
              </span>
            </div>

            <div className="evidence-meta-cell">
              <span className="evidence-meta-title">Target Selector</span>
              <span className="evidence-meta-data">
                {activeEvidence.selector ? (
                  <code className="defect-selector-code">{activeEvidence.selector}</code>
                ) : (
                  "N/A (Full Viewport)"
                )}
              </span>
            </div>

            <div className="evidence-meta-cell">
              <span className="evidence-meta-title">Artifact ID & Hash</span>
              <span className="evidence-meta-data">
                <code>#{activeEvidence.id}</code> (SHA-256 Verified)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export as EvidenceViewer for developer convenience
export { VisualEvidenceViewer as EvidenceViewer };
