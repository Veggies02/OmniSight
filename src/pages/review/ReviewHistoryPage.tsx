import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ReviewSidebar } from "../../components/review/ReviewSidebar";
import { reviewRepository } from "../../services/reviewRepository";
import { type ReviewDecisionRecord } from "../../types/review-types";

export const ReviewHistoryPage: React.FC = () => {
  const [history, setHistory] = useState<ReviewDecisionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const records = await reviewRepository.getDecisionHistory();
      setHistory(records);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleReset = async () => {
    if (window.confirm("Are you sure you want to reset all review decisions back to initial state?")) {
      await reviewRepository.resetDecisions();
      await loadHistory();
      window.location.reload();
    }
  };

  return (
    <div className="review-layout-shell" data-testid="review-history-page">
      <ReviewSidebar />

      <main className="review-main-area">
        <header className="review-top-header">
          <div>
            <div className="breadcrumb-nav">
              <Link to="/">Storefront</Link> &gt; <Link to="/review">Review Console</Link> &gt;{" "}
              <span>Decision History</span>
            </div>
            <h1 className="review-page-title">Review Decision Audit Log</h1>
            <p className="review-page-subtitle">
              Audit trail of all human review approvals and rejections recorded during this review session.
            </p>
          </div>

          <div>
            <button
              type="button"
              className="btn btn-sm btn-outline text-rose-500"
              data-testid="btn-reset-history"
              onClick={handleReset}
            >
              Reset Review Session
            </button>
          </div>
        </header>

        <section className="proposals-content-section">
          {loading ? (
            <div className="loading-state">
              <div className="spinner" />
              <p>Loading audit trail...</p>
            </div>
          ) : history.length === 0 ? (
            <div className="empty-state" data-testid="empty-history">
              <div className="empty-icon">📜</div>
              <h3 className="empty-title">No Review Decisions Recorded Yet</h3>
              <p className="empty-subtitle">
                As reviewers approve or reject proposals, decision logs and rationale will appear here.
              </p>
              <Link to="/review" className="btn btn-primary btn-sm">
                Go to Review Queue
              </Link>
            </div>
          ) : (
            <div className="proposal-table-wrapper" data-testid="history-table">
              <table className="review-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Proposal ID</th>
                    <th>Decision</th>
                    <th>Reviewer</th>
                    <th>Feedback / Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((record, index) => (
                    <tr key={index} data-testid={`history-row-${index}`}>
                      <td>
                        <span className="timestamp-text">{new Date(record.timestamp).toLocaleString()}</span>
                      </td>
                      <td>
                        <Link to={`/review/proposals/${record.proposalId}`} className="proposal-id-link">
                          {record.proposalId}
                        </Link>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${
                            record.newStatus === "approved" ? "badge-approved" : "badge-rejected"
                          }`}
                        >
                          {record.newStatus.toUpperCase()}
                        </span>
                      </td>
                      <td>{record.reviewer}</td>
                      <td>
                        <div className="history-notes-text">
                          {record.rejectionReason ? (
                            <span className="text-rose-600 font-medium">{record.rejectionReason}</span>
                          ) : (
                            <span className="text-slate-500">{record.notes || "—"}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
