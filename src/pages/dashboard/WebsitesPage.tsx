import React, { useState } from "react";
import { useOmniSight } from "../../context/OmniSightContext";

export const WebsitesPage: React.FC = () => {
  const { websites, addWebsite, triggerInspection, isInspecting } = useOmniSight();
  const [showAddModal, setShowAddModal] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formRepo, setFormRepo] = useState("");
  const [formEnv, setFormEnv] = useState<"Production" | "Staging" | "Preview">("Preview");
  const [formRoutes, setFormRoutes] = useState("/\n/products\n/cart");
  const [formError, setFormError] = useState("");

  const handleCreateWebsite = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!formName.trim()) {
      setFormError("Website name is required.");
      return;
    }

    try {
      new URL(formUrl);
    } catch {
      setFormError("Please provide a valid URL starting with http:// or https://");
      return;
    }

    const parsedRoutes = formRoutes
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    addWebsite({
      name: formName.trim(),
      url: formUrl.trim(),
      targetRepo: formRepo.trim() || "local/unspecified",
      environment: formEnv,
      status: "healthy",
      monitoredRoutes: parsedRoutes.length > 0 ? parsedRoutes : ["/"],
    });

    setFormName("");
    setFormUrl("");
    setFormRepo("");
    setShowAddModal(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="omni-page-header" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: "2rem" }}>
        <div>
          <div className="omni-eyebrow">
            <span>Target Environment Registry</span>
          </div>
          <h1 className="omni-title">
            Monitored Websites
          </h1>
          <p className="omni-description">
            Register target web applications, define crawl routes, and inspect UI visual regression statuses.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="omni-btn omni-btn-primary"
        >
          + Add Target Website
        </button>
      </div>

      {/* Target Application Information Banner */}
      <div
        style={{
          padding: "1.25rem 1.75rem",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--theme-container)",
          border: "1px solid var(--theme-outline)",
          marginBottom: "2.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>Live Monitored Application: OmniShop Storefront</div>
          <div style={{ fontSize: "0.875rem", color: "var(--theme-on-surface-variant)", marginTop: "0.25rem" }}>
            Benchmark target application currently active on <code style={{ fontFamily: "var(--font-mono)", color: "var(--theme-on-surface)" }}>http://localhost:5173</code> with 4 seeded defect scenarios.
          </div>
        </div>
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="omni-btn omni-btn-outline omni-btn-sm"
        >
          Open Target Storefront ↗
        </a>
      </div>

      {/* Websites Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "2rem" }}>
        {websites.map((site) => (
          <div
            key={site.id}
            className="omni-card"
            style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
                <div>
                  <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.01em" }}>
                    {site.name}
                  </h3>
                  <a
                    href={site.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "0.8125rem", color: "var(--theme-accent-blue)", textDecoration: "none", fontFamily: "var(--font-mono)" }}
                  >
                    {site.url} ↗
                  </a>
                </div>
                <span
                  className={`omni-badge ${
                    site.status === "healthy"
                      ? "omni-badge-success"
                      : site.status === "inspecting"
                      ? "omni-badge-info"
                      : "omni-badge-danger"
                  }`}
                >
                  {site.status === "healthy"
                    ? "Healthy"
                    : site.status === "inspecting"
                    ? "Inspecting"
                    : `${site.activeDefectsCount} Defects`}
                </span>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
                <span className="omni-badge omni-badge-neutral">{site.environment}</span>
                <span className="omni-badge omni-badge-neutral" style={{ fontFamily: "var(--font-mono)" }}>
                  {site.targetRepo}
                </span>
              </div>

              <div style={{ fontSize: "0.8125rem", color: "var(--theme-on-surface-variant)", marginBottom: "1.25rem" }}>
                <span style={{ fontWeight: 600, color: "var(--theme-on-surface)" }}>Monitored Routes ({site.monitoredRoutes.length}):</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginTop: "0.5rem" }}>
                  {site.monitoredRoutes.map((route) => (
                    <span
                      key={route}
                      style={{
                        padding: "2px 8px",
                        borderRadius: "var(--radius-xs)",
                        background: "var(--theme-container)",
                        border: "1px solid var(--theme-outline)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.75rem",
                      }}
                    >
                      {route}
                    </span>
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.875rem 1rem",
                  background: "var(--theme-container)",
                  borderRadius: "var(--radius-sm)",
                  marginBottom: "1.5rem",
                  fontSize: "0.8125rem",
                }}
              >
                <div>
                  <div style={{ color: "var(--theme-on-surface-subtle)", fontSize: "0.75rem" }}>Last Crawl</div>
                  <div style={{ fontWeight: 600, color: "var(--theme-on-surface)" }}>
                    {site.lastInspectedAt === "Never" ? "Never" : new Date(site.lastInspectedAt).toLocaleTimeString()}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "var(--theme-on-surface-subtle)", fontSize: "0.75rem" }}>Health Score</div>
                  <div style={{ fontWeight: 700, fontSize: "1rem", color: site.healthScore > 90 ? "var(--theme-success-text)" : "var(--theme-danger-text)" }}>
                    {site.healthScore}%
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => triggerInspection(site.id)}
              disabled={isInspecting}
              className="omni-btn omni-btn-primary"
              style={{ width: "100%" }}
            >
              {isInspecting && site.status === "inspecting" ? "Running Playwright..." : "Start Visual Inspection"}
            </button>
          </div>
        ))}
      </div>

      {/* Add Website Modal */}
      {showAddModal && (
        <div className="omni-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="omni-modal" onClick={(e) => e.stopPropagation()}>
            <div className="omni-modal-header">
              <h2 className="omni-card-title">Add Monitored Web Application</h2>
              <p className="omni-card-subtitle">Register a web application for automated Playwright visual inspection</p>
            </div>

            {formError && (
              <div style={{ padding: "0.75rem 1rem", borderRadius: "var(--radius-sm)", background: "var(--theme-danger-bg)", border: "1px solid var(--theme-danger-border)", color: "var(--theme-danger-text)", fontSize: "0.8125rem", marginBottom: "1.25rem" }}>
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateWebsite}>
              <div className="omni-form-group">
                <label className="omni-label">Application Name *</label>
                <input
                  type="text"
                  className="omni-input"
                  placeholder="e.g. Acme Customer Portal"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                />
              </div>

              <div className="omni-form-group">
                <label className="omni-label">Target URL *</label>
                <input
                  type="url"
                  className="omni-input"
                  placeholder="http://localhost:3000 or https://..."
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  required
                />
              </div>

              <div className="omni-form-group">
                <label className="omni-label">Git Repository Path</label>
                <input
                  type="text"
                  className="omni-input"
                  placeholder="e.g. org/repo-name"
                  value={formRepo}
                  onChange={(e) => setFormRepo(e.target.value)}
                />
              </div>

              <div className="omni-form-group">
                <label className="omni-label">Target Environment</label>
                <select
                  className="omni-select"
                  value={formEnv}
                  onChange={(e) => setFormEnv(e.target.value as any)}
                >
                  <option value="Preview">Preview</option>
                  <option value="Staging">Staging</option>
                  <option value="Production">Production</option>
                </select>
              </div>

              <div className="omni-form-group">
                <label className="omni-label">Monitored Routes (one per line)</label>
                <textarea
                  className="omni-textarea"
                  rows={3}
                  value={formRoutes}
                  onChange={(e) => setFormRoutes(e.target.value)}
                />
              </div>

              <div className="omni-modal-actions">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="omni-btn omni-btn-outline"
                >
                  Cancel
                </button>
                <button type="submit" className="omni-btn omni-btn-primary">
                  Save & Register
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
