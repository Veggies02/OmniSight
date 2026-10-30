import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  EmptyState,
  LoadingState,
  ErrorState,
  DefectFindingsReview,
  VisualEvidenceViewer,
  ValidationResults,
  RepairBranchWorkflowAction,
  type BadgeStatus,
} from "../../components/dashboard";
import { useInspectionJobDetails } from "../../api";
import type { ValidationStatus } from "../../data/mockJobs";
import heroImg from "../../assets/hero.png";

export function DashboardJobDetails() {
  const { id } = useParams<{ id: string }>();
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | undefined>(undefined);

  const { job, loading, error, isLiveBackend, refresh, retry } = useInspectionJobDetails(id);

  // Helper for Validation Status Badge
  const renderValidationBadge = (valStatus?: ValidationStatus) => {
    if (!valStatus || valStatus === "not-applicable") {
      return (
        <span className="validation-na-pill" title="No defects detected; validation not applicable">
          <span aria-hidden="true">—</span>
          <span>N/A (Clean Run)</span>
        </span>
      );
    }

    const badgeStatusMap: Record<string, BadgeStatus> = {
      passed: "passed",
      failed: "failed",
      "needs-review": "needs-review",
      pending: "pending",
      running: "running",
    };

    const labelMap: Record<string, string> = {
      passed: "Validated (Passed)",
      failed: "Validation Failed",
      "needs-review": "Needs Review",
      pending: "Pending Validation",
      running: "Running Validation",
    };

    return (
      <StatusBadge
        status={badgeStatusMap[valStatus] || "pending"}
        label={labelMap[valStatus]}
        size="md"
      />
    );
  };

  // 1. Loading State
  if (loading && !job) {
    return (
      <div className="dashboard-job-details-page">
        <nav className="job-breadcrumb" aria-label="Breadcrumb navigation">
          <Link to="/qa">QA Overview</Link>
          <span className="job-breadcrumb-sep">/</span>
          <Link to="/qa/jobs">Inspection Jobs</Link>
          <span className="job-breadcrumb-sep">/</span>
          <span className="job-breadcrumb-active">Loading #{id || ""}</span>
        </nav>

        <div style={{ marginTop: "2rem" }}>
          <LoadingState
            message={`Loading inspection record #${id || ""}...`}
            description="Connecting to OmniSight orchestrator and retrieving artifacts"
          />
        </div>
      </div>
    );
  }

  // 2. Fatal Error State (when job is not in backend and not in fallback)
  if (error && !job) {
    return (
      <div className="dashboard-job-details-page">
        <nav className="job-breadcrumb" aria-label="Breadcrumb navigation">
          <Link to="/qa">QA Overview</Link>
          <span className="job-breadcrumb-sep">/</span>
          <Link to="/qa/jobs">Inspection Jobs</Link>
          <span className="job-breadcrumb-sep">/</span>
          <span className="job-breadcrumb-active">Error</span>
        </nav>

        <div style={{ marginTop: "2rem" }}>
          <ErrorState
            title="Failed to Load Inspection Job"
            message={error}
            onRetry={retry}
            retryLabel="Retry Connection"
          />
        </div>
      </div>
    );
  }

  // 3. Not Found State
  if (!job) {
    return (
      <div className="dashboard-job-details-page">
        <nav className="job-breadcrumb" aria-label="Breadcrumb navigation">
          <Link to="/qa">QA Overview</Link>
          <span className="job-breadcrumb-sep">/</span>
          <Link to="/qa/jobs">Inspection Jobs</Link>
          <span className="job-breadcrumb-sep">/</span>
          <span className="job-breadcrumb-active">Not Found</span>
        </nav>

        <EmptyState
          title="Inspection Job Not Found"
          description={`No inspection job was found with ID "${id || "unknown"}". The record may have expired, or the ID was mistyped.`}
          action={{
            label: "← Back to Inspection Jobs",
            to: "/qa/jobs",
          }}
          secondaryAction={{
            label: "Return to Overview",
            to: "/qa",
          }}
        />
      </div>
    );
  }

  return (
    <div className="dashboard-job-details-page">
      {/* 1. Breadcrumb Navigation */}
      <nav className="job-breadcrumb" aria-label="Breadcrumb navigation">
        <Link to="/qa">QA Overview</Link>
        <span className="job-breadcrumb-sep">/</span>
        <Link to="/qa/jobs">Inspection Jobs</Link>
        <span className="job-breadcrumb-sep">/</span>
        <span className="job-breadcrumb-active">#{job.id}</span>
      </nav>

      {/* 2. Page Header */}
      <PageHeader
        badge={<span className="hero-pill">Job #{job.id} • Telemetry Details</span>}
        title={`Inspection Run: #${job.id}`}
        description={`Visual scan and self-healing analysis for ${job.application} target route "${job.targetRoute}".`}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            {/* Live Backend vs Fallback Demo indicator */}
            {isLiveBackend ? (
              <span
                className="dash-meta-badge"
                style={{
                  color: "#16a34a",
                  borderColor: "rgba(34, 197, 94, 0.3)",
                  background: "rgba(34, 197, 94, 0.1)",
                }}
                title="Sourced from live FastAPI backend orchestrator"
              >
                <span
                  className="status-dot-pulse"
                  style={{ width: 6, height: 6, background: "#22c55e" }}
                  aria-hidden="true"
                />
                <span>Live Backend Job</span>
              </span>
            ) : (
              <span
                className="dash-meta-badge"
                style={{
                  color: "#d97706",
                  borderColor: "rgba(217, 119, 6, 0.3)",
                  background: "rgba(217, 119, 6, 0.08)",
                }}
                title="Backend offline or unpersisted ID. Sourced from typed demo database."
              >
                <span
                  className="status-dot-pulse"
                  style={{ width: 6, height: 6, background: "#d97706" }}
                  aria-hidden="true"
                />
                <span>Demo Fallback Job</span>
              </span>
            )}

            <button
              type="button"
              className={`dash-header-btn ${loading ? "is-refreshing" : ""}`}
              onClick={refresh}
              disabled={loading}
              aria-label="Refresh job record"
              title="Refetch latest job details and artifacts"
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
              ← Back to Jobs
            </Link>
            <Link to="/" className="dash-header-btn" title="View mock storefront target">
              Target Storefront ↗
            </Link>
          </div>
        }
      />

      {/* 3. Executive Metrics Grid */}
      <section className="dash-telemetry-grid" aria-label="Job Summary Metrics">
        <StatCard
          label="Inspection Status"
          value={job.status.charAt(0).toUpperCase() + job.status.slice(1)}
          subtext={`Duration: ${job.duration}`}
          badge={<StatusBadge status={job.status} size="sm" />}
          variant={job.status === "passed" ? "success" : job.status === "failed" ? "danger" : "accent"}
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
              <path d="M12 2v4" />
              <path d="m16.2 7.8 2.9-2.9" />
              <path d="M18 12h4" />
              <path d="m16.2 16.2 2.9 2.9" />
              <path d="M12 18v4" />
              <path d="m4.9 19.1 2.9-2.9" />
              <path d="M2 12h4" />
              <path d="m4.9 4.9 2.9 2.9" />
            </svg>
          }
        />

        <StatCard
          label="Validation Status"
          value={
            !job.validationStatus || job.validationStatus === "not-applicable"
              ? "Clean / N/A"
              : job.validationStatus === "needs-review"
              ? "Review Staged"
              : job.validationStatus.charAt(0).toUpperCase() + job.validationStatus.slice(1)
          }
          subtext="Self-healing verification"
          badge={renderValidationBadge(job.validationStatus)}
          variant={
            job.validationStatus === "passed"
              ? "success"
              : job.validationStatus === "failed"
              ? "danger"
              : "default"
          }
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
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          }
        />

        <StatCard
          label="Defects Detected"
          value={job.defectsCount}
          subtext={job.defectsCount > 0 ? "Visual regressions logged" : "Zero regressions"}
          variant={job.defectsCount > 0 ? "warning" : "success"}
          badge={
            <span
              className={`defects-count-tag ${job.defectsCount > 0 ? "has-defects" : "clean"}`}
            >
              {job.defectsCount > 0 ? "Requires action" : "Passed"}
            </span>
          }
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
          label="Target Viewport"
          value={job.viewport.split(" ")[0]}
          subtext={job.viewport}
          variant="default"
          badge={<span className="stat-card-badge" style={{ color: "var(--color-text-muted)" }}>Browser</span>}
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
              <rect width="20" height="14" x="2" y="3" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          }
        />
      </section>

      {/* 4. Execution Metadata Summary */}
      <section className="job-meta-grid" aria-label="Execution Metadata">
        <div className="job-meta-card">
          <span className="job-meta-label">Application Name</span>
          <span className="job-meta-value">{job.application}</span>
          <span className="job-meta-sub">
            Target Route: <code>{job.targetRoute}</code>
          </span>
        </div>

        <div className="job-meta-card">
          <span className="job-meta-label">Started Timestamp</span>
          <span className="job-meta-value">{job.startedAt}</span>
          <span className="job-meta-sub" title={job.timestamp}>
            ISO: {job.timestamp}
          </span>
        </div>

        <div className="job-meta-card">
          <span className="job-meta-label">Execution Duration</span>
          <span className="job-meta-value">{job.duration}</span>
          <span className="job-meta-sub">Playwright headless runner</span>
        </div>

        <div className="job-meta-card">
          <span className="job-meta-label">Defect Summary</span>
          <span className="job-meta-value" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
            {job.defectSummary || "Standard scan execution completed"}
          </span>
          <span className="job-meta-sub">VLM vision inference</span>
        </div>
      </section>

      {/* 5. Validation Results Section */}
      <section style={{ marginBottom: "2rem" }} aria-label="Validation Results">
        <ValidationResults
          validation={job.validation}
          validationStatus={job.validationStatus}
          jobId={job.id}
          onSelectEvidence={setSelectedEvidenceId}
        />
      </section>

      {/* 5b. Automated Repair Branch & Commit Workflow Section */}
      <section style={{ marginBottom: "2rem" }} aria-label="Repair Workflow">
        <RepairBranchWorkflowAction job={job} />
      </section>

      {/* 6. Defect Findings Section */}
      <section className="dash-panel" style={{ marginBottom: "2rem" }} aria-label="Defect Findings">
        <DefectFindingsReview
          findings={job.defects || []}
          evidenceList={job.evidence || []}
          title={`Defect Findings (${job.defects?.length || 0})`}
        />
      </section>

      {/* 7. Visual Evidence & Comparison Section */}
      <section className="dash-panel" aria-label="Inspection Evidence">
        <div className="dash-panel-header">
          <h2 className="dash-panel-title">
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            <span>Visual Evidence & Inspection Artifacts</span>
          </h2>
          <span className="dash-panel-badge">
            {job.evidence && job.evidence.length > 0
              ? `${job.evidence.length} Artifacts Staged`
              : "No Artifacts"}
          </span>
        </div>

        {!job.evidence || job.evidence.length === 0 ? (
          <EmptyState
            title="No Evidence Artifacts Staged"
            description="Visual defect captures and Playwright browser trace archives are automatically staged when UI discrepancies are flagged or when full diagnostic logging is enabled."
            action={{
              label: "Explore Other Jobs",
              to: "/qa/jobs",
            }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {/* Interactive Visual Evidence Viewer */}
            <VisualEvidenceViewer
              evidenceList={job.evidence}
              selectedEvidenceId={selectedEvidenceId ?? job.evidence[0]?.id}
              onSelectEvidence={setSelectedEvidenceId}
            />

            {/* Evidence Artifacts Gallery & Selector */}
            {job.evidence.length > 1 && (
              <div>
                <h4
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 700,
                    color: "var(--color-text-secondary)",
                    marginBottom: "0.75rem",
                  }}
                >
                  All Captured Artifacts ({job.evidence.length})
                </h4>
                <div className="evidence-grid">
                  {job.evidence.map((evi) => {
                    const isSelected = (selectedEvidenceId ?? job.evidence![0]?.id) === evi.id;
                    return (
                      <div
                        key={evi.id}
                        className="evidence-card"
                        style={{
                          cursor: "pointer",
                          borderColor: isSelected ? "var(--color-accent)" : undefined,
                          boxShadow: isSelected ? "0 0 0 2px var(--color-accent-subtle)" : undefined,
                        }}
                        onClick={() => {
                          setSelectedEvidenceId(evi.id);
                          document
                            .getElementById("visual-evidence-viewer")
                            ?.scrollIntoView({ behavior: "smooth" });
                        }}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedEvidenceId(evi.id);
                            document
                              .getElementById("visual-evidence-viewer")
                              ?.scrollIntoView({ behavior: "smooth" });
                          }
                        }}
                      >
                        <div className="evidence-header">
                          <h5 className="evidence-title" style={{ fontSize: "0.9rem" }}>
                            {evi.title}
                          </h5>
                          <span
                            className="defect-category-pill"
                            style={{ textTransform: "capitalize" }}
                          >
                            {evi.type.replace("-", " ")}
                          </span>
                        </div>

                        {/* Evidence Preview Box */}
                        <div className="evidence-preview-box" style={{ minHeight: 120 }}>
                          <span className="evidence-preview-watermark">
                            {evi.dimensions || evi.viewport}
                          </span>

                          {evi.baselineImageUrl || evi.defectiveImageUrl === heroImg ? (
                            <img
                              src={heroImg}
                              alt="Captured inspection viewport preview"
                              className="evidence-preview-img"
                              style={{ maxHeight: 120 }}
                            />
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: "0.3rem",
                              }}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="28"
                                height="28"
                                fill="none"
                                stroke="#60a5fa"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <rect width="20" height="14" x="2" y="3" rx="2" />
                                <line x1="8" y1="21" x2="16" y2="21" />
                                <line x1="12" y1="17" x2="12" y2="21" />
                              </svg>
                              <span style={{ fontSize: "0.78rem", color: "#f8fafc", fontWeight: 600 }}>
                                {evi.title}
                              </span>
                              <span style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                                {evi.viewport}
                              </span>
                            </div>
                          )}
                        </div>

                        {evi.description && (
                          <p
                            style={{
                              fontSize: "0.8rem",
                              color: "var(--color-text-secondary)",
                              margin: 0,
                              lineHeight: 1.5,
                            }}
                          >
                            {evi.description}
                          </p>
                        )}

                        <div className="evidence-meta-row" style={{ fontSize: "0.75rem" }}>
                          <span>
                            Captured: <strong>{evi.capturedAt}</strong>
                          </span>
                          <span
                            style={{
                              color: isSelected ? "var(--color-accent)" : "var(--color-text-muted)",
                              fontWeight: isSelected ? 700 : 500,
                            }}
                          >
                            {isSelected ? "Active in Viewer ▲" : "View in Comparison →"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
