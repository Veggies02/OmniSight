import React from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useOmniSight } from "../../context/OmniSightContext";

export const OmniSightShell: React.FC = () => {
  const { isInspecting, proposals, defects, theme, toggleTheme } = useOmniSight();
  const pendingCount = proposals.filter((p) => p.humanReviewStatus === "pending_review").length;
  const activeDefectsCount = defects.filter((d) => d.status !== "dismissed").length;

  return (
    <div className="omni-shell">
      {/* Top Editorial Info Bar */}
      <div className="omni-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontWeight: 600, color: "var(--theme-on-surface)" }}>Platform v1.0</span>
          <span>•</span>
          <span>Autonomous UI Visual Verification & RPA Repair</span>
          {isInspecting && (
            <span className="omni-badge omni-badge-info" style={{ marginLeft: "0.5rem" }}>
              Inspection Active
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
          <Link to="/" className="omni-topbar-link" target="_blank" rel="noopener noreferrer">
            <span>Target Storefront</span>
            <span aria-hidden="true">↗</span>
          </Link>
          <span style={{ color: "var(--theme-outline)" }}>|</span>
          <a
            href="http://localhost:8000/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="omni-topbar-link"
          >
            <span>FastAPI Specs</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      {/* Main Clean Header */}
      <header className="omni-header">
        <div className="omni-header-container">
          <Link to="/dashboard" className="omni-brand" aria-label="OmniSight Platform Dashboard">
            <div className="omni-brand-logo">Ω</div>
            <span className="omni-brand-name">OmniSight</span>
            <div className="omni-brand-divider" />
            <span className="omni-brand-tagline">AI UI Self-Healing</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="omni-nav" aria-label="Main Platform Navigation">
            <NavLink
              to="/dashboard"
              end
              className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}
            >
              Overview
            </NavLink>
            <NavLink
              to="/dashboard/websites"
              className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}
            >
              Websites
            </NavLink>
            <NavLink
              to="/dashboard/analysis"
              className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}
            >
              <span>AI Diagnosis</span>
              {activeDefectsCount > 0 && (
                <span className="omni-nav-badge" style={{ backgroundColor: "var(--theme-danger-text)" }}>
                  {activeDefectsCount}
                </span>
              )}
            </NavLink>
            <NavLink
              to="/dashboard/repairs"
              className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}
            >
              <span>Repair Center</span>
              {pendingCount > 0 && (
                <span className="omni-nav-badge">{pendingCount}</span>
              )}
            </NavLink>
            <NavLink
              to="/dashboard/verification"
              className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}
            >
              Verification
            </NavLink>
            <NavLink
              to="/dashboard/activity"
              className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}
            >
              Audit Logs
            </NavLink>
          </nav>

          {/* Header Action Button */}
          <div className="omni-header-actions">
            <button
              onClick={toggleTheme}
              className="omni-btn omni-btn-outline omni-btn-sm"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
            <Link
              to="/review"
              className="omni-btn omni-btn-outline omni-btn-sm"
              title="Open Operator Review Dashboard"
            >
              Operator Review ↗
            </Link>
          </div>
        </div>

        {/* Mobile Navigation Row */}
        <div className="omni-mobile-nav">
          <NavLink to="/dashboard" end className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}>
            Overview
          </NavLink>
          <NavLink to="/dashboard/websites" className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}>
            Websites
          </NavLink>
          <NavLink to="/dashboard/analysis" className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}>
            Diagnosis
          </NavLink>
          <NavLink to="/dashboard/repairs" className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}>
            Repairs
          </NavLink>
          <NavLink to="/dashboard/verification" className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}>
            Verification
          </NavLink>
          <NavLink to="/dashboard/activity" className={({ isActive }) => `omni-nav-link ${isActive ? "active" : ""}`}>
            Logs
          </NavLink>
        </div>
      </header>

      {/* Main Page Content */}
      <main className="omni-container">
        <Outlet />
      </main>

      {/* Subtle Editorial Footer */}
      <footer style={{ borderTop: "1px solid var(--theme-outline)", padding: "2.5rem 2rem", background: "var(--theme-surface)", marginTop: "auto" }}>
        <div style={{ maxWidth: "var(--container-max-width)", margin: "0 auto", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "1.5rem", fontSize: "0.875rem", color: "var(--theme-on-surface-variant)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontWeight: 600, color: "var(--theme-on-surface)" }}>OmniSight</span>
            <span>—</span>
            <span>Multimodal UI Self-Healing & Visual Verification Platform</span>
          </div>
          <div style={{ display: "flex", gap: "1.75rem", fontSize: "0.8125rem" }}>
            <a href="https://github.com/Veggies02/OmniSight" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
              GitHub Repository
            </a>
            <span>•</span>
            <span>FastAPI Architecture</span>
            <span>•</span>
            <span>VLM Visual Models</span>
            <span>•</span>
            <span>Worktree Verification</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
