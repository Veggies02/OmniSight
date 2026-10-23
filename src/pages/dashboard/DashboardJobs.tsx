import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  LoadingState,
  ErrorState,
  type BadgeStatus,
} from "../../components/dashboard";
import { useInspectionJobs } from "../../api";
import type { ValidationStatus } from "../../data/mockJobs";
import type { InspectionJob } from "../../types/dashboard";

export function DashboardJobs() {
  const { jobs, loading, error, isLiveBackend, refresh, retry } = useInspectionJobs();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [validationFilter, setValidationFilter] = useState<string>("all");

  // Clear all filters helper
  const handleClearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setValidationFilter("all");
  };

  const hasActiveFilters =
    searchQuery.trim() !== "" || statusFilter !== "all" || validationFilter !== "all";

  // Filter jobs immediately upon input changes
  const filteredJobs = useMemo(() => {
    return jobs.filter((job: InspectionJob) => {
      // 1. Search Query filter (matches Job ID, Application, Target Route, or Defect Summary)
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        job.id.toLowerCase().includes(q) ||
        job.application.toLowerCase().includes(q) ||
        job.targetRoute.toLowerCase().includes(q) ||
        (job.defectSummary && job.defectSummary.toLowerCase().includes(q));

      // 2. Inspection Status filter
      const normalizedStatus = job.status.toLowerCase().replace(/[\s_]+/g, "-");
      const matchesStatus = statusFilter === "all" || normalizedStatus === statusFilter;

      // 3. Validation Status filter
      const matchesValidation =
        validationFilter === "all" || job.validationStatus === validationFilter;

      return matchesSearch && matchesStatus && matchesValidation;
    });
  }, [jobs, searchQuery, statusFilter, validationFilter]);

  // Helper to render Validation Status badge
  const renderValidationStatus = (valStatus?: ValidationStatus) => {
    if (!valStatus || valStatus === "not-applicable") {
      return (
        <span className="validation-na-pill" title="No defects detected; validation not applicable">
          <span aria-hidden="true">—</span>
          <span>N/A (Clean)</span>
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
      passed: "Validated",
      failed: "Failed",
      "needs-review": "Needs Review",
      pending: "Pending",
      running: "Running",
    };

    return (
      <StatusBadge
        status={badgeStatusMap[valStatus] || "pending"}
        label={labelMap[valStatus]}
        size="sm"
      />
    );
  };

  return (
    <div className="dashboard-jobs-page">
      {/* 1. Page Header */}
      <PageHeader
        badge={<span className="hero-pill">P4 Workstream • Job History</span>}
        title="Inspection Job History"
        description="Audit and filter past automated UI inspection runs, visual defect detections, and self-healing validation outcomes."
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
                title="Connected to OmniSight FastAPI backend"
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
                title="Backend offline or unreachable. Displaying typed demonstration data."
              >
                <span
                  className="status-dot-pulse"
                  style={{ width: 6, height: 6, background: "#d97706" }}
                  aria-hidden="true"
                />
                <span>Demo Fallback</span>
              </span>
            )}

            {hasActiveFilters && (
              <button
                type="button"
                className="filter-pill-btn active"
                onClick={handleClearFilters}
                aria-label="Clear active filters"
              >
                Clear Filters ×
              </button>
            )}

            <button
              type="button"
              className={`dash-header-btn ${loading ? "is-refreshing" : ""}`}
              onClick={refresh}
              disabled={loading}
              aria-label="Refresh job history"
              title="Fetch latest job records from backend"
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

            <Link to="/qa" className="dash-header-btn">
              ← Overview
            </Link>
          </div>
        }
      />

      {/* Offline notification banner if backend failed and fallback is active */}
      {error && jobs.length > 0 && !isLiveBackend && (
        <div
          style={{
            marginBottom: "1.25rem",
            padding: "0.75rem 1rem",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "rgba(217, 119, 6, 0.1)",
            border: "1px solid rgba(217, 119, 6, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "0.85rem",
            color: "#d97706",
            gap: "1rem",
          }}
          role="status"
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span aria-hidden="true">⚠️</span>
            <span>
              <strong>Backend Offline:</strong> {error}. Showing demonstration records.
            </span>
          </div>
          <button
            type="button"
            onClick={retry}
            style={{
              background: "transparent",
              border: "1px solid #d97706",
              borderRadius: "4px",
              padding: "0.2rem 0.6rem",
              color: "#d97706",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.8rem",
            }}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Full loading state when no records exist yet */}
      {loading && jobs.length === 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <LoadingState
            message="Connecting to OmniSight inspection backend..."
            description="Querying inspection jobs list and artifact manifests"
          />
        </div>
      )}

      {/* Full error state when request failed and no fallback jobs */}
      {error && jobs.length === 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <ErrorState
            title="Failed to Retrieve Inspection Jobs"
            message={error}
            onRetry={retry}
            retryLabel="Retry Connection"
          />
        </div>
      )}

      {/* 2. Main Inspection Jobs Panel */}
      <section className="dash-panel" aria-label="Inspection Jobs Table">
        {/* Panel Header */}
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
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z" />
              <path d="M12 11h4" />
              <path d="M12 16h4" />
              <path d="M8 11h.01" />
              <path d="M8 16h.01" />
            </svg>
            <span>All Inspection Runs</span>
          </h2>
          <span className="dash-panel-badge">
            {isLiveBackend ? "FastAPI Live Dataset" : "Demo Fallback Dataset"}
          </span>
        </div>

        {/* 3. Search and Filters Toolbar */}
        <div className="dash-table-toolbar">
          {/* Search Box */}
          <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
            <input
              type="search"
              className="dash-search-input"
              style={{ width: "100%" }}
              placeholder="Search by Job ID, app, or route..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search inspection jobs by ID, application or route"
            />
          </div>

          {/* Filter Dropdowns */}
          <div className="dash-filter-group">
            {/* Inspection Status Filter */}
            <label className="filter-group-item" htmlFor="inspection-status-filter">
              <span>Status:</span>
              <select
                id="inspection-status-filter"
                className="filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by inspection status"
              >
                <option value="all">All Statuses</option>
                <option value="running">Running</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="needs-review">Needs Review</option>
                <option value="pending">Pending</option>
              </select>
            </label>

            {/* Validation Status Filter */}
            <label className="filter-group-item" htmlFor="validation-status-filter">
              <span>Validation:</span>
              <select
                id="validation-status-filter"
                className="filter-select"
                value={validationFilter}
                onChange={(e) => setValidationFilter(e.target.value)}
                aria-label="Filter by self-healing validation status"
              >
                <option value="all">All Validations</option>
                <option value="passed">Validated (Passed)</option>
                <option value="needs-review">Needs Review</option>
                <option value="failed">Validation Failed</option>
                <option value="pending">Pending</option>
                <option value="running">Running</option>
                <option value="not-applicable">N/A (Clean Run)</option>
              </select>
            </label>
          </div>
        </div>

        {/* Filter Summary & Count Row */}
        <div className="filter-summary-row">
          <div>
            Showing <strong>{filteredJobs.length}</strong> of <strong>{jobs.length}</strong> inspection jobs
            {hasActiveFilters && <span style={{ marginLeft: "0.5rem" }}>(filtered)</span>}
          </div>

          {hasActiveFilters && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {searchQuery && (
                <span className="active-filter-chip">Query: "{searchQuery}"</span>
              )}
              {statusFilter !== "all" && (
                <span className="active-filter-chip">Status: {statusFilter}</span>
              )}
              {validationFilter !== "all" && (
                <span className="active-filter-chip">Validation: {validationFilter}</span>
              )}
              <button
                type="button"
                className="clear-filters-link"
                onClick={handleClearFilters}
              >
                Reset all
              </button>
            </div>
          )}
        </div>

        {/* 4. Table or Empty State */}
        <div style={{ marginTop: "1rem" }}>
          {filteredJobs.length === 0 ? (
            <EmptyState
              title="No Inspection Jobs Match Your Filters"
              description="No inspection records match the current search query or status criteria. Try clearing your filters or creating a new inspection run."
              action={{
                label: "Clear All Filters",
                onClick: handleClearFilters,
              }}
            />
          ) : (
            <div className="dash-table-wrapper">
              <table className="dash-table" aria-label="Inspection jobs history table">
                <thead>
                  <tr>
                    <th scope="col">Job ID</th>
                    <th scope="col">Application Name</th>
                    <th scope="col">Date / Time</th>
                    <th scope="col">Inspection Status</th>
                    <th scope="col">Defects Detected</th>
                    <th scope="col">Validation Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => {
                    const defectsCount = job.defectsCount ?? (job.defects?.length || 0);
                    return (
                      <tr key={job.id}>
                        {/* Job ID */}
                        <td className="job-id-cell">
                          <span>#{job.id}</span>
                        </td>

                        {/* Application & Target Route */}
                        <td>
                          <div className="job-app-tag">
                            <span>{job.application}</span>
                            <code style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                              ({job.targetRoute})
                            </code>
                          </div>
                        </td>

                        {/* Date / Time */}
                        <td className="job-time-cell">
                          <span title={job.timestamp}>{job.startedAt}</span>
                        </td>

                        {/* Inspection Status */}
                        <td>
                          <StatusBadge status={job.status} size="sm" />
                        </td>

                        {/* Number of defects detected */}
                        <td>
                          <div
                            className={`defects-count-tag ${defectsCount > 0 ? "has-defects" : "clean"}`}
                          >
                            {defectsCount > 0 ? (
                              <>
                                <span aria-hidden="true">⚠️</span>
                                <span>
                                  {defectsCount} {defectsCount === 1 ? "defect" : "defects"}
                                </span>
                              </>
                            ) : (
                              <>
                                <span aria-hidden="true">✓</span>
                                <span>0 defects</span>
                              </>
                            )}
                          </div>
                        </td>

                        {/* Validation Status */}
                        <td>{renderValidationStatus(job.validationStatus)}</td>

                        {/* Action to view job details */}
                        <td>
                          <Link
                            to={`/qa/jobs/${job.id}`}
                            className="table-action-btn"
                            aria-label={`View details for #${job.id}`}
                          >
                            <span>View Details</span>
                            <span aria-hidden="true">→</span>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
