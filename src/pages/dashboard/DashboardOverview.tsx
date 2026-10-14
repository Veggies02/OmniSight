import { useState } from "react";
import { Link } from "react-router-dom";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  LoadingState,
  ErrorState,
} from "../../components/dashboard";

export function DashboardOverview() {
  const [demoState, setDemoState] = useState<"none" | "loading" | "error">("none");

  // Baseline telemetry metrics
  const telemetryStats = [
    {
      label: "Inspection Runs",
      value: "0",
      subtext: "Baseline ready for runner",
      variant: "default" as const,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      ),
    },
    {
      label: "Active Defects",
      value: "0",
      subtext: "No visual regressions logged",
      variant: "default" as const,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      variant: "default" as const,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      ),
    },
    {
      label: "Draft Pull Requests",
      value: "0",
      subtext: "GitHub integration configured",
      variant: "default" as const,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      {/* 1. Reusable PageHeader Demonstration */}
      <PageHeader
        badge={<span className="hero-pill">P4 Workstream • QA Platform</span>}
        title="Welcome to OmniSight QA Dashboard"
        description="OmniSight is an AI-assisted UI inspection and self-healing system. This dashboard serves as the central command center to monitor automated visual inspections, triage vision-detected defects, inspect patch validation outcomes, and dispatch automated draft pull requests."
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link to="/qa/jobs" className="empty-state-btn primary">
              Explore Jobs →
            </Link>
            <Link to="/" className="empty-state-btn secondary">
              Target App
            </Link>
          </div>
        }
      />

      {/* 2. Reusable StatCard Demonstration: Baseline Metrics */}
      <section className="dash-telemetry-grid" aria-label="System Metrics">
        {telemetryStats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            subtext={stat.subtext}
            icon={stat.icon}
            variant={stat.variant}
          />
        ))}
      </section>

      {/* 3. Reusable Component Showcase (Mock / Demo Data) */}
      <section className="dash-panel" style={{ marginBottom: "2rem" }} aria-label="Component Demonstrations">
        <div className="dash-panel-header">
          <h3 className="dash-panel-title">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
              <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
              <path d="M7 21h10" />
              <path d="M12 3v18" />
              <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
            </svg>
            <span>Component Showcase (Day 3 Library • Mock / Demo Data)</span>
          </h3>
          <span className="dash-panel-badge">Design System Preview</span>
        </div>

        {/* StatusBadge Component Demo */}
        <div style={{ marginBottom: "1.5rem" }}>
          <h4 style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            StatusBadge Indicators
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <StatusBadge status="running" label="Inspection Running" />
            <StatusBadge status="passed" label="Validation Passed" />
            <StatusBadge status="failed" label="Defect Detected" />
            <StatusBadge status="needs-review" label="Needs Review" />
            <StatusBadge status="pending" label="Queued Job" />
          </div>
        </div>

        {/* StatCard Variants with Trends & Badges Demo */}
        <div style={{ marginBottom: "1.5rem" }}>
          <h4 style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            StatCard Variants with Trends (Sample Data)
          </h4>
          <div className="dash-telemetry-grid" style={{ marginBottom: 0 }}>
            <StatCard
              label="UI Pass Rate"
              value="94.2%"
              variant="success"
              trend={{ direction: "up", text: "+2.4% vs last run" }}
              subtext="Demo target metrics"
              badge={<StatusBadge status="passed" size="sm" />}
            />
            <StatCard
              label="Visual Regressions"
              value="3"
              variant="warning"
              trend={{ direction: "down", text: "-1 resolved" }}
              subtext="Demo defect triage"
              badge={<StatusBadge status="needs-review" size="sm" />}
            />
            <StatCard
              label="Self-Heal Success"
              value="87%"
              variant="accent"
              trend={{ direction: "up", text: "+5% automated" }}
              subtext="AST patch verification"
              badge={<StatusBadge status="running" size="sm" />}
            />
            <StatCard
              label="Unresolved Errors"
              value="1"
              variant="danger"
              trend={{ direction: "neutral", text: "Requires human review" }}
              subtext="Demo failure state"
              badge={<StatusBadge status="failed" size="sm" />}
            />
          </div>
        </div>

        {/* Interactive LoadingState and ErrorState Preview */}
        <div>
          <h4 style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Interactive State Previews
          </h4>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button
              type="button"
              className={`empty-state-btn ${demoState === "none" ? "primary" : "secondary"}`}
              onClick={() => setDemoState("none")}
            >
              Default
            </button>
            <button
              type="button"
              className={`empty-state-btn ${demoState === "loading" ? "primary" : "secondary"}`}
              onClick={() => setDemoState("loading")}
            >
              Preview LoadingState
            </button>
            <button
              type="button"
              className={`empty-state-btn ${demoState === "error" ? "primary" : "secondary"}`}
              onClick={() => setDemoState("error")}
            >
              Preview ErrorState
            </button>
          </div>

          {demoState === "loading" && (
            <LoadingState
              message="Fetching inspection job telemetry..."
              description="Demonstrating reusable LoadingState component with polite status accessibility."
            />
          )}

          {demoState === "error" && (
            <ErrorState
              title="Failed to synchronize with backend"
              message="Simulating ErrorState component: The FastAPI orchestrator service is currently in progress."
              details="Error: ECONNREFUSED 127.0.0.1:8000/api/jobs (Demo simulated error trace)"
              onRetry={() => setDemoState("none")}
              retryLabel="Reset Demo"
            />
          )}
        </div>
      </section>

      {/* 4. Architecture & Roadmap Section */}
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
              <span className="roadmap-indicator done">✓</span>
              <span>Day 2: Application Shell & Nav</span>
            </div>
            <div className="roadmap-step">
              <span className="roadmap-indicator active">●</span>
              <span><strong>Day 3: Reusable UI Components</strong></span>
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
