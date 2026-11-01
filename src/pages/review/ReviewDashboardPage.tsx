import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ReviewSidebar } from "../../components/review/ReviewSidebar";
import { ReviewSummaryCards } from "../../components/review/ReviewSummaryCards";
import { ProposalFilters } from "../../components/review/ProposalFilters";
import { ProposalList } from "../../components/review/ProposalList";
import { reviewRepository } from "../../services/reviewRepository";
import {
  type ProposalFilterState,
  type ReviewDashboardStats,
  type ReviewProposalItem,
} from "../../types/review-types";

export const ReviewDashboardPage: React.FC = () => {
  const [proposals, setProposals] = useState<ReviewProposalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<ProposalFilterState>({
    category: "all",
    reviewStatus: "all",
    freshness: "all",
    minConfidence: 0,
    searchQuery: "",
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const items = await reviewRepository.getAllProposals();
      setProposals(items);
    } catch (err: any) {
      setError(err.message || "Failed to load repair proposals.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const stats: ReviewDashboardStats = {
    totalProposals: proposals.length,
    awaitingReview: proposals.filter((p) => p.humanReviewStatus === "pending_review").length,
    approved: proposals.filter((p) => p.humanReviewStatus === "approved").length,
    rejected: proposals.filter((p) => p.humanReviewStatus === "rejected").length,
    staleOrBlocked: proposals.filter((p) => p.sourceFreshness === "stale" || p.status === "stale_source").length,
  };

  const filteredProposals = proposals.filter((p) => {
    if (filters.category !== "all" && p.defectCategory !== filters.category) {
      return false;
    }
    if (filters.reviewStatus !== "all" && p.humanReviewStatus !== filters.reviewStatus) {
      return false;
    }
    if (filters.freshness !== "all" && p.sourceFreshness !== filters.freshness) {
      return false;
    }
    if (p.confidenceScore < filters.minConfidence) {
      return false;
    }
    if (filters.searchQuery.trim()) {
      const q = filters.searchQuery.toLowerCase();
      const matchId = p.proposalId.toLowerCase().includes(q);
      const matchScenario = p.scenarioId.toLowerCase().includes(q);
      const matchFile = (p.localization.filePath || "").toLowerCase().includes(q);
      const matchDesc = p.suspectedRootCause.toLowerCase().includes(q);
      if (!matchId && !matchScenario && !matchFile && !matchDesc) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="review-layout-shell" data-testid="review-dashboard">
      <ReviewSidebar />

      <main className="review-main-area">
        <header className="review-top-header">
          <div>
            <div className="breadcrumb-nav">
              <Link to="/">Storefront</Link> &gt; <span>Review Console</span> &gt; <span>Proposals</span>
            </div>
            <h1 className="review-page-title" data-testid="dashboard-title">
              Human-in-the-Loop Repair Review
            </h1>
            <p className="review-page-subtitle">
              Inspect AI/VLM-diagnosed UI defects, verify bounded source localizations, and approve or reject proposed non-destructive code fixes.
            </p>
          </div>

          <div className="header-badge-group">
            <span className="badge-demo-mode" title="Client-side simulated persistence via repository adapter">
              DEMO MODE
            </span>
            <span className="badge-review-queue" data-testid="badge-queue-count">
              {stats.awaitingReview} Awaiting Review
            </span>
          </div>
        </header>

        {/* Multi-Scenario Prototype Announcement Banner */}
        <div
          data-testid="multi-scenario-banner"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.75rem 1.25rem",
            backgroundColor: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "8px",
            marginBottom: "1.25rem",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <div>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "#1e40af",
                backgroundColor: "#dbeafe",
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                marginRight: "0.5rem",
              }}
            >
              DAY 14 PROTOTYPE
            </span>
            <span style={{ fontSize: "0.875rem", color: "#1e3a8a", fontWeight: 600 }}>
              Multi-Scenario Capture Job Architecture:
            </span>{" "}
            <span style={{ fontSize: "0.85rem", color: "#2563eb" }}>
              Inspect multiple defects per capture job with independent approvals & repairs.
            </span>
          </div>
          <Link
            to="/review/jobs"
            data-testid="link-to-multi-scenario"
            className="btn btn-primary btn-sm"
            style={{
              backgroundColor: "#2563eb",
              borderColor: "#2563eb",
              fontSize: "0.8rem",
              padding: "0.35rem 0.8rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Explore Multi-Scenario Job #1024 ➔
          </Link>
        </div>

        <ReviewSummaryCards stats={stats} />

        <section className="proposals-content-section">
          <div className="section-title-row">
            <h2 className="section-heading">Available Repair Proposals</h2>
            <span className="results-count-text">
              Showing {filteredProposals.length} of {proposals.length} proposals
            </span>
          </div>

          <ProposalFilters
            filters={filters}
            onFilterChange={setFilters}
            onReset={() =>
              setFilters({
                category: "all",
                reviewStatus: "all",
                freshness: "all",
                minConfidence: 0,
                searchQuery: "",
              })
            }
          />

          {loading ? (
            <div className="loading-state" data-testid="proposals-loading">
              <div className="spinner" />
              <p>Loading proposal review queue...</p>
            </div>
          ) : error ? (
            <div className="error-state" data-testid="proposals-error">
              <p>Failed to load proposals: {error}</p>
              <button type="button" className="btn btn-sm btn-outline" onClick={loadData}>
                Retry
              </button>
            </div>
          ) : (
            <ProposalList proposals={filteredProposals} />
          )}
        </section>
      </main>
    </div>
  );
};
