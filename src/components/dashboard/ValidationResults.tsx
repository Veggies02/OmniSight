import { useState, useMemo } from "react";
import { StatusBadge, type BadgeStatus } from "./StatusBadge";
import { StatCard } from "./StatCard";
import { EmptyState } from "./EmptyState";
import type {
  JobValidationResult,
  ValidationCheck,
  CheckResultStatus,
  ValidationStatus,
} from "../../data/mockJobs";

export interface ValidationResultsProps {
  validation?: JobValidationResult;
  validationStatus?: ValidationStatus;
  jobId?: string;
  title?: string;
  className?: string;
  onSelectEvidence?: (evidenceId: string) => void;
}

export function ValidationResults({
  validation,
  validationStatus = validation?.status || "not-applicable",
  jobId,
  title = "Self-Healing Validation Outcomes",
  className = "",
  onSelectEvidence,
}: ValidationResultsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Helper for overall validation status badge configuration
  const getOverallStatusConfig = (
    status: ValidationStatus
  ): { badgeStatus: BadgeStatus; label: string } => {
    switch (status) {
      case "passed":
        return { badgeStatus: "passed", label: "Validation Passed" };
      case "failed":
        return { badgeStatus: "failed", label: "Validation Failed" };
      case "needs-review":
        return { badgeStatus: "needs-review", label: "Needs Review" };
      case "running":
        return { badgeStatus: "running", label: "Validation Running" };
      case "pending":
        return { badgeStatus: "pending", label: "Validation Pending" };
      case "not-applicable":
      default:
        return { badgeStatus: "pending", label: "Not Applicable" };
    }
  };

  // Helper for check status badge configuration
  const getCheckBadgeConfig = (
    checkStatus: CheckResultStatus
  ): { badgeStatus: BadgeStatus; label: string } => {
    switch (checkStatus) {
      case "passed":
        return { badgeStatus: "passed", label: "Passed" };
      case "failed":
        return { badgeStatus: "failed", label: "Failed" };
      case "running":
        return { badgeStatus: "running", label: "Running" };
      case "pending":
        return { badgeStatus: "pending", label: "Pending" };
      case "skipped":
        return { badgeStatus: "needs-review", label: "Skipped" };
      default:
        return { badgeStatus: "pending", label: checkStatus };
    }
  };

  // Filter checks list
  const checksList = validation?.checks;
  const filteredChecks = useMemo(() => {
    if (!checksList) return [];
    const q = searchQuery.toLowerCase().trim();

    return checksList.filter((check) => {
      // 1. Search Query
      const matchesSearch =
        !q ||
        check.id.toLowerCase().includes(q) ||
        check.name.toLowerCase().includes(q) ||
        (check.target && check.target.toLowerCase().includes(q)) ||
        (check.assertionType && check.assertionType.toLowerCase().includes(q)) ||
        (check.errorMessage && check.errorMessage.toLowerCase().includes(q));

      // 2. Status Filter
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "passed" && check.status === "passed") ||
        (statusFilter === "failed" && check.status === "failed") ||
        (statusFilter === "in-progress" &&
          (check.status === "running" || check.status === "pending" || check.status === "skipped"));

      return matchesSearch && matchesStatus;
    });
  }, [checksList, searchQuery, statusFilter]);

  const overallStatus = validation?.status || validationStatus;
  const overallConfig = getOverallStatusConfig(overallStatus);

  // If no validation data exists or validation was not triggered (clean run)
  if (!validation || !validation.checks || validation.checks.length === 0) {
    return (
      <div className={`validation-results-panel ${className}`} aria-label="Validation Results">
        <div className="dash-panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <h3 className="dash-panel-title">
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
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 12 12 15 16 10" />
              </svg>
              <span>{title}</span>
            </h3>
          </div>
          <span className="validation-na-pill">
            <span aria-hidden="true">—</span>
            <span>No Automated Validation Data</span>
          </span>
        </div>

        <div style={{ padding: "1.5rem 0" }}>
          <EmptyState
            title="No Validation Checks Recorded"
            description={
              overallStatus === "not-applicable"
                ? "This inspection run completed with zero detected defects. Because the application was visually verified clean, no self-healing repair patches or regression verification suites were triggered."
                : "No regression validation checks or assertions have been staged for this job record."
            }
          />
        </div>
      </div>
    );
  }

  const passPercentage =
    validation.totalChecks > 0
      ? Math.round((validation.passedChecks / validation.totalChecks) * 100)
      : 0;

  const handleEvidenceClick = (evidenceId: string) => {
    if (onSelectEvidence) {
      onSelectEvidence(evidenceId);
    }
    document.getElementById("visual-evidence-viewer")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div
      className={`validation-results-panel ${className}`}
      id="validation-results-panel"
      aria-label="Validation Results Interface"
    >
      {/* 1. Header Toolbar */}
      <div className="dash-panel-header" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <h3 className="dash-panel-title">
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
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 12 12 15 16 10" />
              </svg>
              <span>{title}</span>
            </h3>
            <StatusBadge status={overallConfig.badgeStatus} label={overallConfig.label} size="sm" />
          </div>

          <span className="job-meta-sub" style={{ marginTop: "0.25rem", display: "block" }}>
            Automated Playwright regression checks and post-inspection verification assertions.
          </span>
        </div>

        {/* Execution Timestamps & Job Link */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
          {jobId && (
            <span className="active-filter-chip">
              Job: <strong>#{jobId}</strong>
            </span>
          )}
          {validation.startedAt && (
            <span className="evidence-meta-pill">
              Started: <strong>{validation.startedAt}</strong>
            </span>
          )}
          {validation.completedAt && (
            <span className="evidence-meta-pill">
              Completed: <strong>{validation.completedAt}</strong>
            </span>
          )}
        </div>
      </div>

      {/* 2. Top Status Callout Banner */}
      {overallStatus === "passed" && (
        <div className="validation-banner success">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: 0, fontSize: "0.925rem", color: "#166534" }}>
              All Validation Assertions Verified Successfully
            </h4>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.825rem", color: "#15803d", lineHeight: 1.5 }}>
              100% of automated Playwright test assertions and accessibility contrast checks completed without regression. Self-healing patches are verified stable.
            </p>
          </div>
        </div>
      )}

      {overallStatus === "failed" && (
        <div className="validation-banner danger">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: 0, fontSize: "0.925rem", color: "#991b1b" }}>
              Validation Failed — Actionable Discrepancies Flagged
            </h4>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.825rem", color: "#b91c1c", lineHeight: 1.5 }}>
              {validation.failureSummary ||
                `${validation.failedChecks} assertion(s) failed during post-inspection verification. Inspect failure logs and visual evidence below before staging PR fixes.`}
            </p>
          </div>
        </div>
      )}

      {overallStatus === "needs-review" && (
        <div className="validation-banner warning">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: 0, fontSize: "0.925rem", color: "#92400e" }}>
              Needs Human Review
            </h4>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.825rem", color: "#b45309", lineHeight: 1.5 }}>
              {validation.failureSummary ||
                "Automated validation detected potential layout regressions requiring manual engineering triage."}
            </p>
          </div>
        </div>
      )}

      {overallStatus === "running" && (
        <div className="validation-banner info">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ animation: "spin 2s linear infinite" }}>
            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" />
          </svg>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: 0, fontSize: "0.925rem", color: "#1e40af" }}>
              Validation Suite Currently Running
            </h4>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.825rem", color: "#1d4ed8", lineHeight: 1.5 }}>
              Executing headless Playwright assertions across multi-viewport matrix. Results will update automatically.
            </p>
          </div>
        </div>
      )}

      {/* 3. Metric Summary Cards */}
      <section className="dash-metrics-grid" style={{ margin: "1.25rem 0" }} aria-label="Validation Metric Cards">
        <StatCard
          label="Total Checks"
          value={validation.totalChecks}
          subtext={`Pass rate: ${passPercentage}%`}
          variant="default"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          }
        />

        <StatCard
          label="Passed Checks"
          value={validation.passedChecks}
          subtext="Verified zero regression"
          variant="success"
          badge={<span className="stat-card-badge" style={{ color: "#10b981" }}>Stable</span>}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
        />

        <StatCard
          label="Failed Checks"
          value={validation.failedChecks}
          subtext={validation.failedChecks > 0 ? "Requires code patch" : "Clean execution"}
          variant={validation.failedChecks > 0 ? "danger" : "default"}
          badge={
            validation.failedChecks > 0 ? (
              <span className="stat-card-badge" style={{ color: "#ef4444" }}>Faults</span>
            ) : undefined
          }
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          }
        />

        <StatCard
          label="Execution Time"
          value={validation.duration || "N/A"}
          subtext={validation.completedAt ? "Playwright assertion runner" : "In flight"}
          variant="default"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="telemetry-icon" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
        />
      </section>

      {/* 4. Controls: Filter & Search */}
      <div className="dash-table-toolbar" style={{ marginTop: "1rem" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 360 }}>
          <input
            type="search"
            className="dash-search-input"
            style={{ width: "100%" }}
            placeholder="Search checks by name, target, or error..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search validation checks"
          />
        </div>

        <div className="dash-filter-group">
          <label className="filter-group-item" htmlFor="validation-check-status-filter">
            <span>Filter Status:</span>
            <select
              id="validation-check-status-filter"
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter validation checks by result status"
            >
              <option value="all">All Check Outcomes ({validation.checks.length})</option>
              <option value="passed">Passed ({validation.passedChecks})</option>
              <option value="failed">Failed ({validation.failedChecks})</option>
              <option value="in-progress">In-Progress / Skipped</option>
            </select>
          </label>
        </div>
      </div>

      {/* 5. Checks Detail Table / List */}
      <div style={{ marginTop: "1rem" }}>
        {filteredChecks.length === 0 ? (
          <EmptyState
            title="No Validation Checks Match Filter"
            description="No individual test assertions match your search query or outcome filter. Try clearing active filters."
            action={{
              label: "Reset Filter",
              onClick: () => {
                setSearchQuery("");
                setStatusFilter("all");
              },
            }}
          />
        ) : (
          <div className="validation-checks-list">
            {filteredChecks.map((check: ValidationCheck) => {
              const checkCfg = getCheckBadgeConfig(check.status);
              const isFail = check.status === "failed";

              return (
                <div
                  key={check.id}
                  className={`validation-check-card status-${check.status}`}
                >
                  <div className="validation-check-header">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                      <span className="job-id-cell">#{check.id}</span>
                      <h4 className="validation-check-name">{check.name}</h4>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <StatusBadge status={checkCfg.badgeStatus} label={checkCfg.label} size="sm" />
                      {check.duration && (
                        <span className="validation-duration-pill">{check.duration}</span>
                      )}
                    </div>
                  </div>

                  {/* Assertion Type & Target Locator Metadata */}
                  <div className="validation-check-meta-row">
                    {check.assertionType && (
                      <span className="defect-category-pill">
                        Assertion: <strong>{check.assertionType}</strong>
                      </span>
                    )}

                    {check.target && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                        <span style={{ color: "var(--color-text-muted)" }}>Target:</span>
                        <code className="defect-selector-code">{check.target}</code>
                      </div>
                    )}

                    {check.evidenceRef && (
                      <button
                        type="button"
                        className="filter-pill-btn"
                        style={{ fontSize: "0.72rem", padding: "0.15rem 0.5rem", gap: "0.3rem" }}
                        onClick={() => handleEvidenceClick(check.evidenceRef!)}
                        title={`Jump to Visual Evidence #${check.evidenceRef}`}
                      >
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                          <circle cx="9" cy="9" r="2" />
                          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                        </svg>
                        <span>Evidence #{check.evidenceRef}</span>
                      </button>
                    )}
                  </div>

                  {/* Actual vs Expected Comparison (if present) */}
                  {(check.actualValue || check.expectedValue) && (
                    <div className="validation-expected-box">
                      {check.expectedValue && (
                        <div className="expected-row">
                          <span className="expected-label">Expected:</span>
                          <span className="expected-val">{check.expectedValue}</span>
                        </div>
                      )}
                      {check.actualValue && (
                        <div className="actual-row">
                          <span className="actual-label">Observed:</span>
                          <span className={`actual-val ${isFail ? "fault" : "clean"}`}>
                            {check.actualValue}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Failure Error Message Callout */}
                  {check.errorMessage && (
                    <div className="validation-error-callout">
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.4rem" }}>
                        <svg
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="none"
                          stroke="#ef4444"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          style={{ flexShrink: 0, marginTop: "0.1rem" }}
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <span style={{ fontSize: "0.8rem", color: "#991b1b", lineHeight: 1.5 }}>
                          {check.errorMessage}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
