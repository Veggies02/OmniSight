import { useState } from "react";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  DefectFindingsReview,
} from "../../components/dashboard";
import {
  getAllDefectFindings,
  getAllEvidence,
} from "../../data/mockJobs";

export function DashboardDefects() {
  const [refreshKey, setRefreshKey] = useState(0);

  // Retrieve mock defect findings and evidence registry
  const allDefects = getAllDefectFindings();
  const allEvidence = getAllEvidence();

  // Metrics calculation
  const totalFindings = allDefects.length;
  const criticalOrHighCount = allDefects.filter(
    (d) => d.severity === "critical" || d.severity === "high" || d.severity === "major"
  ).length;
  const underReviewCount = allDefects.filter(
    (d) => d.status === "under-review" || d.status === "pending-review"
  ).length;
  const resolvedOrStagedCount = allDefects.filter(
    (d) => d.status === "resolved" || d.status === "fix-staged"
  ).length;

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="dashboard-defects-page" key={refreshKey}>
      {/* 1. Page Header */}
      <PageHeader
        title="Defect Findings & Review"
        description="Review detected visual discrepancies, triage severity, inspect affected UI components, and explore staged screenshot and trace evidence across all test runs."
        badge={<StatusBadge status="needs-review" label={`${totalFindings} Active Findings`} />}
        actions={
          <button
            type="button"
            className="filter-pill-btn"
            onClick={handleRefresh}
            title="Refresh mock defect findings"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            <span>Refresh Findings</span>
          </button>
        }
      />

      {/* 2. Triage Summary StatCards */}
      <section className="dash-metrics-grid" aria-label="Defect triage summary">
        <StatCard
          label="Total Findings"
          value={totalFindings}
          subtext="Detected across all runs"
          variant="default"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="telemetry-icon"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          }
        />

        <StatCard
          label="Critical & High"
          value={criticalOrHighCount}
          subtext="Urgent resolution needed"
          variant="danger"
          badge={<span className="stat-card-badge" style={{ color: "#ef4444" }}>P0 / P1</span>}
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="telemetry-icon"
              aria-hidden="true"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          }
        />

        <StatCard
          label="Under Review"
          value={underReviewCount}
          subtext="Awaiting team triage"
          variant="warning"
          badge={<span className="stat-card-badge" style={{ color: "#f59e0b" }}>In Review</span>}
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="telemetry-icon"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
        />

        <StatCard
          label="Fix Staged / Resolved"
          value={resolvedOrStagedCount}
          subtext="Self-healing PRs or verified"
          variant="success"
          badge={<span className="stat-card-badge" style={{ color: "#10b981" }}>Healing</span>}
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="telemetry-icon"
              aria-hidden="true"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          }
        />
      </section>

      {/* 3. Reusable Defect Findings Review Section */}
      <section className="dash-panel" aria-label="Defect Findings Registry">
        <DefectFindingsReview
          findings={allDefects}
          evidenceList={allEvidence}
          title="All Detected UI Defects"
          showJobLink={true}
        />
      </section>
    </div>
  );
}
