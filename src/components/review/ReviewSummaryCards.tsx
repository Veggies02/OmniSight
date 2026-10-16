import React from "react";
import { type ReviewDashboardStats } from "../../types/review-types";

interface ReviewSummaryCardsProps {
  stats: ReviewDashboardStats;
}

export const ReviewSummaryCards: React.FC<ReviewSummaryCardsProps> = ({ stats }) => {
  return (
    <div className="review-stats-grid" data-testid="review-summary-cards">
      <div className="stat-card" data-testid="stat-total">
        <span className="stat-card-label">Total Proposals</span>
        <span className="stat-card-value">{stats.totalProposals}</span>
        <span className="stat-card-sub">Active in review queue</span>
      </div>

      <div className="stat-card stat-card-pending" data-testid="stat-pending">
        <span className="stat-card-label">Awaiting Review</span>
        <span className="stat-card-value text-amber-500">{stats.awaitingReview}</span>
        <span className="stat-card-sub">Requires human review</span>
      </div>

      <div className="stat-card stat-card-approved" data-testid="stat-approved">
        <span className="stat-card-label">Approved</span>
        <span className="stat-card-value text-emerald-500">{stats.approved}</span>
        <span className="stat-card-sub">Ready for next patch phase</span>
      </div>

      <div className="stat-card stat-card-rejected" data-testid="stat-rejected">
        <span className="stat-card-label">Rejected</span>
        <span className="stat-card-value text-rose-500">{stats.rejected}</span>
        <span className="stat-card-sub">Discarded with rationale</span>
      </div>

      <div className="stat-card stat-card-stale" data-testid="stat-stale">
        <span className="stat-card-label">Stale / Blocked</span>
        <span className="stat-card-value text-slate-400">{stats.staleOrBlocked}</span>
        <span className="stat-card-sub">Source modified on disk</span>
      </div>
    </div>
  );
};
