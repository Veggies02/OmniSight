import { Link } from "react-router-dom";

export function DashboardOverview() {
  const telemetryStats = [
    {
      label: "Inspection Runs",
      value: "0",
      subtext: "Baseline ready for runner",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      ),
    },
    {
      label: "Active Defects",
      value: "0",
      subtext: "No visual regressions logged",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </svg>
      ),
    },
    {
      label: "Proposed Patches",
      value: "0",
      subtext: "Self-healing pipeline standby",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      ),
    },
    {
      label: "Draft Pull Requests",
      value: "0",
      subtext: "GitHub integration configured",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M13 6h3a2 2 0 0 1 2 2v7" />
          <line x1="6" x2="6" y1="9" y2="21" />
        </svg>
      ),
    },
  ];

  return (
    <div className="dashboard-overview-page">
      {/* Welcoming Overview Hero */}
      <section className="dash-welcome-hero" aria-labelledby="overview-heading">
        <span className="hero-pill">P4 Workstream • QA Platform</span>
        <h2 id="overview-heading" className="dash-welcome-title">
          Welcome to OmniSight QA Dashboard
        </h2>
        <p className="dash-welcome-subtitle">
          OmniSight is an AI-assisted UI inspection and self-healing system. This dashboard serves as the central command center to monitor automated visual inspections, triage vision-detected defects, inspect patch validation outcomes, and dispatch automated draft pull requests.
        </p>
      </section>

      {/* Telemetry Metrics */}
      <section className="dash-telemetry-grid" aria-label="System Metrics">
        {telemetryStats.map((stat) => (
          <div key={stat.label} className="telemetry-card">
            <div className="telemetry-card-top">
              <span className="telemetry-label">{stat.label}</span>
              {stat.icon}
            </div>
            <span className="telemetry-value">{stat.value}</span>
            <span className="telemetry-subtext">{stat.subtext}</span>
          </div>
        ))}
      </section>

      {/* Architecture & Roadmap Section */}
      <section className="dash-status-section" aria-label="Architecture Status">
        <div className="dash-panel">
          <div className="dash-panel-header">
            <h3 className="dash-panel-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <span>Integrated Workstreams & Boundaries</span>
            </h3>
            <span className="dash-panel-badge">Multi-Workstream Architecture</span>
          </div>

          <div className="workstream-list">
            <div className="workstream-item">
              <span className="workstream-tag">P1</span>
              <div className="workstream-body">
                <span className="workstream-title">Mock E-Commerce Application (OmniShop)</span>
                <span className="workstream-desc">
                  Baseline storefront target for automated browser runs and defect injection. (Assigned: Ajay)
                </span>
              </div>
            </div>

            <div className="workstream-item">
              <span className="workstream-tag">P2</span>
              <div className="workstream-body">
                <span className="workstream-title">AI Engine & Vision-Language Model</span>
                <span className="workstream-desc">
                  Playwright screenshot analysis, visual defect localization, and AST code patch synthesis. (Assigned: Yuvaraj)
                </span>
              </div>
            </div>

            <div className="workstream-item">
              <span className="workstream-tag">P3</span>
              <div className="workstream-body">
                <span className="workstream-title">FastAPI Backend & Orchestrator</span>
                <span className="workstream-desc">
                  Shared API service managing jobs, pipeline execution, and result persistence. (Assigned: Shilpa)
                </span>
              </div>
            </div>

            <div className="workstream-item">
              <span className="workstream-tag p4">P4</span>
              <div className="workstream-body">
                <span className="workstream-title">QA Dashboard & GitHub Integration (Active)</span>
                <span className="workstream-desc">
                  Human-in-the-loop triage console, screenshot diff explorer, validation review, and automated draft PR creation.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Roadmap tracker */}
        <div className="dash-panel">
          <div className="dash-panel-header">
            <h3 className="dash-panel-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Implementation Roadmap</span>
            </h3>
            <span className="dash-panel-badge">20-Day Plan</span>
          </div>

          <div className="roadmap-list">
            <div className="roadmap-step">
              <span className="roadmap-indicator done">✓</span>
              <span>Day 1: Setup & Architecture Docs</span>
            </div>
            <div className="roadmap-step">
              <span className="roadmap-indicator active">●</span>
              <span><strong>Day 2: Application Shell & Nav</strong></span>
            </div>
            <div className="roadmap-step">
              <span className="roadmap-indicator pending">3</span>
              <span>Day 3: Design Tokens & Layout Grid</span>
            </div>
            <div className="roadmap-step">
              <span className="roadmap-indicator pending">4</span>
              <span>Days 4–7: Job History & Mock Adapters</span>
            </div>
            <div className="roadmap-step">
              <span className="roadmap-indicator pending">8</span>
              <span>Days 8–14: Defect Findings & Diff Visualizer</span>
            </div>
            <div className="roadmap-step">
              <span className="roadmap-indicator pending">15</span>
              <span>Days 15–20: Validation Review & PR Workflows</span>
            </div>
          </div>

          <div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--dash-card-border)" }}>
            <Link
              to="/qa/jobs"
              className="sidebar-link active"
              style={{ justifyContent: "center", borderRadius: "var(--radius-sm)", borderLeft: "none" }}
            >
              <span>Explore Inspection Jobs →</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
