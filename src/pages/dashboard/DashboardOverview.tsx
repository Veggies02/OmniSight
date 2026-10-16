import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  EmptyState,
  LoadingState,
  type BadgeStatus,
} from "../../components/dashboard";

interface DemoJob {
  id: string;
  application: string;
  targetRoute: string;
  startedAt: string;
  status: BadgeStatus;
  defectsCount: number;
  defectsSummary: string;
  duration: string;
}

const INITIAL_DEMO_JOBS: DemoJob[] = [
  {
    id: "JOB-1084",
    application: "OmniShop Storefront",
    targetRoute: "/products",
    startedAt: "8 mins ago",
    status: "running",
    defectsCount: 0,
    defectsSummary: "Analysis in progress",
    duration: "42s",
  },
  {
    id: "JOB-1083",
    application: "OmniShop Storefront",
    targetRoute: "/checkout",
    startedAt: "24 mins ago",
    status: "failed",
    defectsCount: 2,
    defectsSummary: "2 layout overflow faults",
    duration: "1m 18s",
  },
  {
    id: "JOB-1082",
    application: "OmniShop Storefront",
    targetRoute: "/cart",
    startedAt: "1 hour ago",
    status: "needs-review",
    defectsCount: 1,
    defectsSummary: "1 contrast regression (fix ready)",
    duration: "54s",
  },
  {
    id: "JOB-1081",
    application: "OmniShop Storefront",
    targetRoute: "/",
    startedAt: "3 hours ago",
    status: "passed",
    defectsCount: 0,
    defectsSummary: "Clean visual scan",
    duration: "1m 02s",
  },
  {
    id: "JOB-1080",
    application: "OmniShop Storefront",
    targetRoute: "/products/1",
    startedAt: "5 hours ago",
    status: "passed",
    defectsCount: 0,
    defectsSummary: "Clean visual scan",
    duration: "48s",
  },
  {
    id: "JOB-1079",
    application: "OmniShop Storefront",
    targetRoute: "/checkout",
    startedAt: "Yesterday",
    status: "passed",
    defectsCount: 0,
    defectsSummary: "Clean visual scan",
    duration: "1m 12s",
  },
];

