import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  EmptyState,
  type BadgeStatus,
} from "../../components/dashboard";
import {
  getInspectionJobById,
  type ValidationStatus,
  type DefectSeverity,
} from "../../data/mockJobs";
import heroImg from "../../assets/hero.png";

export function DashboardJobDetails() {
  const { id } = useParams<{ id: string }>();

  const job = useMemo(() => {
    if (!id) return undefined;
    return getInspectionJobById(id);
  }, [id]);

  // Handle missing or invalid job ID gracefully
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

  // Helper for Validation Status Badge
  const renderValidationBadge = (valStatus: ValidationStatus) => {
    if (valStatus === "not-applicable") {
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
    };

    const labelMap: Record<string, string> = {
      passed: "Validated (Passed)",
      failed: "Validation Failed",
      "needs-review": "Needs Review",
      pending: "Pending Validation",
    };

    return (
      <StatusBadge
        status={badgeStatusMap[valStatus] || "pending"}
        label={labelMap[valStatus]}
        size="md"
      />
    );
  };

  const getSeverityBadgeClass = (severity: DefectSeverity) => {
    switch (severity) {
      case "critical":
        return "severity-badge severity-critical";
      case "major":
        return "severity-badge severity-major";
      case "minor":
        return "severity-badge severity-minor";
      case "cosmetic":
      default:
        return "severity-badge severity-cosmetic";
    }
  };

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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
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
            job.validationStatus === "not-applicable"
              ? "Clean / N/A"
              : job.validationStatus === "needs-review"
              ? "Review Staged"
              : job.validationStatus.charAt(0).toUpperCase() + job.validationStatus.slice(1)
          }
          subtext="Self-healing verification"
          badge={renderValidationBadge(job.validationStatus)}
          variant={job.validationStatus === "passed" ? "success" : job.validationStatus === "failed" ? "danger" : "default"}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
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
          <span className="job-meta-sub">Target Route: <code>{job.targetRoute}</code></span>
        </div>

        <div className="job-meta-card">
          <span className="job-meta-label">Started Timestamp</span>
          <span className="job-meta-value">{job.startedAt}</span>
          <span className="job-meta-sub" title={job.timestamp}>ISO: {job.timestamp}</span>
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

      {/* 5. Defect Findings Section */}
      <section className="dash-panel" style={{ marginBottom: "2rem" }} aria-label="Defect Findings">
        <div className="dash-panel-header">
          <h2 className="dash-panel-title">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>Defect Findings ({job.defects?.length || 0})</span>
          </h2>
          <span className="dash-panel-badge">
            {job.defects && job.defects.length > 0
              ? `${job.defects.length} Discrepancies Recorded`
              : "Clean Baseline"}
          </span>
        </div>

        {!job.defects || job.defects.length === 0 ? (
          <EmptyState
            title="Zero Defect Findings Detected"
            description="The Vision-Language Model and automated Playwright scanner detected zero visual regressions, layout overflow faults, or color contrast failures on this route."
            icon={
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            }
          />
        ) : (
          <div className="defect-finding-list">
            {job.defects.map((defect) => (
              <div
                key={defect.id}
                className={`defect-finding-card severity-${defect.severity}`}
              >
                {/* Defect Card Header */}
                <div className="defect-finding-header">
                  <div className="defect-title-group">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <span className="job-id-cell">#{defect.id}</span>
                      <h3 className="defect-finding-title">{defect.title}</h3>
                    </div>
                  </div>

                  <div className="defect-tag-row">
                    <span className={getSeverityBadgeClass(defect.severity)}>
                      {defect.severity}
                    </span>
                    <span className="defect-category-pill">
                      {defect.category}
                    </span>
                    <StatusBadge
                      status={
                        defect.status === "resolved"
                          ? "passed"
                          : defect.status === "fix-staged"
                          ? "needs-review"
                          : defect.status === "open"
                          ? "failed"
                          : "pending"
                      }
                      label={
                        defect.status === "resolved"
                          ? "Resolved"
                          : defect.status === "fix-staged"
                          ? "Fix Staged"
                          : defect.status === "open"
                          ? "Open"
                          : "Pending Review"
                      }
                      size="sm"
                    />
                  </div>
                </div>

                {/* Description */}
                <p className="defect-finding-desc">{defect.description}</p>

                {/* Affected Component & Selector */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
                  <span style={{ color: "var(--color-text-muted)" }}>Component:</span>
                  <code className="defect-selector-code">{defect.affectedComponent}</code>

                  {defect.selector && (
                    <>
                      <span style={{ color: "var(--color-text-muted)" }}>Selector:</span>
                      <code className="defect-selector-code">{defect.selector}</code>
                    </>
                  )}
                </div>

                {/* VLM Explanation */}
                {defect.vlmExplanation && (
                  <div className="vlm-explanation-box">
                    <strong>VLM AI Reasoning: </strong>
                    <span>{defect.vlmExplanation}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 6. Evidence & Artifacts Section */}
      <section className="dash-panel" aria-label="Inspection Evidence">
        <div className="dash-panel-header">
          <h2 className="dash-panel-title">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            <span>Inspection Evidence & Artifacts</span>
          </h2>
          <span className="dash-panel-badge">
            {job.evidence && job.evidence.length > 0
              ? `${job.evidence.length} Evidence Artifacts`
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
          <div className="evidence-grid">
            {job.evidence.map((evi) => (
              <div key={evi.id} className="evidence-card">
                <div className="evidence-header">
                  <h3 className="evidence-title">{evi.title}</h3>
                  <span className="defect-category-pill" style={{ textTransform: "capitalize" }}>
                    {evi.type.replace("-", " ")}
                  </span>
                </div>

                {/* Evidence Preview */}
                <div className="evidence-preview-box">
                  <span className="evidence-preview-watermark">
                    {evi.dimensions || evi.viewport}
                  </span>

                  {/* Render real local asset for demo preview if available */}
                  {evi.id === "EVI-301" ? (
                    <img
                      src={heroImg}
                      alt="Captured inspection viewport"
                      className="evidence-preview-img"
                    />
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
                      <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect width="20" height="14" x="2" y="3" rx="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                      <span style={{ fontSize: "0.85rem", color: "#f8fafc", fontWeight: 600 }}>
                        {evi.title}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                        Viewport: {evi.viewport}
                      </span>
                    </div>
                  )}
                </div>

                {evi.description && (
                  <p style={{ fontSize: "0.825rem", color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.5 }}>
                    {evi.description}
                  </p>
                )}

                <div className="evidence-meta-row">
                  <span>Captured: <strong>{evi.capturedAt}</strong></span>
                  <span>Artifact ID: <code>#{evi.id}</code></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
