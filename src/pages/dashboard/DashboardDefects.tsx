import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  DefectFindingsReview,
  VisualEvidenceViewer,
  LoadingState,
  ErrorState,
} from "../../components/dashboard";
import { useInspectionJobs } from "../../api";
import {
  getAllDefectFindings,
  getAllEvidence,
} from "../../data/mockJobs";
import type { DefectFinding, InspectionEvidence } from "../../types/dashboard.ts";

export function DashboardDefects() {
  const { jobs, loading, error, isLiveBackend, refresh, retry } = useInspectionJobs();

  // Aggregate defect findings and evidence across all loaded jobs
  const { allDefects, allEvidence } = useMemo(() => {
    const defectsFromJobs: DefectFinding[] = [];
    const evidenceFromJobs: InspectionEvidence[] = [];
    const seenEvidence = new Set<string>();

    jobs.forEach((job) => {
      if (job.defects && job.defects.length > 0) {
        job.defects.forEach((defect) => {
          defectsFromJobs.push({
            ...defect,
            jobId: job.id,
            targetRoute: job.targetRoute,
          });
        });
      }
      if (job.evidence && job.evidence.length > 0) {
        job.evidence.forEach((evi) => {
          if (!seenEvidence.has(evi.id)) {
            seenEvidence.add(evi.id);
            evidenceFromJobs.push(evi);
          }
        });
      }
    });

    // If jobs returned empty or has 0 defect records, fall back to mock data
    if (defectsFromJobs.length === 0) {
      return {
        allDefects: getAllDefectFindings(),
        allEvidence: getAllEvidence(),
      };
    }

    return {
      allDefects: defectsFromJobs,
      allEvidence: evidenceFromJobs,
    };
  }, [jobs]);

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

  if (loading && jobs.length === 0) {
    return (
      <div className="dashboard-defects-page">
        <nav className="job-breadcrumb" aria-label="Breadcrumb navigation">
          <Link to="/qa">QA Overview</Link>
          <span className="job-breadcrumb-sep">/</span>
          <span className="job-breadcrumb-active">Defect Findings & Review</span>
        </nav>
        <div style={{ marginTop: "2rem" }}>
          <LoadingState
            message="Loading Defect Findings..."
            description="Aggregating visual inspection findings and artifact traces"
          />
        </div>
      </div>
    );
  }

  if (error && jobs.length === 0) {
    return (
      <div className="dashboard-defects-page">
        <nav className="job-breadcrumb" aria-label="Breadcrumb navigation">
          <Link to="/qa">QA Overview</Link>
          <span className="job-breadcrumb-sep">/</span>
          <span className="job-breadcrumb-active">Defect Findings & Review</span>
        </nav>
        <div style={{ marginTop: "2rem" }}>
          <ErrorState
            title="Failed to Load Defect Findings"
            message={error}
            onRetry={retry}
            retryLabel="Retry Connection"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-defects-page">
      {/* 1. Breadcrumbs Navigation */}
      <nav className="job-breadcrumb" aria-label="Breadcrumb navigation">
        <Link to="/qa">QA Overview</Link>
        <span className="job-breadcrumb-sep">/</span>
        <span className="job-breadcrumb-active">Defect Findings & Review</span>
      </nav>

      {/* 2. Page Header */}
      <PageHeader
        title="Defect Findings & Review"
        description="Review detected visual discrepancies, triage severity, inspect affected UI components, and explore staged screenshot and trace evidence across all test runs."
        badge={<StatusBadge status="needs-review" label={`${totalFindings} Active Findings`} />}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            {isLiveBackend ? (
              <span
                className="dash-meta-badge"
                style={{
                  color: "#16a34a",
                  borderColor: "rgba(34, 197, 94, 0.3)",
                  background: "rgba(34, 197, 94, 0.1)",
                }}
                title="Connected to live backend orchestrator"
              >
                <span
                  className="status-dot-pulse"
                  style={{ width: 6, height: 6, background: "#22c55e" }}
                  aria-hidden="true"
                />
                <span>Live Backend</span>
              </span>
            ) : (
              <span
                className="dash-meta-badge"
                style={{
                  color: "#d97706",
                  borderColor: "rgba(217, 119, 6, 0.3)",
                  background: "rgba(217, 119, 6, 0.08)",
                }}
                title="Displaying typed demonstration defect database"
              >
                <span
                  className="status-dot-pulse"
                  style={{ width: 6, height: 6, background: "#d97706" }}
                  aria-hidden="true"
                />
                <span>Demo Database</span>
              </span>
            )}

            <button
              type="button"
              className={`dash-header-btn ${loading ? "is-refreshing" : ""}`}
              onClick={refresh}
              disabled={loading}
              title="Refresh findings"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="btn-refresh-icon"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
              <span>{loading ? "Refreshing..." : "Refresh"}</span>
            </button>

            <Link to="/qa/jobs" className="dash-header-btn">
              All Inspection Jobs
            </Link>

            <Link to="/qa/pull-requests" className="dash-header-btn">
              Self-Healing PRs →
            </Link>
          </div>
        }
      />

      {/* 3. Triage Summary StatCards */}
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

      {/* 4. Reusable Defect Findings Review Section */}
      <section className="dash-panel" style={{ marginBottom: "2rem" }} aria-label="Defect Findings Registry">
        <DefectFindingsReview
          findings={allDefects}
          evidenceList={allEvidence}
          title="All Detected UI Defects"
          showJobLink={true}
        />
      </section>

      {/* 5. Global Visual Evidence Comparison Section */}
      <section className="dash-panel" id="visual-evidence-viewer" aria-label="Visual Inspection Evidence Comparison">
        <div className="dash-panel-header">
          <h2 className="dash-panel-title">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            <span>Visual Evidence Comparison Gallery</span>
          </h2>
          <span className="dash-panel-badge">
            {allEvidence.length} Captured Artifacts
          </span>
        </div>

        <VisualEvidenceViewer
          evidenceList={allEvidence}
          title="Cross-Job Visual Inspection Evidence Comparison"
        />
      </section>
    </div>
  );
}