export function DashboardOverview() {
  const [jobs] = useState<DemoJob[]>(INITIAL_DEMO_JOBS);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>("Just now");
  const [selectedJobForModal, setSelectedJobForModal] = useState<DemoJob | null>(null);
  const [simulateEmpty, setSimulateEmpty] = useState(false);

  // Refresh handler (refreshes state and updates timestamp without calling real backend)
  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      const now = new Date();
      setLastRefreshed(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
    }, 450);
  };

  // Filter jobs based on search query, status, and empty simulation
  const filteredJobs = useMemo(() => {
    if (simulateEmpty) return [];

    return jobs.filter((job) => {
      const matchesSearch =
        job.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.application.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.targetRoute.toLowerCase().includes(searchQuery.toLowerCase());

      const normalizedStatus = job.status.toLowerCase().replace(/[\s_]+/g, "-");
      const matchesStatus =
        selectedStatusFilter === "all" || normalizedStatus === selectedStatusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [jobs, searchQuery, selectedStatusFilter, simulateEmpty]);

  // Compute status distribution counts
  const statusCounts = useMemo(() => {
    const counts = {
      passed: 0,
      failed: 0,
      needsReview: 0,
      running: 0,
      pending: 0,
    };

    const targetList = simulateEmpty ? [] : jobs;
    targetList.forEach((j) => {
      const norm = j.status.toLowerCase().replace(/[\s_]+/g, "-");
      if (norm === "passed") counts.passed += 1;
      else if (norm === "failed") counts.failed += 1;
      else if (norm === "needs-review") counts.needsReview += 1;
      else if (norm === "running") counts.running += 1;
      else counts.pending += 1;
    });

    const total = targetList.length || 1; // avoid divide by zero
    return {
      counts,
      total: targetList.length,
      percentages: {
        passed: Math.round((counts.passed / total) * 100),
        failed: Math.round((counts.failed / total) * 100),
        needsReview: Math.round((counts.needsReview / total) * 100),
        running: Math.round((counts.running / total) * 100),
        pending: Math.round((counts.pending / total) * 100),
      },
    };
  }, [jobs, simulateEmpty]);

  return (
    <div className="dashboard-overview-page">
      {/* ==================================================================
          Section A: Page Header
          ================================================================== */}
      <PageHeader
        badge={<span className="hero-pill">P4 Workstream • QA Platform</span>}
        title="QA Overview"
        description="Monitor UI inspections, detected defects, and repair progress."
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <span className="dash-meta-badge" title="Demo dataset update tracker">
              <span className="status-dot-pulse" style={{ width: 5, height: 5 }} aria-hidden="true" />
              <span>Updated: {lastRefreshed}</span>
            </span>

            <button
              type="button"
              className={`dash-header-btn ${isRefreshing ? "is-refreshing" : ""}`}
              onClick={handleRefresh}
              aria-label="Refresh overview demo data"
              title="Refresh simulated metrics"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="btn-refresh-icon" aria-hidden="true">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
              <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
            </button>

            <button
              type="button"
              className={`filter-pill-btn ${simulateEmpty ? "active" : ""}`}
              onClick={() => setSimulateEmpty(!simulateEmpty)}
              title="Toggle empty state demonstration"
            >
              {simulateEmpty ? "Show Demo Data" : "Simulate Empty"}
            </button>
          </div>
        }
      />

      {/* Refreshing Indicator */}
      {isRefreshing && (
        <div style={{ marginBottom: "1.25rem" }}>
          <LoadingState inline message="Refreshing inspection telemetry..." />
        </div>
      )}

      {/* ==================================================================
          Section B: Summary Metric Cards (4 Cards)
          ================================================================== */}
      <section className="dash-telemetry-grid" aria-label="QA Summary Metrics">
        <StatCard
          label="Total Inspections"
          value={simulateEmpty ? "0" : "24"}
          subtext="Simulated suite executions"
          variant="default"
          trend={simulateEmpty ? undefined : { direction: "up", text: "+12% this week" }}
          badge={<span className="stat-card-badge" style={{ color: "var(--color-text-muted)" }}>Demo</span>}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z" />
              <path d="M12 11h4" />
              <path d="M12 16h4" />
              <path d="M8 11h.01" />
              <path d="M8 16h.01" />
            </svg>
          }
        />

        <StatCard
          label="Passed Inspections"
          value={simulateEmpty ? "0" : "18"}
          subtext="75% visual stability"
          variant="success"
          trend={simulateEmpty ? undefined : { direction: "up", text: "3 consecutive clean" }}
          badge={<StatusBadge status="passed" size="sm" />}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          }
        />

        <StatCard
          label="Defects Detected"
          value={simulateEmpty ? "0" : "4"}
          subtext="2 layout, 2 contrast"
          variant="warning"
          trend={simulateEmpty ? undefined : { direction: "down", text: "-2 resolved" }}
          badge={<StatusBadge status="failed" size="sm" />}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" x2="12" y1="8" y2="12" />
              <line x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
          }
        />

        <StatCard
          label="Pending Reviews"
          value={simulateEmpty ? "0" : "2"}
          subtext="Self-healing fixes staged"
          variant="accent"
          trend={simulateEmpty ? undefined : { direction: "neutral", text: "Awaiting triage" }}
          badge={<StatusBadge status="needs-review" size="sm" />}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          }
        />
      </section>

      {/* ==================================================================
          Section D: Status Visualization (Bespoke Segmented Distribution Bar)
          ================================================================== */}
      <section className="dash-panel" style={{ marginBottom: "2rem" }} aria-label="Status Distribution">
        <div className="dash-panel-header">
          <h3 className="dash-panel-title">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <span>Inspection Status Distribution</span>
          </h3>
          <span className="dash-panel-badge">
            {simulateEmpty ? "0 Total Runs" : `${statusCounts.total} Sample Runs`}
          </span>
        </div>

        <div className="status-dist-container">
          {simulateEmpty ? (
            <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", margin: 0 }}>
              No inspection runs recorded to visualize.
            </p>
          ) : (
            <>
              {/* Stacked Multi-Color Segmented Bar */}
              <div className="status-dist-bar" role="progressbar" aria-label="Status distribution percentage">
                <div
                  className="status-dist-segment passed"
                  style={{ width: `${statusCounts.percentages.passed}%` }}
                  title={`Passed: ${statusCounts.percentages.passed}%`}
                />
                <div
                  className="status-dist-segment running"
                  style={{ width: `${statusCounts.percentages.running}%` }}
                  title={`Running: ${statusCounts.percentages.running}%`}
                />
                <div
                  className="status-dist-segment needs-review"
                  style={{ width: `${statusCounts.percentages.needsReview}%` }}
                  title={`Needs Review: ${statusCounts.percentages.needsReview}%`}
                />
                <div
                  className="status-dist-segment failed"
                  style={{ width: `${statusCounts.percentages.failed}%` }}
                  title={`Failed: ${statusCounts.percentages.failed}%`}
                />
              </div>

              {/* Status Legend with Counts & Percentages */}
              <div className="status-dist-legend">
                <div className="status-dist-legend-item">
                  <span className="legend-color-dot passed" aria-hidden="true" />
                  <span>Passed:</span>
                  <span className="legend-count">{statusCounts.counts.passed} ({statusCounts.percentages.passed}%)</span>
                </div>
                <div className="status-dist-legend-item">
                  <span className="legend-color-dot running" aria-hidden="true" />
                  <span>Running:</span>
                  <span className="legend-count">{statusCounts.counts.running} ({statusCounts.percentages.running}%)</span>
                </div>
                <div className="status-dist-legend-item">
                  <span className="legend-color-dot needs-review" aria-hidden="true" />
                  <span>Needs Review:</span>
                  <span className="legend-count">{statusCounts.counts.needsReview} ({statusCounts.percentages.needsReview}%)</span>
                </div>
                <div className="status-dist-legend-item">
                  <span className="legend-color-dot failed" aria-hidden="true" />
                  <span>Failed:</span>
                  <span className="legend-count">{statusCounts.counts.failed} ({statusCounts.percentages.failed}%)</span>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ==================================================================
          Section C: Recent Inspection Jobs Table
          ================================================================== */}
      <section className="dash-panel" style={{ marginBottom: "2rem" }} aria-label="Recent Inspection Jobs">
        <div className="dash-panel-header">
          <h3 className="dash-panel-title">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z" />
            </svg>
            <span>Recent Inspection Jobs</span>
          </h3>
          <span className="dash-panel-badge">Mock / Demo Dataset</span>
        </div>

        {/* Toolbar: Search & Status Filters */}
        <div className="dash-table-toolbar">
          <input
            type="search"
            className="dash-search-input"
            placeholder="Search by Job ID, route..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search inspection jobs"
          />

          <div className="dash-filter-group" role="group" aria-label="Status filter buttons">
            {[
              { id: "all", label: "All" },
              { id: "running", label: "Running" },
              { id: "passed", label: "Passed" },
              { id: "failed", label: "Failed" },
              { id: "needs-review", label: "Needs Review" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`filter-pill-btn ${selectedStatusFilter === f.id ? "active" : ""}`}
                onClick={() => setSelectedStatusFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* ================================================================
            Section E: Empty State when no jobs match
            ================================================================ */}
        {filteredJobs.length === 0 ? (
          <EmptyState
            title="No Inspection Jobs Found"
            description={
              simulateEmpty
                ? "The demo empty state is currently active. Click 'Show Demo Data' to display sample inspection jobs."
                : "No jobs match your current search or status filter criteria. Try resetting the filter to view all runs."
            }
            action={{
              label: simulateEmpty ? "Restore Demo Data" : "Clear Filters",
              onClick: () => {
                setSimulateEmpty(false);
                setSearchQuery("");
                setSelectedStatusFilter("all");
              },
            }}
          />
        ) : (
          /* Responsive Table */
          <div className="dash-table-wrapper">
            <table className="dash-table" aria-label="Inspection jobs table">
              <thead>
                <tr>
                  <th scope="col">Job ID</th>
                  <th scope="col">Application</th>
                  <th scope="col">Started At</th>
                  <th scope="col">Status</th>
                  <th scope="col">Defects Found</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => (
                  <tr key={job.id}>
                    {/* Job ID */}
                    <td className="job-id-cell">
                      <span>#{job.id}</span>
                    </td>

                    {/* Application */}
                    <td>
                      <div className="job-app-tag">
                        <span>{job.application}</span>
                        <code style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                          ({job.targetRoute})
                        </code>
                      </div>
                    </td>

                    {/* Started At */}
                    <td className="job-time-cell">
                      <span>{job.startedAt}</span>
                    </td>

                    {/* Status Badge */}
                    <td>
                      <StatusBadge status={job.status} size="sm" />
                    </td>

                    {/* Defects Found */}
                    <td>
                      <div
                        className={`defects-count-tag ${
                          job.defectsCount > 0 ? "has-defects" : "clean"
                        }`}
                      >
                        {job.defectsCount > 0 ? (
                          <>
                            <span aria-hidden="true">⚠️</span>
                            <span>{job.defectsSummary}</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true">✓</span>
                            <span>0 defects (clean)</span>
                          </>
                        )}
                      </div>
                    </td>

                    {/* Action */}
                    <td>
                      <button
                        type="button"
                        className="table-action-btn"
                        onClick={() => setSelectedJobForModal(job)}
                        aria-label={`View details for ${job.id}`}
                      >
                        <span>View Details</span>
                        <span aria-hidden="true">→</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ==================================================================
          Section F: Architecture & Roadmap Status
          ================================================================== */}
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
              <span className="roadmap-indicator done">✓</span>
              <span>Day 3: Reusable UI Components</span>
            </div>
            <div className="roadmap-step">
              <span className="roadmap-indicator active">●</span>
              <span><strong>Day 4: QA Dashboard Overview</strong></span>
            </div>
            <div className="roadmap-step">
              <span className="roadmap-indicator pending">5</span>
              <span>Days 5–7: Job History & Mock Adapters</span>
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

      {/* ==================================================================
          View Details Modal Placeholder
          ================================================================== */}
      {selectedJobForModal && (
        <div
          className="job-details-modal-backdrop"
          onClick={() => setSelectedJobForModal(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-job-title"
        >
          <div className="job-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h4 id="modal-job-title" className="modal-title">
                Job Details: #{selectedJobForModal.id}
              </h4>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedJobForModal(null)}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>

            <div className="modal-meta-row">
              <span>App: {selectedJobForModal.application}</span>
              <span>•</span>
              <span>Route: {selectedJobForModal.targetRoute}</span>
              <span>•</span>
              <StatusBadge status={selectedJobForModal.status} size="sm" />
            </div>

            <div className="modal-notice-box">
              <strong>Roadmap Milestone Indicator:</strong>
              <p style={{ marginTop: "0.35rem", marginBottom: 0 }}>
                Granular inspection job details, Playwright browser traces, VLM bounding boxes, and screenshot evidence will be implemented in subsequent milestones (Days 5–10).
              </p>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" }}>
              <button
                type="button"
                className="empty-state-btn secondary"
                onClick={() => setSelectedJobForModal(null)}
              >
                Close
              </button>
              <Link
                to="/qa/jobs"
                className="empty-state-btn primary"
                onClick={() => setSelectedJobForModal(null)}
              >
                Go to Jobs Route
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
