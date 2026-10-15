import React from "react";
import { Link } from "react-router-dom";
import { type ReviewProposalItem } from "../../types/review-types";

interface ProposalListProps {
  proposals: ReviewProposalItem[];
}

export const ProposalList: React.FC<ProposalListProps> = ({ proposals }) => {
  if (proposals.length === 0) {
    return (
      <div className="empty-state" data-testid="empty-proposals">
        <div className="empty-icon">🔍</div>
        <h3 className="empty-title">No repair proposals match your criteria</h3>
        <p className="empty-subtitle">
          Try adjusting your filter selection or clear search terms to view available review proposals.
        </p>
      </div>
    );
  }

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "approved":
        return "badge-approved";
      case "rejected":
        return "badge-rejected";
      case "pending_review":
      default:
        return "badge-pending";
    }
  };

  const getFreshnessBadgeClass = (freshness: string) => {
    switch (freshness) {
      case "fresh":
        return "badge-fresh";
      case "stale":
        return "badge-stale";
      default:
        return "badge-unverified";
    }
  };

  return (
    <div className="proposal-table-wrapper" data-testid="proposal-list">
      <table className="review-table">
        <thead>
          <tr>
            <th>Proposal & Defect</th>
            <th>Target Source</th>
            <th>Confidence</th>
            <th>Source State</th>
            <th>Review Status</th>
            <th>Created</th>
            <th className="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {proposals.map((item) => (
            <tr key={item.proposalId} data-testid={`proposal-row-${item.proposalId}`}>
              <td>
                <div className="proposal-cell-main">
                  <Link
                    to={`/review/proposals/${item.proposalId}`}
                    className="proposal-id-link"
                    data-testid={`link-${item.proposalId}`}
                  >
                    {item.proposalId}
                  </Link>
                  <span className="proposal-category-chip">{item.defectCategory}</span>
                </div>
                <div className="proposal-scenario-text">{item.scenarioId}</div>
              </td>

              <td>
                <div className="proposal-source-path">
                  <code>{item.localization.filePath || "Unlocalized"}</code>
                </div>
                <div className="proposal-target-selector">
                  {item.localization.componentOrSelector || "—"}
                </div>
              </td>

              <td>
                <div className="confidence-pill">
                  <span className="confidence-val">{(item.confidenceScore * 100).toFixed(0)}%</span>
                  <span className="confidence-lbl">({item.confidence})</span>
                </div>
              </td>

              <td>
                <span className={`status-badge ${getFreshnessBadgeClass(item.sourceFreshness)}`}>
                  {item.sourceFreshness.toUpperCase()}
                </span>
              </td>

              <td>
                <span
                  className={`status-badge ${getStatusBadgeClass(item.humanReviewStatus)}`}
                  data-testid={`status-${item.proposalId}`}
                >
                  {item.humanReviewStatus === "pending_review"
                    ? "PENDING"
                    : item.humanReviewStatus.toUpperCase()}
                </span>
              </td>

              <td>
                <span className="timestamp-text">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </td>

              <td className="text-right">
                <Link
                  to={`/review/proposals/${item.proposalId}`}
                  className="btn btn-sm btn-outline"
                  data-testid={`btn-review-${item.proposalId}`}
                >
                  Review Proposal →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
