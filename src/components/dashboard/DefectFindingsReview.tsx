import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  StatusBadge,
  EmptyState,
  type BadgeStatus,
} from "./";
import type {
  DefectFinding,
  DefectSeverity,
  DefectStatus,
  InspectionEvidence,
} from "../../data/mockJobs";
import heroImg from "../../assets/hero.png";

export interface DefectFindingsReviewProps {
  findings: DefectFinding[];
  evidenceList?: InspectionEvidence[];
  title?: string;
  showJobLink?: boolean;
}

export function DefectFindingsReview({
  findings,
  evidenceList = [],
  title = "Defect Findings",
  showJobLink = false,
}: DefectFindingsReviewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("severity-desc");
  const [expandedDefectIds, setExpandedDefectIds] = useState<Set<string>>(
    new Set()
  );

  // Toggle expanded card
  const toggleExpand = (id: string) => {
    setExpandedDefectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    setExpandedDefectIds(new Set(findings.map((f) => f.id)));
  };

  const handleCollapseAll = () => {
    setExpandedDefectIds(new Set());
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setSeverityFilter("all");
    setStatusFilter("all");
    setSortBy("severity-desc");
  };

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    severityFilter !== "all" ||
    statusFilter !== "all" ||
    sortBy !== "severity-desc";

  // Normalize severity to standard 4 tiers: critical, high, medium, low
  const normalizeSeverity = (sev: DefectSeverity): "critical" | "high" | "medium" | "low" => {
    if (sev === "critical") return "critical";
    if (sev === "high" || sev === "major") return "high";
    if (sev === "medium" || sev === "minor") return "medium";
    return "low"; // low or cosmetic
  };

  const getSeverityRank = (sev: DefectSeverity): number => {
    const norm = normalizeSeverity(sev);
    switch (norm) {
      case "critical":
        return 4;
      case "high":
        return 3;
      case "medium":
        return 2;
      case "low":
      default:
        return 1;
    }
  };

  const getSeverityLabel = (sev: DefectSeverity): string => {
    const norm = normalizeSeverity(sev);
    switch (norm) {
      case "critical":
        return "Critical";
      case "high":
        return "High";
      case "medium":
        return "Medium";
      case "low":
      default:
        return "Low";
    }
  };

  // Status mapping
  const normalizeStatus = (status: DefectStatus): string => {
    if (status === "under-review" || status === "pending-review") return "under-review";
    if (status === "fix-staged") return "fix-staged";
    if (status === "resolved") return "resolved";
    return "open";
  };

  const getStatusBadgeConfig = (status: DefectStatus): { badgeStatus: BadgeStatus; label: string } => {
    const norm = normalizeStatus(status);
    switch (norm) {
      case "resolved":
        return { badgeStatus: "passed", label: "Resolved" };
      case "fix-staged":
        return { badgeStatus: "needs-review", label: "Fix Staged" };
      case "under-review":
        return { badgeStatus: "needs-review", label: "Under Review" };
      case "open":
      default:
        return { badgeStatus: "failed", label: "Open" };
    }
  };

  // Filter and sort findings
  const filteredAndSortedFindings = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    const filtered = findings.filter((f) => {
      // 1. Search Query
      const matchesSearch =
        !q ||
        f.id.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q) ||
        f.affectedComponent.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        (f.category && f.category.toLowerCase().includes(q)) ||
        (f.jobId && f.jobId.toLowerCase().includes(q));

      // 2. Severity Filter
      const normSev = normalizeSeverity(f.severity);
      const matchesSeverity = severityFilter === "all" || normSev === severityFilter;

      // 3. Status Filter
      const normStatus = normalizeStatus(f.status);
      const matchesStatus = statusFilter === "all" || normStatus === statusFilter;

      return matchesSearch && matchesSeverity && matchesStatus;
    });

    // Sorting
    return [...filtered].sort((a, b) => {
      if (sortBy === "severity-desc") {
        return getSeverityRank(b.severity) - getSeverityRank(a.severity);
      }
      if (sortBy === "severity-asc") {
        return getSeverityRank(a.severity) - getSeverityRank(b.severity);
      }
      if (sortBy === "title-asc") {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === "title-desc") {
        return b.title.localeCompare(a.title);
      }
      if (sortBy === "id-asc") {
        return a.id.localeCompare(b.id);
      }
      if (sortBy === "id-desc") {
        return b.id.localeCompare(a.id);
      }
      return 0;
    });
  }, [findings, searchQuery, severityFilter, statusFilter, sortBy]);

  // Lookup evidence for a defect
  const getEvidenceForDefect = (defect: DefectFinding): InspectionEvidence | undefined => {
    if (!defect.evidenceRef) return undefined;
    return evidenceList.find((e) => e.id.toLowerCase() === defect.evidenceRef?.toLowerCase());
  };

  return (
    <div className="defect-findings-review-container">
      {/* 1. Header & Actions Toolbar */}
      <div className="dash-panel-header" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h3 className="dash-panel-title">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{title}</span>
          </h3>
          <span className="job-meta-sub" style={{ marginTop: "0.2rem", display: "block" }}>
            Triage visual discrepancies, inspect affected code components, and review evidence.
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="filter-pill-btn"
            onClick={handleExpandAll}
            title="Expand all defect cards"
          >
            Expand All
          </button>
          <button
            type="button"
            className="filter-pill-btn"
            onClick={handleCollapseAll}
            title="Collapse all defect cards"
          >
            Collapse All
          </button>
          <span className="dash-panel-badge">
            {filteredAndSortedFindings.length} of {findings.length} Shown
          </span>
        </div>
      </div>

      {/* 2. Review Controls: Search, Severity Filter, Status Filter, Sort */}
      <div className="dash-table-toolbar" style={{ marginTop: "0.5rem" }}>
        {/* Search Input */}
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 360 }}>
          <input
            type="search"
            className="dash-search-input"
            style={{ width: "100%" }}
            placeholder="Search by ID, title, or component..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search defect findings"
          />
        </div>

        {/* Filter & Sort Controls */}
        <div className="dash-filter-group">
          {/* Severity Filter */}
          <label className="filter-group-item" htmlFor="defect-severity-filter">
            <span>Severity:</span>
            <select
              id="defect-severity-filter"
              className="filter-select"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              aria-label="Filter by defect severity"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          {/* Status Filter */}
          <label className="filter-group-item" htmlFor="defect-status-filter">
            <span>Status:</span>
            <select
              id="defect-status-filter"
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by defect status"
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="under-review">Under Review</option>
              <option value="fix-staged">Fix Staged</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>

          {/* Sort By */}
          <label className="filter-group-item" htmlFor="defect-sort-by">
            <span>Sort:</span>
            <select
              id="defect-sort-by"
              className="filter-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label="Sort defect findings"
            >
              <option value="severity-desc">Severity (High → Low)</option>
              <option value="severity-asc">Severity (Low → High)</option>
              <option value="title-asc">Title (A → Z)</option>
              <option value="title-desc">Title (Z → A)</option>
              <option value="id-asc">ID (Ascending)</option>
              <option value="id-desc">ID (Descending)</option>
            </select>
          </label>
        </div>
      </div>

      {/* Filter Summary Row */}
      <div className="filter-summary-row">
        <div>
          Showing <strong>{filteredAndSortedFindings.length}</strong> of <strong>{findings.length}</strong> findings
          {hasActiveFilters && (
            <span style={{ marginLeft: "0.5rem" }}>
              (filtered)
            </span>
          )}
        </div>

        {hasActiveFilters && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {searchQuery && (
              <span className="active-filter-chip">
                Query: "{searchQuery}"
              </span>
            )}
            {severityFilter !== "all" && (
              <span className="active-filter-chip">
                Severity: {severityFilter}
              </span>
            )}
            {statusFilter !== "all" && (
              <span className="active-filter-chip">
                Status: {statusFilter}
              </span>
            )}
            {sortBy !== "severity-desc" && (
              <span className="active-filter-chip">
                Sorted
              </span>
            )}
            <button
              type="button"
              className="clear-filters-link"
              onClick={handleClearFilters}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* 3. Findings List or Empty State */}
      <div style={{ marginTop: "1.25rem" }}>
        {filteredAndSortedFindings.length === 0 ? (
          <EmptyState
            title="No Defect Findings Match Selected Filters"
            description={
              hasActiveFilters
                ? "No defects match your current search query or filter settings. Try clearing active filters or searching for different keywords."
                : "Zero defects detected for this inspection job."
            }
            action={
              hasActiveFilters
                ? {
                    label: "Clear All Filters",
                    onClick: handleClearFilters,
                  }
                : undefined
            }
          />
        ) : (
          <div className="defect-finding-list">
            {filteredAndSortedFindings.map((defect) => {
              const isExpanded = expandedDefectIds.has(defect.id);
              const normSev = normalizeSeverity(defect.severity);
              const statusCfg = getStatusBadgeConfig(defect.status);
              const attachedEvidence = getEvidenceForDefect(defect);

              return (
                <div
                  key={defect.id}
                  className={`defect-finding-card severity-${normSev} ${isExpanded ? "expanded" : ""}`}
                >
                  {/* Card Header (Clickable to toggle expand) */}
                  <div
                    className="defect-finding-header"
                    style={{ cursor: "pointer" }}
                    onClick={() => toggleExpand(defect.id)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleExpand(defect.id);
                      }
                    }}
                  >
                    <div className="defect-title-group">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                        <span className="job-id-cell">#{defect.id}</span>
                        <h4 className="defect-finding-title">{defect.title}</h4>
                      </div>

                      {showJobLink && defect.jobId && (
                        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.15rem" }}>
                          Originating Run:{" "}
                          <Link
                            to={`/qa/jobs/${defect.jobId}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: "var(--color-accent)", textDecoration: "underline", fontWeight: 600 }}
                          >
                            #{defect.jobId} {defect.targetRoute ? `(${defect.targetRoute})` : ""}
                          </Link>
                        </div>
                      )}
                    </div>

                    <div className="defect-tag-row" onClick={(e) => e.stopPropagation()}>
                      <span className={`severity-badge severity-${normSev}`}>
                        {getSeverityLabel(defect.severity)}
                      </span>

                      <span className="defect-category-pill">
                        {defect.category || "General"}
                      </span>

                      <StatusBadge
                        status={statusCfg.badgeStatus}
                        label={statusCfg.label}
                        size="sm"
                      />

                      <button
                        type="button"
                        className="table-action-btn"
                        onClick={() => toggleExpand(defect.id)}
                        aria-label={isExpanded ? `Collapse defect ${defect.id}` : `Expand defect ${defect.id}`}
                        style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                      >
                        <span>{isExpanded ? "Collapse ▲" : "Details ▼"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Summary Description */}
                  <p className="defect-finding-desc">{defect.description}</p>

                  {/* Key Metadata Pill Row */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
                    <div>
                      <span style={{ color: "var(--color-text-muted)", marginRight: "0.3rem" }}>Component:</span>
                      <code className="defect-selector-code">
                        {defect.affectedComponent || "Not specified"}
                      </code>
                    </div>

                    {defect.evidenceRef && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                        <span style={{ color: "var(--color-text-muted)" }}>Evidence Ref:</span>
                        <span className="active-filter-chip" style={{ fontSize: "0.72rem" }}>
                          #{defect.evidenceRef}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Expandable Finding Detail Section */}
                  {isExpanded && (
                    <div
                      className="defect-expanded-details"
                      style={{
                        marginTop: "0.75rem",
                        paddingTop: "0.75rem",
                        borderTop: "1px dashed var(--dash-card-border)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.85rem",
                      }}
                    >
                      {/* DOM Selector */}
                      <div>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: "var(--color-text-muted)", display: "block", marginBottom: "0.25rem" }}>
                          DOM Selector / Locator
                        </span>
                        {defect.selector ? (
                          <code className="defect-selector-code" style={{ display: "inline-block" }}>
                            {defect.selector}
                          </code>
                        ) : (
                          <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>
                            None specified in finding payload
                          </span>
                        )}
                      </div>

                      {/* Evidence Attachment Viewer */}
                      <div>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: "var(--color-text-muted)", display: "block", marginBottom: "0.35rem" }}>
                          Screenshot & Trace Evidence
                        </span>

                        {attachedEvidence ? (
                          <div className="evidence-card" style={{ maxWidth: 540, marginTop: "0.25rem" }}>
                            <div className="evidence-header">
                              <h5 className="evidence-title" style={{ fontSize: "0.875rem" }}>
                                {attachedEvidence.title}
                              </h5>
                              <span className="defect-category-pill" style={{ textTransform: "capitalize" }}>
                                {attachedEvidence.type.replace("-", " ")}
                              </span>
                            </div>

                            <div className="evidence-preview-box" style={{ minHeight: 120 }}>
                              <span className="evidence-preview-watermark">
                                {attachedEvidence.dimensions || attachedEvidence.viewport}
                              </span>

                              {attachedEvidence.id === "EVI-301" ? (
                                <img
                                  src={heroImg}
                                  alt="Defect evidence snapshot"
                                  className="evidence-preview-img"
                                />
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem" }}>
                                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <rect width="20" height="14" x="2" y="3" rx="2" />
                                    <line x1="8" y1="21" x2="16" y2="21" />
                                    <line x1="12" y1="17" x2="12" y2="21" />
                                  </svg>
                                  <span style={{ fontSize: "0.8rem", color: "#f8fafc", fontWeight: 600 }}>
                                    {attachedEvidence.title}
                                  </span>
                                  <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                                    Viewport: {attachedEvidence.viewport}
                                  </span>
                                </div>
                              )}
                            </div>

                            {attachedEvidence.description && (
                              <p style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", margin: 0 }}>
                                {attachedEvidence.description}
                              </p>
                            )}

                            <div className="evidence-meta-row" style={{ fontSize: "0.72rem" }}>
                              <span>Captured: <strong>{attachedEvidence.capturedAt}</strong></span>
                              <span>Artifact ID: <code>#{attachedEvidence.id}</code></span>
                            </div>

                            <div style={{ marginTop: "0.5rem", display: "flex", justifyContent: "flex-end" }}>
                              <a
                                href="#visual-evidence-viewer"
                                className="filter-pill-btn"
                                style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                                onClick={() => {
                                  document.getElementById("visual-evidence-viewer")?.scrollIntoView({ behavior: "smooth" });
                                }}
                              >
                                <span>Inspect in Comparison Viewer →</span>
                              </a>
                            </div>
                          </div>
                        ) : (
                          <div
                            style={{
                              backgroundColor: "var(--color-surface-subtle)",
                              border: "1px dashed var(--color-border)",
                              borderRadius: "var(--radius-sm)",
                              padding: "0.75rem 1rem",
                              fontSize: "0.8rem",
                              color: "var(--color-text-muted)",
                            }}
                          >
                            <span aria-hidden="true">📷 </span>
                            No screenshot or visual artifact attached to this finding.
                          </div>
                        )}
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
