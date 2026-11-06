import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useOmniSight } from "../../context/OmniSightContext";

export const ActivityLogsPage: React.FC = () => {
  const { activityLogs } = useOmniSight();
  const [filterType, setFilterType] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredLogs = activityLogs.filter((log) => {
    if (filterType !== "all" && log.type !== filterType) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return (
        log.title.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q) ||
        log.userOrAgent.toLowerCase().includes(q) ||
        (log.referenceId && log.referenceId.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div>
      {/* Header */}
      <div className="omni-page-header" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: "2rem" }}>
        <div>
          <div className="omni-eyebrow">
            <span>Audit Trail & Event Ledger</span>
          </div>
          <h1 className="omni-title">
            System Activity & Audit Logs
          </h1>
          <p className="omni-description">
            Chronological audit log tracking automated RPA crawls, VLM diagnoses, human review decisions, and isolated patch executions.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", justifyContent: "space-between", marginBottom: "1.75rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", flex: 1, minWidth: "260px" }}>
          <input
            type="text"
            placeholder="Search audit events by keyword, agent, or ID..."
            className="omni-input"
            style={{ maxWidth: "380px" }}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          <select
            className="omni-select"
            style={{ width: "auto" }}
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">All Event Types</option>
            <option value="inspection_started">Inspection Runs</option>
            <option value="defect_detected">Defects Detected</option>
            <option value="repair_proposed">Proposals Synthesized</option>
            <option value="repair_approved">Review Approvals</option>
            <option value="repair_rejected">Review Rejections</option>
            <option value="verification_passed">Verified Repaired</option>
          </select>
        </div>

        <div style={{ fontSize: "0.875rem", color: "var(--theme-on-surface-variant)" }}>
          Showing <strong>{filteredLogs.length}</strong> of {activityLogs.length} events
        </div>
      </div>

      {/* Audit Table */}
      <div className="omni-table-wrapper">
        <table className="omni-table">
          <thead>
            <tr>
              <th style={{ width: "180px" }}>Timestamp</th>
              <th style={{ width: "160px" }}>Actor / Agent</th>
              <th>Event Description & Details</th>
              <th style={{ width: "140px" }}>Reference</th>
              <th style={{ width: "100px", textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--theme-on-surface-subtle)", whiteSpace: "nowrap" }}>
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td>
                    <span className="omni-badge omni-badge-neutral">
                      {log.userOrAgent}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.2rem" }}>
                      {log.title}
                    </div>
                    <div style={{ fontSize: "0.8125rem", color: "var(--theme-on-surface-variant)", lineHeight: 1.5 }}>
                      {log.details}
                    </div>
                  </td>
                  <td>
                    {log.referenceId ? (
                      <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", background: "var(--theme-container)", padding: "2px 6px", borderRadius: "var(--radius-xs)", border: "1px solid var(--theme-outline)" }}>
                        {log.referenceId}
                      </code>
                    ) : (
                      <span style={{ color: "var(--theme-on-surface-subtle)", fontSize: "0.75rem" }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {log.linkTo ? (
                      <Link to={log.linkTo} className="omni-btn omni-btn-outline omni-btn-sm" style={{ padding: "0.25rem 0.625rem" }}>
                        View ↗
                      </Link>
                    ) : (
                      <span style={{ color: "var(--theme-on-surface-subtle)", fontSize: "0.75rem" }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "4rem", color: "var(--theme-on-surface-variant)" }}>
                  No activity logs match the selected filter criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
