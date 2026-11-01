import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ReviewSidebar } from "../../components/review/ReviewSidebar";
import { JobSummaryMetrics } from "../../components/multi-scenario/JobSummaryMetrics";
import { ScenarioCard } from "../../components/multi-scenario/ScenarioCard";
import { multiScenarioRepository } from "../../services/multiScenarioRepository";
import {
  computeJobSummary,
  type CaptureJob,
} from "../../types/multi-scenario-types";

export const MultiScenarioJobPage: React.FC = () => {
  const { jobId = "job-1024" } = useParams<{ jobId?: string }>();
  const [job, setJob] = useState<CaptureJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const loadJob = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await multiScenarioRepository.getJobById(jobId);
      if (!data) {
        setError(`Capture job with ID '${jobId}' was not found.`);
      } else {
        setJob(data);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load multi-scenario job");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJob();
  }, [jobId]);

  const handleApproveScenario = async (scenarioId: string) => {
    if (!job) return;
    try {
      const updatedScenario = await multiScenarioRepository.approveScenario(
        job.jobId,
        scenarioId
      );
      setJob((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          scenarios: prev.scenarios.map((s) =>
            s.scenarioId === scenarioId ? updatedScenario : s
          ),
        };
      });
      setNotification({
        type: "success",
        message: `Approved scenario '${updatedScenario.title}' independently. Ready for repair simulation.`,
      });
    } catch (err: any) {
      setNotification({ type: "error", message: err.message });
    }
  };

  const handleRejectScenario = async (scenarioId: string, reason: string) => {
    if (!job) return;
    try {
      const updatedScenario = await multiScenarioRepository.rejectScenario(
        job.jobId,
        scenarioId,
        reason
      );
      setJob((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          scenarios: prev.scenarios.map((s) =>
            s.scenarioId === scenarioId ? updatedScenario : s
          ),
        };
      });
      setNotification({
        type: "info",
        message: `Rejected scenario '${updatedScenario.title}' with recorded reason.`,
      });
    } catch (err: any) {
      setNotification({ type: "error", message: err.message });
    }
  };

  const handleSimulateRepair = async (
    scenarioId: string,
    onProgress: (step: string) => void
  ) => {
    if (!job) return;
    try {
      const updatedScenario = await multiScenarioRepository.simulateRepair(
        job.jobId,
        scenarioId,
        onProgress
      );
      setJob((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          scenarios: prev.scenarios.map((s) =>
            s.scenarioId === scenarioId ? updatedScenario : s
          ),
        };
      });
      const isSuccess = updatedScenario.status === "repaired";
      setNotification({
        type: isSuccess ? "success" : "error",
        message: isSuccess
          ? `Simulated repair succeeded for '${updatedScenario.title}'!`
          : `Simulated repair failed for '${updatedScenario.title}' during visual validation.`,
      });
    } catch (err: any) {
      setNotification({ type: "error", message: err.message });
    }
  };

  const handleResetJob = async () => {
    if (!job) return;
    try {
      const reset = await multiScenarioRepository.resetJob(job.jobId);
      setJob(reset);
      setFilter("all");
      setSearchQuery("");
      setNotification({
        type: "info",
        message: "Reset multi-scenario job to initial mock state.",
      });
    } catch (err: any) {
      setNotification({ type: "error", message: err.message });
    }
  };

  if (loading) {
    return (
      <div className="review-layout-shell" data-testid="multi-scenario-loading">
        <ReviewSidebar />
        <main className="review-main-area">
          <div className="loading-state">
            <div className="spinner" />
            <p>Loading multi-scenario capture job...</p>
          </div>
        </main>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="review-layout-shell" data-testid="multi-scenario-error">
        <ReviewSidebar />
        <main className="review-main-area">
          <div className="error-state">
            <h2>Capture Job Not Found</h2>
            <p>{error || "The requested multi-scenario job could not be retrieved."}</p>
            <Link to="/review" className="btn btn-primary btn-sm">
              Back to Review Console
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const summary = computeJobSummary(job.scenarios);

  const filteredScenarios = job.scenarios.filter((s) => {
    if (filter === "pending" && s.approvalStatus !== "pending") return false;
    if (filter === "approved" && (s.approvalStatus !== "approved" || s.status === "repaired")) return false;
    if (filter === "rejected" && s.approvalStatus !== "rejected") return false;
    if (filter === "repaired" && s.status !== "repaired") return false;
    if (filter === "failed" && s.status !== "failed") return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = s.title.toLowerCase().includes(q);
      const matchDefect = s.defectType.toLowerCase().includes(q);
      const matchPatch = s.patchId.toLowerCase().includes(q);
      const matchDiag = s.diagnosis.toLowerCase().includes(q);
      if (!matchTitle && !matchDefect && !matchPatch && !matchDiag) return false;
    }

    return true;
  });

  return (
    <div className="review-layout-shell" data-testid="multi-scenario-job-page">
      <ReviewSidebar />

      <main className="review-main-area">
        {/* Navigation Breadcrumb */}
        <header className="review-detail-header" style={{ marginBottom: "1rem" }}>
          <div className="breadcrumb-nav">
            <Link to="/">Storefront</Link> &gt; <Link to="/review">Review Console</Link> &gt;{" "}
            <span>Multi-Scenario Job {job.jobId}</span>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              flexWrap: "wrap",
              gap: "1rem",
              marginTop: "0.5rem",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                <span
                  style={{
                    backgroundColor: "#eff6ff",
                    color: "#2563eb",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    padding: "0.15rem 0.5rem",
                    borderRadius: "4px",
                    border: "1px solid #bfdbfe",
                  }}
                >
                  MULTI-SCENARIO FOUNDATION [PROTOTYPE]
                </span>
                <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
                  Target: <code>{job.targetUrl}</code>
                </span>
              </div>
              <h1
                data-testid="job-title"
                style={{ fontSize: "1.65rem", fontWeight: 800, margin: 0, color: "#1e293b" }}
              >
                {job.title}
              </h1>
              <p style={{ margin: "0.25rem 0 0 0", color: "#64748b", fontSize: "0.85rem" }}>
                Job ID: <code data-testid="job-id-label">{job.jobId}</code> &bull; Created:{" "}
                {new Date(job.createdAt).toLocaleString()}
              </p>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button
                type="button"
                data-testid="btn-reset-demo-state"
                onClick={handleResetJob}
                className="btn btn-secondary btn-sm"
                title="Reset all scenarios in this job to initial mock state"
              >
                ↻ Reset Demo State
              </button>
            </div>
          </div>
        </header>

        {/* Reactive Notification Banner */}
        {notification && (
          <div
            data-testid="multi-scenario-notification"
            className={`alert-banner ${
              notification.type === "success"
                ? "alert-success"
                : notification.type === "error"
                ? "alert-error"
                : "alert-info"
            }`}
            style={{ marginBottom: "1rem" }}
          >
            <span>{notification.message}</span>
            <button
              type="button"
              className="alert-dismiss"
              onClick={() => setNotification(null)}
              aria-label="Dismiss alert"
            >
              ✕
            </button>
          </div>
        )}

        {/* Aggregated Parent Job Summary Cards */}
        <JobSummaryMetrics
          summary={summary}
          selectedFilter={filter}
          onFilterChange={setFilter}
        />

        {/* Filter / Search Bar */}
        <div
          data-testid="scenario-filter-bar"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#475569" }}>
              Showing {filteredScenarios.length} of {job.scenarios.length} scenarios
            </span>
            {filter !== "all" && (
              <button
                type="button"
                data-testid="btn-clear-filter"
                onClick={() => setFilter("all")}
                style={{
                  background: "none",
                  border: "none",
                  color: "#2563eb",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: 0,
                }}
              >
                Clear filter ({filter})
              </button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="text"
              data-testid="input-scenario-search"
              placeholder="Search by defect, title, or patch..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: "0.4rem 0.75rem",
                fontSize: "0.85rem",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                minWidth: "260px",
              }}
            />
          </div>
        </div>

        {/* Scenario Cards List */}
        <div data-testid="scenario-cards-list">
          {filteredScenarios.length === 0 ? (
            <div
              data-testid="scenario-empty-state"
              style={{
                padding: "3rem 1rem",
                textAlign: "center",
                backgroundColor: "#ffffff",
                borderRadius: "10px",
                border: "1px dashed #cbd5e1",
                color: "#64748b",
              }}
            >
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔍</div>
              <p style={{ margin: 0, fontWeight: 500 }}>
                No scenarios match filter: <code>{filter}</code>
                {searchQuery && ` with query "${searchQuery}"`}
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: "0.75rem" }}
                onClick={() => {
                  setFilter("all");
                  setSearchQuery("");
                }}
              >
                Reset Filters
              </button>
            </div>
          ) : (
            filteredScenarios.map((scenario) => (
              <ScenarioCard
                key={scenario.scenarioId}
                scenario={scenario}
                onApprove={handleApproveScenario}
                onReject={handleRejectScenario}
                onSimulateRepair={handleSimulateRepair}
              />
            ))
          )}
        </div>
      </main>
    </div>
  );
};
