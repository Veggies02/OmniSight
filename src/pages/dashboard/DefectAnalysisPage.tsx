import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useOmniSight } from "../../context/OmniSightContext";

export const DefectAnalysisPage: React.FC = () => {
  const { defects } = useOmniSight();
  const [selectedDefectId, setSelectedDefectId] = useState<string>(defects[0]?.id || "");
  const [viewMode, setViewMode] = useState<"side-by-side" | "defective-only" | "baseline-only">("side-by-side");

  const selectedDefect = defects.find((d) => d.id === selectedDefectId) || defects[0];

  return (
    <div>
      {/* Header */}
      <div className="omni-page-header" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: "2rem" }}>
        <div>
          <div className="omni-eyebrow">
            <span>Multimodal Vision-Language Diagnosis</span>
          </div>
          <h1 className="omni-title">
            AI Defect Analysis & Evidence
          </h1>
          <p className="omni-description">
            Compare captured baseline vs defective screenshots, inspect model diagnostic rationale, and review localized source files.
          </p>
        </div>

        <Link to="/dashboard/repairs" className="omni-btn omni-btn-primary">
          View Repair Proposals →
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "2.5rem" }}>
        {/* Left Column: Visual Screenshot Comparison Workspace */}
        <div>
          {selectedDefect ? (
            <div className="omni-card" style={{ padding: "2rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
                <div>
                  <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "1.375rem", fontWeight: 600 }}>
                    {selectedDefect.title}
                  </h2>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <span className={`omni-badge ${selectedDefect.severity === "critical" ? "omni-badge-danger" : "omni-badge-warning"}`}>
                      {selectedDefect.severity} severity
                    </span>
                    <span className="omni-badge omni-badge-info">
                      Confidence {(selectedDefect.confidence * 100).toFixed(0)}%
                    </span>
                    <span className="omni-badge omni-badge-neutral" style={{ fontFamily: "var(--font-mono)" }}>
                      {selectedDefect.category}
                    </span>
                  </div>
                </div>

                {/* Switcher */}
                <div style={{ display: "flex", gap: "0.25rem", background: "var(--theme-container)", padding: "0.25rem", borderRadius: "var(--radius-pill)", border: "1px solid var(--theme-outline)" }}>
                  {(["side-by-side", "defective-only", "baseline-only"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={`omni-btn omni-btn-sm ${viewMode === mode ? "omni-btn-primary" : "omni-btn-outline"}`}
                      style={{ border: "none", fontSize: "0.75rem", padding: "0.25rem 0.75rem" }}
                    >
                      {mode === "side-by-side" ? "Side-by-Side" : mode === "defective-only" ? "Defective Only" : "Baseline Only"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Screenshots Display */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: viewMode === "side-by-side" ? "1fr 1fr" : "1fr",
                  gap: "1.5rem",
                  marginTop: "1.5rem",
                }}
              >
                {(viewMode === "side-by-side" || viewMode === "baseline-only") && (
                  <div className="omni-comparison-pane" style={{ border: "1px solid var(--theme-outline)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--theme-container)" }}>
                    <div style={{ padding: "0.625rem 1rem", fontSize: "0.75rem", fontWeight: 600, borderBottom: "1px solid var(--theme-outline)", background: "var(--theme-surface)", color: "var(--theme-success-text)", display: "flex", justifyContent: "space-between" }}>
                      <span>✓ Baseline Screenshot (Clean)</span>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--theme-on-surface-subtle)" }}>{selectedDefect.viewport.width}x{selectedDefect.viewport.height}</span>
                    </div>
                    <img
                      src={selectedDefect.baselineScreenshot}
                      alt="Baseline clean state"
                      style={{ width: "100%", height: "300px", objectFit: "contain", display: "block", background: "#0e1117" }}
                    />
                  </div>
                )}

                {(viewMode === "side-by-side" || viewMode === "defective-only") && (
                  <div className="omni-comparison-pane" style={{ border: "1px solid var(--theme-danger-border)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--theme-container)" }}>
                    <div style={{ padding: "0.625rem 1rem", fontSize: "0.75rem", fontWeight: 600, borderBottom: "1px solid var(--theme-danger-border)", background: "var(--theme-danger-bg)", color: "var(--theme-danger-text)", display: "flex", justifyContent: "space-between" }}>
                      <span>⚠ Defective Screenshot (Regression)</span>
                      <span style={{ fontFamily: "var(--font-mono)" }}>{selectedDefect.viewport.width}x{selectedDefect.viewport.height}</span>
                    </div>
                    <img
                      src={selectedDefect.defectiveScreenshot}
                      alt="Defective state visual regression"
                      style={{ width: "100%", height: "300px", objectFit: "contain", display: "block", background: "#0e1117" }}
                    />
                  </div>
                )}
              </div>

              {/* Multimodal Diagnostic Evidence */}
              <div style={{ marginTop: "2rem" }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, fontFamily: "var(--font-heading)", marginBottom: "0.875rem" }}>
                  Multimodal Diagnostic Evidence
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                  {selectedDefect.evidenceRationale.map((rationale, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "0.875rem 1.125rem",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--theme-container)",
                        borderLeft: "3px solid var(--theme-on-surface)",
                        fontSize: "0.875rem",
                        lineHeight: 1.5,
                      }}
                    >
                      {rationale}
                    </div>
                  ))}
                </div>
              </div>

              {/* Source-File Localization */}
              <div style={{ marginTop: "2rem" }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, fontFamily: "var(--font-heading)", marginBottom: "0.75rem" }}>
                  Source File Localization
                </h3>
                <div className="omni-code-panel">
                  <div style={{ color: "var(--theme-on-surface-subtle)", marginBottom: "0.25rem" }}>
                    # Localized Target Source
                  </div>
                  <div>File: <span style={{ color: "var(--theme-accent-blue)", fontWeight: 600 }}>{selectedDefect.sourceFile}</span></div>
                  <div>Selector: <span style={{ color: "var(--theme-on-surface)", fontWeight: 600 }}>{selectedDefect.targetElement}</span></div>
                  <div>Target Route: <span style={{ color: "var(--theme-on-surface-variant)" }}>{selectedDefect.route}</span></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="omni-card" style={{ textAlign: "center", padding: "4rem" }}>
              <p>No defect selected.</p>
            </div>
          )}
        </div>

        {/* Right Column: Defects Selection List */}
        <div>
          <div className="omni-card" style={{ padding: "1.5rem" }}>
            <h2 className="omni-card-title" style={{ marginBottom: "0.25rem" }}>
              Detected UI Defects ({defects.length})
            </h2>
            <p className="omni-card-subtitle" style={{ marginBottom: "1.5rem" }}>
              Select a finding to inspect visual comparison
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              {defects.map((d) => {
                const isSelected = d.id === selectedDefect?.id;
                return (
                  <div
                    key={d.id}
                    onClick={() => setSelectedDefectId(d.id)}
                    style={{
                      padding: "1.125rem",
                      borderRadius: "var(--radius-sm)",
                      border: isSelected ? "1.5px solid var(--theme-on-surface)" : "1px solid var(--theme-outline)",
                      background: isSelected ? "var(--theme-container)" : "var(--theme-surface)",
                      cursor: "pointer",
                      transition: "all 140ms ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.375rem" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.9375rem", color: "var(--theme-on-surface)" }}>
                        {d.title}
                      </span>
                      <span className="omni-badge omni-badge-neutral" style={{ fontSize: "0.625rem" }}>
                        {(d.confidence * 100).toFixed(0)}%
                      </span>
                    </div>

                    <div style={{ fontSize: "0.8125rem", color: "var(--theme-on-surface-variant)", marginBottom: "0.625rem", lineHeight: 1.4 }}>
                      {d.description.slice(0, 95)}...
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem", color: "var(--theme-on-surface-subtle)" }}>
                      <span style={{ fontFamily: "var(--font-mono)" }}>{d.targetElement}</span>
                      <span className={`omni-badge ${d.severity === "critical" ? "omni-badge-danger" : "omni-badge-warning"}`}>
                        {d.severity}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="omni-card" style={{ marginTop: "1.5rem", background: "var(--theme-container)", border: "1px solid var(--theme-outline-variant)" }}>
            <h3 style={{ fontSize: "0.875rem", fontWeight: 600, fontFamily: "var(--font-heading)", marginBottom: "0.5rem" }}>
              Blind Diagnosis Assurance
            </h3>
            <p style={{ fontSize: "0.8125rem", color: "var(--theme-on-surface-variant)", lineHeight: 1.5 }}>
              Ground-truth scenario labels and defect injection parameters are isolated from model prompts, guaranteeing genuine blind inference.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
