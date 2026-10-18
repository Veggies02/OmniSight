import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useOmniSight } from "../../context/OmniSightContext";

export const OverviewPage: React.FC = () => {
  const { websites, defects, proposals, verifications, inspectionRuns, triggerInspection, isInspecting } = useOmniSight();
  const [selectedSiteId, setSelectedSiteId] = useState(websites[0]?.id || "");
  const [inspectMessage, setInspectMessage] = useState("");

  const pendingProposals = proposals.filter((p) => p.humanReviewStatus === "pending_review");
  const passedVerifications = verifications.filter((v) => v.finalState === "PASSED");

  const handleRunInspection = async () => {
    if (!selectedSiteId) return;
    setInspectMessage("Dispatching Playwright browser RPA worker...");
    await triggerInspection(selectedSiteId);
    setInspectMessage("Visual crawl completed. Diagnostic evidence recorded.");
    setTimeout(() => setInspectMessage(""), 4000);
  };

  return (
    <div>
      {/* Editorial Page Introduction */}
      <div className="omni-page-header" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: "2rem" }}>
        <div>
          <div className="omni-eyebrow">
            <span>Autonomous UI Engineering</span>
            <span>•</span>
            <span style={{ color: "var(--theme-success-text)" }}>System Healthy</span>
          </div>
          <h1 className="omni-title">
            Autonomous UI Self-Healing Center
          </h1>
          <p className="omni-description">
            Continuous multimodal UI defect detection, vision-language model diagnosis, and isolated Git worktree repair execution.
          </p>
        </div>

        {/* Primary Action Group */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <select
            className="omni-select"
            style={{ width: "auto", fontSize: "0.875rem", padding: "0.5rem 0.875rem" }}
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            disabled={isInspecting}
          >
            {websites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.environment})
              </option>
            ))}
          </select>
          <button
            onClick={handleRunInspection}
            disabled={isInspecting}
            className="omni-btn omni-btn-primary"
          >
            {isInspecting ? "Inspecting Target..." : "Initiate Visual Inspection"}
          </button>
        </div>
      </div>

      {inspectMessage && (
        <div style={{ marginBottom: "2rem", padding: "0.75rem 1.25rem", borderRadius: "var(--radius-sm)", background: "var(--theme-info-bg)", border: "1px solid var(--theme-info-border)", color: "var(--theme-info-text)", fontSize: "0.875rem" }}>
          {inspectMessage}
        </div>
      )}

      {/* Restrained Minimalist Metrics Band (Google DeepMind Style) */}
      <div className="omni-metrics-band omni-stats-grid">
        <div className="omni-metric-unit">
          <span className="omni-metric-label">MONITORED WEBSITES</span>
          <span className="omni-metric-val">{websites.length}</span>
          <span className="omni-metric-desc">Web applications under visual supervision</span>
        </div>

        <div className="omni-metric-unit">
          <span className="omni-metric-label">DETECTED DEFECTS</span>
          <span className="omni-metric-val" style={{ color: defects.length > 0 ? "var(--theme-danger-text)" : "inherit" }}>
            {defects.length}
          </span>
          <span className="omni-metric-desc">Visual regressions identified by VLM</span>
        </div>

        <div className="omni-metric-unit">
          <span className="omni-metric-label">PENDING APPROVAL</span>
          <span className="omni-metric-val" style={{ color: pendingProposals.length > 0 ? "var(--theme-warning-text)" : "inherit" }}>
            {pendingProposals.length}
          </span>
          <span className="omni-metric-desc">Proposals awaiting human sign-off</span>
        </div>

        <div className="omni-metric-unit">
          <span className="omni-metric-label">VERIFIED REPAIRS</span>
          <span className="omni-metric-val" style={{ color: "var(--theme-success-text)" }}>
            {passedVerifications.length}
          </span>
          <span className="omni-metric-desc">Validated with headless browser builds</span>
        </div>
      </div>

      {/* Main Content Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "3.5rem" }}>
        {/* Monitored Applications Section */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.25rem" }}>
            <div>
              <h2 className="omni-card-title" style={{ fontSize: "1.25rem" }}>Monitored Web Applications</h2>
              <p className="omni-card-subtitle">Active targets, environments, and recorded UI health</p>
            </div>
            <Link to="/dashboard/websites" className="omni-btn omni-btn-outline omni-btn-sm">
              Manage Targets →
            </Link>
          </div>

          <div className="omni-table-wrapper">
            <table className="omni-table">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Environment</th>
                  <th>Target URL</th>
                  <th>Status</th>
                  <th>Health Score</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {websites.map((site) => (
                  <tr key={site.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{site.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--theme-on-surface-subtle)", fontFamily: "var(--font-mono)", marginTop: "0.2rem" }}>
                        {site.targetRepo}
                      </div>
                    </td>
                    <td>
                      <span className="omni-badge omni-badge-neutral">{site.environment}</span>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>
                      <a href={site.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--theme-accent-blue)", textDecoration: "none" }}>
                        {site.url} ↗
                      </a>
                    </td>
                    <td>
                      {site.status === "healthy" ? (
                        <span className="omni-badge omni-badge-success">Clean Baseline</span>
                      ) : site.status === "inspecting" ? (
                        <span className="omni-badge omni-badge-info">Inspecting...</span>
                      ) : (
                        <span className="omni-badge omni-badge-danger">{site.activeDefectsCount} Active Defects</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{site.healthScore}%</span>
                        <div style={{ width: "80px", height: "4px", borderRadius: "var(--radius-pill)", background: "var(--theme-container-high)", overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${site.healthScore}%`,
                              height: "100%",
                              background: site.healthScore > 90 ? "var(--theme-success-text)" : site.healthScore > 75 ? "var(--theme-warning-text)" : "var(--theme-danger-text)",
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        onClick={() => triggerInspection(site.id)}
                        disabled={isInspecting}
                        className="omni-btn omni-btn-secondary omni-btn-sm"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Two-Column Section: Active Findings & Inspection Log */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "2.5rem" }}>
          {/* Recent Visual Findings */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.25rem" }}>
              <div>
                <h2 className="omni-card-title" style={{ fontSize: "1.25rem" }}>Recent UI Visual Defects</h2>
                <p className="omni-card-subtitle">AI diagnostic findings requiring code correction</p>
              </div>
              <Link to="/dashboard/analysis" className="omni-btn omni-btn-outline omni-btn-sm">
                Explore All →
              </Link>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {defects.slice(0, 3).map((defect) => (
                <div
                  key={defect.id}
                  style={{
                    padding: "1.25rem",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--theme-outline)",
                    backgroundColor: "var(--theme-surface)",
                    boxShadow: "var(--shadow-subtle)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ maxWidth: "70%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                      <span className={`omni-badge ${defect.severity === "critical" ? "omni-badge-danger" : "omni-badge-warning"}`}>
                        {defect.severity}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>{defect.title}</span>
                    </div>
                    <div style={{ fontSize: "0.8125rem", color: "var(--theme-on-surface-variant)", lineHeight: 1.5 }}>
                      {defect.description}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--theme-on-surface-subtle)", fontFamily: "var(--font-mono)", marginTop: "0.375rem" }}>
                      Route: {defect.route} • Selector: {defect.targetElement}
                    </div>
                  </div>

                  <Link to="/dashboard/analysis" className="omni-btn omni-btn-secondary omni-btn-sm">
                    Inspect Evidence
                  </Link>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Inspection Runs */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.25rem" }}>
              <div>
                <h2 className="omni-card-title" style={{ fontSize: "1.25rem" }}>Inspection Activity</h2>
                <p className="omni-card-subtitle">Recent automated crawl results</p>
              </div>
              <Link to="/dashboard/activity" className="omni-btn omni-btn-outline omni-btn-sm">
                Audit Trail →
              </Link>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {inspectionRuns.map((run) => (
                <div
                  key={run.runId}
                  style={{
                    padding: "1rem 1.25rem",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--theme-outline-variant)",
                    background: "var(--theme-container)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{run.websiteName}</span>
                    <span className="omni-badge omni-badge-success">{run.status}</span>
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--theme-on-surface-variant)", display: "flex", justifyContent: "space-between" }}>
                    <span>{new Date(run.timestamp).toLocaleTimeString()} ({run.durationSeconds}s)</span>
                    <span style={{ fontWeight: 600, color: run.defectsFound > 0 ? "var(--theme-danger-text)" : "var(--theme-success-text)" }}>
                      {run.defectsFound} defect(s) detected
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
