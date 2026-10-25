import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ReviewSidebar } from "../../components/review/ReviewSidebar";
import { ReviewDecisionDialog } from "../../components/review/ReviewDecisionDialog";
import { reviewRepository } from "../../services/reviewRepository";
import { type ReviewProposalItem } from "../../types/review-types";

export const ProposalDetailPage: React.FC = () => {
  const { proposalId } = useParams<{ proposalId: string }>();

  const [proposal, setProposal] = useState<ReviewProposalItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    type: "approve" | "reject";
  }>({
    isOpen: false,
    type: "approve",
  });

  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [repairModalOpen, setRepairModalOpen] = useState(false);
  const [executingRepair, setExecutingRepair] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<string | null>(null);
  const [repairJobResult, setRepairJobResult] = useState<import("../../types/review-types").ClientRepairJobResult | null>(null);

  const loadProposal = async () => {
    if (!proposalId) return;
    try {
      setLoading(true);
      setError(null);
      const item = await reviewRepository.getProposalById(proposalId);
      if (!item) {
        setError(`Proposal with ID '${proposalId}' was not found.`);
      } else {
        setProposal(item);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load proposal details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProposal();
  }, [proposalId]);

  const handleApprove = async () => {
    if (!proposal) return;
    try {
      const updated = await reviewRepository.approveProposal(proposal.proposalId);
      setProposal(updated);
      setDialogState({ isOpen: false, type: "approve" });
      setNotification({
        type: "success",
        message: `Proposal '${proposal.proposalId}' successfully approved for future sandbox application. (No source code was modified).`,
      });
    } catch (err: any) {
      setNotification({ type: "error", message: err.message });
      setDialogState({ isOpen: false, type: "approve" });
    }
  };

  const handleReject = async (reason: string) => {
    if (!proposal) return;
    try {
      const updated = await reviewRepository.rejectProposal(proposal.proposalId, reason);
      setProposal(updated);
      setDialogState({ isOpen: false, type: "reject" });
      setNotification({
        type: "success",
        message: `Proposal '${proposal.proposalId}' rejected with feedback recorded.`,
      });
    } catch (err: any) {
      setNotification({ type: "error", message: err.message });
      setDialogState({ isOpen: false, type: "reject" });
    }
  };

  if (loading) {
    return (
      <div className="review-layout-shell" data-testid="proposal-detail-loading">
        <ReviewSidebar />
        <main className="review-main-area">
          <div className="loading-state">
            <div className="spinner" />
            <p>Loading proposal details...</p>
          </div>
        </main>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="review-layout-shell" data-testid="proposal-detail-error">
        <ReviewSidebar />
        <main className="review-main-area">
          <div className="error-state">
            <h2>Proposal Not Found</h2>
            <p>{error || "The requested repair proposal could not be retrieved."}</p>
            <Link to="/review" className="btn btn-primary btn-sm">
              Back to Proposals List
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const isPending = proposal.humanReviewStatus === "pending_review";
  const isApproved = proposal.humanReviewStatus === "approved";
  const isRejected = proposal.humanReviewStatus === "rejected";

  return (
    <div className="review-layout-shell" data-testid="proposal-detail-page">
      <ReviewSidebar />

      <main className="review-main-area">
        {/* Navigation & Header */}
        <header className="review-detail-header">
          <div className="breadcrumb-nav">
            <Link to="/">Storefront</Link> &gt; <Link to="/review">Review Console</Link> &gt;{" "}
            <span>{proposal.proposalId}</span>
          </div>

          <div className="detail-title-flex">
            <div>
              <div className="badge-row">
                <span className="proposal-category-chip">{proposal.defectCategory}</span>
                <span
                  className={`status-badge ${
                    isApproved ? "badge-approved" : isRejected ? "badge-rejected" : "badge-pending"
                  }`}
                  data-testid="detail-review-status"
                >
                  {proposal.humanReviewStatus.toUpperCase()}
                </span>
                <span
                  className={`status-badge ${
                    proposal.sourceFreshness === "fresh"
                      ? "badge-fresh"
                      : proposal.sourceFreshness === "stale"
                      ? "badge-stale"
                      : "badge-unverified"
                  }`}
                  data-testid="detail-freshness-status"
                >
                  {proposal.sourceFreshness.toUpperCase()}
                </span>
                {proposal.isMock && <span className="mock-badge">MOCK VLM SIMULATION</span>}
              </div>

              <h1 className="review-page-title" data-testid="proposal-title">
                {proposal.proposalId}
              </h1>
              <p className="scenario-target-text">
                Scenario: <code>{proposal.scenarioId}</code> &bull; Created:{" "}
                {new Date(proposal.createdAt).toLocaleString()}
              </p>
            </div>

            {/* Action Bar */}
            <div className="detail-actions-group" data-testid="action-buttons-group">
              {isPending && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="btn-approve"
                    onClick={() => setDialogState({ isOpen: true, type: "approve" })}
                  >
                    ✓ Approve Proposal
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    data-testid="btn-reject"
                    onClick={() => setDialogState({ isOpen: true, type: "reject" })}
                  >
                    ✕ Reject Proposal
                  </button>
                </>
              )}

              {isApproved && (
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <div className="decision-banner approved" data-testid="decision-banner-approved">
                    <span>✓ Approved by Reviewer</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="btn-execute-repair"
                    style={{ backgroundColor: "#0284c7", borderColor: "#0284c7" }}
                    onClick={() => setRepairModalOpen(true)}
                  >
                    ⚡ Execute Isolated Repair Job
                  </button>
                </div>
              )}

              {isRejected && (
                <div className="decision-banner rejected" data-testid="decision-banner-rejected">
                  <span>✕ Rejected by Reviewer</span>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Repair Confirmation & Execution Modal */}
        {repairModalOpen && (
          <div className="dialog-overlay" data-testid="repair-execution-dialog">
            <div className="dialog-card" style={{ maxWidth: "600px" }}>
              <div className="dialog-header">
                <h3>Execute Isolated Self-Healing Repair</h3>
                <p className="dialog-subtitle">OmniSight Step 4.6 Sandbox Worktree Runner</p>
              </div>
              <div className="dialog-body" style={{ fontSize: "0.875rem", lineHeight: "1.5" }}>
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "0.75rem 1rem", borderRadius: "6px", marginBottom: "1rem", color: "#166534" }}>
                  <strong>Safety Invariants Guaranteed:</strong>
                  <ul style={{ margin: "0.5rem 0 0 1.25rem", padding: 0 }}>
                    <li>A separate temporary Git worktree and branch will be created.</li>
                    <li>The main working tree and local changes will NOT be touched or modified.</li>
                    <li>Only pre-registered, allowlisted deterministic patches are applied.</li>
                    <li>Automated build checks and visual validation will be executed.</li>
                    <li>No code will be automatically committed to main or pushed.</li>
                  </ul>
                </div>

                {executingRepair && (
                  <div style={{ background: "#f8fafc", border: "1px solid #cbd5e1", padding: "0.75rem 1rem", borderRadius: "6px", marginBottom: "1rem" }} data-testid="repair-execution-progress">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div className="spinner" style={{ width: "16px", height: "16px", borderWidth: "2px" }} />
                      <span style={{ fontWeight: 500, color: "#334155" }}>
                        {executionProgress || "Executing repair in isolated worktree..."}
                      </span>
                    </div>
                  </div>
                )}

                {repairJobResult && (
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: "0.75rem", borderRadius: "6px", marginBottom: "1rem" }} data-testid="repair-job-summary">
                    <p>
                      <strong>Status:</strong>{" "}
                      <span style={{ color: repairJobResult.status === "PASSED" ? "#16a34a" : "#dc2626", fontWeight: "bold" }}>
                        {repairJobResult.status}
                      </span>
                      {repairJobResult.stage && <span style={{ marginLeft: "0.5rem", color: "#64748b", fontSize: "0.8rem" }}>({repairJobResult.stage})</span>}
                    </p>
                    <p data-testid="verification-status-row">
                      <strong>Post-Repair Verification:</strong>{" "}
                      <span
                        style={{
                          fontWeight: "bold",
                          color:
                            repairJobResult.verificationStatus === "passed" || repairJobResult.visualPassed
                              ? "#16a34a"
                              : repairJobResult.verificationStatus === "inconclusive"
                              ? "#d97706"
                              : "#dc2626",
                        }}
                        data-testid="verification-status-badge"
                      >
                        {(repairJobResult.verificationStatus || (repairJobResult.visualPassed ? "passed" : "failed")).toUpperCase()}
                      </span>
                    </p>
                    <p><strong>Job ID:</strong> <code>{repairJobResult.jobId}</code></p>
                    <p><strong>Worktree Branch:</strong> <code>{repairJobResult.worktreeBranch}</code></p>
                    <p><strong>Build Verification:</strong> {repairJobResult.buildPassed ? "✓ Passed" : "✕ Failed"}</p>
                    <p><strong>Visual Delta Validation:</strong> {repairJobResult.visualPassed ? "✓ Passed" : "✕ Failed"}</p>
                    {repairJobResult.durationSeconds !== undefined && (
                      <p><strong>Execution Duration:</strong> {repairJobResult.durationSeconds.toFixed(1)}s</p>
                    )}
                    <p><strong>Artifact Report:</strong> <code>{repairJobResult.reportPath}</code></p>
                    {repairJobResult.verificationChecks && repairJobResult.verificationChecks.length > 0 && (
                      <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#f1f5f9", borderRadius: "4px" }} data-testid="verification-checks-list">
                        <strong style={{ fontSize: "0.8rem", color: "#334155" }}>Verification Checks:</strong>
                        <ul style={{ margin: "0.25rem 0 0 1rem", padding: 0, fontSize: "0.75rem" }}>
                          {repairJobResult.verificationChecks.map((chk, idx) => (
                            <li key={idx} style={{ color: chk.passed ? "#166534" : "#991b1b" }}>
                              {chk.passed ? "✓" : "✕"} {chk.name}: {String(chk.actual)} (expected {String(chk.expected)})
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {repairJobResult.postRepairScreenshotUrl && (
                      <div style={{ marginTop: "0.5rem" }} data-testid="post-repair-evidence-preview">
                        <strong style={{ fontSize: "0.8rem", color: "#334155" }}>Post-Repair Screenshot Evidence:</strong>
                        <img
                          src={repairJobResult.postRepairScreenshotUrl}
                          alt="Post Repair Verification Screenshot"
                          style={{ width: "100%", maxHeight: "140px", objectFit: "cover", borderRadius: "4px", marginTop: "0.25rem", border: "1px solid #cbd5e1" }}
                          data-testid="post-repair-screenshot-img"
                        />
                      </div>
                    )}
                    {repairJobResult.failureReason && (
                      <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "4px", color: "#991b1b" }} data-testid="verification-failure-reason">
                        <strong>Failure Reason:</strong> {repairJobResult.failureReason}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setRepairModalOpen(false)}
                  disabled={executingRepair}
                >
                  Close
                </button>
                {!repairJobResult && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="btn-confirm-repair-exec"
                    disabled={executingRepair}
                    onClick={async () => {
                      if (!proposal) return;
                      try {
                        setExecutingRepair(true);
                        setExecutionProgress("Initializing repair job...");
                        const res = await reviewRepository.triggerRepairExecution(
                          proposal.proposalId,
                          (stage, status) => {
                            setExecutionProgress(`${status} (${stage})`);
                          }
                        );
                        setRepairJobResult(res);
                        setNotification({
                          type: res.status === "PASSED" ? "success" : "error",
                          message:
                            res.status === "PASSED"
                              ? `Repair job ${res.jobId} completed successfully! Worktree validated and cleaned up.`
                              : `Repair job ${res.jobId} failed: ${res.failureReason || "Validation check failed"}`,
                        });
                      } catch (err: any) {
                        setNotification({
                          type: "error",
                          message: err.message || "Failed to execute repair job.",
                        });
                      } finally {
                        setExecutingRepair(false);
                        setExecutionProgress(null);
                      }
                    }}
                  >
                    {executingRepair ? "Running Repair..." : "Confirm & Run Repair Job"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}


        {/* Notifications */}
        {notification && (
          <div
            className={`alert-banner ${notification.type === "success" ? "alert-success" : "alert-error"}`}
            data-testid="notification-banner"
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

        {/* Grid Panels */}
        <div className="detail-content-grid">
          {/* Section A: Visual Evidence Comparison */}
          <section className="detail-panel" data-testid="panel-visual-evidence">
            <h2 className="panel-title">1. Paired Visual Evidence</h2>
            <p className="panel-subtitle">
              Comparison between clean baseline render and defective state under identical browser viewport.
            </p>

            <div className="evidence-comparison-grid">
              <div className="evidence-side" data-testid="baseline-evidence-side">
                <div className="evidence-label-bar">
                  <span className="badge-side-clean">Clean Baseline</span>
                  <span className="viewport-tag">
                    {proposal.visualEvidence?.viewport.width} × {proposal.visualEvidence?.viewport.height}
                  </span>
                </div>
                <div className="evidence-image-container">
                  {proposal.visualEvidence?.baselineScreenshotUrl ? (
                    <img
                      src={proposal.visualEvidence.baselineScreenshotUrl}
                      alt="Baseline clean screenshot"
                      className="evidence-img"
                      data-testid="baseline-image"
                    />
                  ) : (
                    <div className="image-placeholder" data-testid="baseline-placeholder">
                      Clean Baseline Screenshot Not Available
                    </div>
                  )}
                </div>
              </div>

              <div className="evidence-side" data-testid="defective-evidence-side">
                <div className="evidence-label-bar">
                  <span className="badge-side-defective">Defective State</span>
                  <span className="viewport-tag">
                    {proposal.visualEvidence?.viewport.width} × {proposal.visualEvidence?.viewport.height}
                  </span>
                </div>
                <div className="evidence-image-container">
                  {proposal.visualEvidence?.defectiveScreenshotUrl ? (
                    <img
                      src={proposal.visualEvidence.defectiveScreenshotUrl}
                      alt="Defective state screenshot"
                      className="evidence-img"
                      data-testid="defective-image"
                    />
                  ) : (
                    <div className="image-placeholder" data-testid="defective-placeholder">
                      Defective Screenshot Not Available
                    </div>
                  )}
                </div>
              </div>
            </div>

            {proposal.visualEvidence?.measurements && (
              <div className="measurements-box" data-testid="measurements-box">
                <h4>Quantitative Evidence Measurements</h4>
                <div className="measurements-grid">
                  {Object.entries(proposal.visualEvidence.measurements).map(([k, v]) => (
                    <div key={k} className="metric-item">
                      <span className="metric-key">{k}:</span>
                      <span className="metric-val">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Section B: Diagnosis & Localization */}
          <section className="detail-panel" data-testid="panel-diagnosis">
            <h2 className="panel-title">2. Diagnosis & Source Localization</h2>

            <div className="diagnosis-details-list">
              <div className="detail-item">
                <span className="detail-label">Suspected Root Cause:</span>
                <span className="detail-value font-medium">{proposal.suspectedRootCause}</span>
              </div>

              <div className="detail-item">
                <span className="detail-label">Reported Evidence:</span>
                <ul className="evidence-bullet-list">
                  {proposal.evidenceExplanation.map((ev, i) => (
                    <li key={i}>{ev}</li>
                  ))}
                </ul>
              </div>

              <div className="detail-item">
                <span className="detail-label">Target Source File:</span>
                <span className="detail-value">
                  <code>{proposal.localization.filePath || "Unlocalized"}</code>
                </span>
              </div>

              <div className="detail-item">
                <span className="detail-label">Target Selector:</span>
                <span className="detail-value">
                  <code>{proposal.localization.componentOrSelector || "—"}</code>
                </span>
              </div>

              <div className="detail-item">
                <span className="detail-label">Source File SHA-256:</span>
                <span className="detail-value">
                  <code className="text-xs break-all">{proposal.localization.fileHash || "—"}</code>
                </span>
              </div>
            </div>

            {proposal.localization.excerpt && (
              <div className="source-excerpt-wrapper" data-testid="source-excerpt">
                <div className="excerpt-header">
                  <span>
                    Bounded Excerpt: lines {proposal.localization.excerpt.startLine}–
                    {proposal.localization.excerpt.endLine} of {proposal.localization.filePath}
                  </span>
                </div>
                <pre className="code-block" data-testid="code-excerpt-content">
                  <code>{proposal.localization.excerpt.content}</code>
                </pre>
              </div>
            )}
          </section>

          {/* Section C: Proposed Code Correction */}
          <section className="detail-panel" data-testid="panel-correction">
            <h2 className="panel-title">3. Proposed Code Correction (Non-Destructive)</h2>
            <p className="panel-subtitle">
              Minimal suggested diff for human review. Does not alter production files without approval.
            </p>

            <div className="diff-comparison-container" data-testid="diff-viewer">
              <div className="diff-panel current-code-panel">
                <div className="diff-panel-title">Current Defective Rule</div>
                <pre className="code-block diff-code" data-testid="current-code">
                  <code>{proposal.proposedCorrection.currentCode}</code>
                </pre>
              </div>

              <div className="diff-panel proposed-code-panel">
                <div className="diff-panel-title">Proposed Corrected Rule</div>
                <pre className="code-block diff-code" data-testid="proposed-code">
                  <code>{proposal.proposedCorrection.proposedCode}</code>
                </pre>
              </div>
            </div>

            <div className="diff-summary-card">
              <h4>Summary of Correction</h4>
              <p>{proposal.proposedCorrection.diffSummary}</p>
            </div>

            <div className="expected-improvement-card">
              <h4>Expected Visual Improvement</h4>
              <p>{proposal.expectedVisualImprovement}</p>
            </div>

            <div className="risks-and-tests-grid">
              <div className="card-sub-box">
                <h4>Potential Risks & Side Effects</h4>
                <ul>
                  {proposal.potentialRisks.map((risk, idx) => (
                    <li key={idx}>{risk}</li>
                  ))}
                </ul>
              </div>

              <div className="card-sub-box">
                <h4>Required Validation Tests</h4>
                <ul>
                  {proposal.requiredValidationTests.map((testPath, idx) => (
                    <li key={idx}>
                      <code>{testPath}</code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>

        {/* Confirmation Modal */}
        <ReviewDecisionDialog
          isOpen={dialogState.isOpen}
          type={dialogState.type}
          proposalId={proposal.proposalId}
          scenarioId={proposal.scenarioId}
          onConfirmApprove={handleApprove}
          onConfirmReject={handleReject}
          onCancel={() => setDialogState({ isOpen: false, type: "approve" })}
        />
      </main>
    </div>
  );
};
