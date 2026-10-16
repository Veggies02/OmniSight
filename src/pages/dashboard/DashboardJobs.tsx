import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  LoadingState,
  type BadgeStatus,
} from "../../components/dashboard";
import {
  MOCK_INSPECTION_JOBS,
  type InspectionJob,
  type ValidationStatus,
} from "../../data/mockJobs";

export function DashboardJobs() {
  const [jobs] = useState<InspectionJob[]>(MOCK_INSPECTION_JOBS);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [validationFilter, setValidationFilter] = useState<string>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

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
    return jobs.filter((job) => {
      // 1. Search Query filter (matches Job ID, Application, or Target Route)
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

  // Handle simulated dataset refresh
  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 400);
  };

  // Helper to render Validation Status badge
  const renderValidationStatus = (valStatus: ValidationStatus) => {
    if (valStatus === "not-applicable") {
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
    };

    const labelMap: Record<string, string> = {
      passed: "Validated",
      failed: "Failed",
      "needs-review": "Needs Review",
      pending: "Pending",
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
              className={`dash-header-btn ${isRefreshing ? "is-refreshing" : ""}`}
              onClick={handleRefresh}
              aria-label="Refresh job history"
              title="Refresh simulated jobs"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="btn-refresh-icon" aria-hidden="true">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
              <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
            </button>

            <Link to="/qa" className="dash-header-btn">
              ← Overview
            </Link>
          </div>
        }
      />

      {/* Refresh indicator */}
      {isRefreshing && (
        <div style={{ marginBottom: "1.25rem" }}>
          <LoadingState inline message="Refreshing inspection job dataset..." />
        </div>
      )}

      {/* 2. Main Inspection Jobs Panel */}
      <section className="dash-panel" aria-label="Inspection Jobs Table">
        {/* Panel Header */}
        <div className="dash-panel-header">
          <h2 className="dash-panel-title">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z" />
              <path d="M12 11h4" />
              <path d="M12 16h4" />
              <path d="M8 11h.01" />
              <path d="M8 16h.01" />
            </svg>
            <span>All Inspection Runs</span>
          </h2>
          <span className="dash-panel-badge">Mock / Demo Dataset</span>
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
                <option value="not-applicable">N/A (Clean Run)</option>
              </select>
            </label>
          </div>
        </div>

        {/* Filter Summary & Count Row */}
        <div className="filter-summary-row">
          <div>
            Showing <strong>{filteredJobs.length}</strong> of <strong>{jobs.length}</strong> inspection jobs
            {hasActiveFilters && (
              <span style={{ marginLeft: "0.5rem" }}>
                (filtered)
              </span>
            )}
          </div>

          {hasActiveFilters && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {searchQuery && (
                <span className="active-filter-chip">
                  Query: "{searchQuery}"
                </span>
              )}
              {statusFilter !== "all" && (
                <span className="active-filter-chip">
                  Status: {statusFilter}
                </span>
              )}
              {validationFilter !== "all" && (
                <span className="active-filter-chip">
                  Validation: {validationFilter}
                </span>
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
              description="No inspection records match the current search query or status criteria. Try clearing your filters or searching with a different keyword."
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
                  {filteredJobs.map((job) => (
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
                          className={`defects-count-tag ${
                            job.defectsCount > 0 ? "has-defects" : "clean"
                          }`}
                        >
                          {job.defectsCount > 0 ? (
                            <>
                              <span aria-hidden="true">⚠️</span>
                              <span>{job.defectsCount} {job.defectsCount === 1 ? "defect" : "defects"}</span>
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
                      <td>
                        {renderValidationStatus(job.validationStatus)}
                      </td>

                      {/* Action to view job details */}
                      <td>
                        <Link
                          to={`/qa/jobs/${job.id}`}
                          className="table-action-btn"
                          aria-label={`View details for ${job.id}`}
                        >
                          <span>View Details</span>
                          <span aria-hidden="true">→</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
