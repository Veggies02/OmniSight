import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useOmniSight } from "../../context/OmniSightContext";
import type { ReviewProposalItem } from "../../types/review-types";

export const RepairCenterPage: React.FC = () => {
  const { proposals, updateProposalStatus } = useOmniSight();
  const [selectedProposalId, setSelectedProposalId] = useState<string>(proposals[0]?.proposalId || "");
  const [activeTab, setActiveTab] = useState<"all" | "pending_review" | "approved" | "rejected">("all");
  const [decisionModal, setDecisionModal] = useState<{ open: boolean; type: "approved" | "rejected"; proposal: ReviewProposalItem | null }>({
    open: false,
    type: "approved",
    proposal: null,
  });
  const [reviewNotes, setReviewNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredProposals = proposals.filter((p) => {
    if (activeTab === "all") return true;
    return p.humanReviewStatus === activeTab;
  });

  const selectedProposal = proposals.find((p) => p.proposalId === selectedProposalId) || filteredProposals[0] || proposals[0];

  const handleOpenDecision = (type: "approved" | "rejected", prop: ReviewProposalItem) => {
    setReviewNotes(type === "approved" ? "Verified proposal code diff and approved for isolated worktree execution." : "");
    setDecisionModal({ open: true, type, proposal: prop });
  };

  const handleConfirmDecision = async () => {
    if (!decisionModal.proposal) return;
    if (decisionModal.type === "rejected" && !reviewNotes.trim()) {
      alert("A feedback explanation is required when rejecting a proposal.");
      return;
    }

    setIsSubmitting(true);
    await updateProposalStatus(decisionModal.proposal.proposalId, decisionModal.type, reviewNotes.trim());
    setIsSubmitting(false);
    setDecisionModal({ open: false, type: "approved", proposal: null });
  };

  return (
    <div>
      {/* Header */}
      <div className="omni-page-header" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: "2rem" }}>
        <div>
          <div className="omni-eyebrow">
            <span>Human-in-the-Loop Governance</span>
          </div>
          <h1 className="omni-title">
            Repair Center & Proposal Review
          </h1>
          <p className="omni-description">
            Examine synthesized code repairs, audit source-file diffs, and authorize execution in isolated Git worktrees.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <Link to="/review" className="omni-btn omni-btn-outline">
            Review Sub-Dashboard →
          </Link>
          <Link to="/dashboard/verification" className="omni-btn omni-btn-primary">
            Verification Runs →
          </Link>
        </div>
      </div>

      {/* Safety Notice */}
      <div
        style={{
          padding: "1rem 1.5rem",
          borderRadius: "var(--radius-md)",
          background: "var(--theme-warning-bg)",
          border: "1px solid var(--theme-warning-border)",
          color: "var(--theme-warning-text)",
          fontSize: "0.875rem",
          marginBottom: "2.5rem",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
        }}
      >
        <span style={{ fontSize: "1.125rem" }}>🛡️</span>
        <div>
          <strong>Mandatory Human Approval Protocol:</strong> No patch may be applied to repository files without explicit human confirmation. Unapproved proposals fail safety pre-flight validation automatically.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "2.5rem" }}>
        {/* Left Column: Code Diff & Proposal Detail */}
        <div>
          {selectedProposal ? (
            <div className="omni-card" style={{ padding: "2rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "1.375rem", fontWeight: 600 }}>
                      {selectedProposal.proposalId}
                    </h2>
                    <span
                      className={`omni-badge ${
                        selectedProposal.humanReviewStatus === "approved"
                          ? "omni-badge-success"
                          : selectedProposal.humanReviewStatus === "rejected"
                          ? "omni-badge-danger"
                          : "omni-badge-warning"
                      }`}
                    >
                      {selectedProposal.humanReviewStatus.replace("_", " ")}
                    </span>
                  </div>
                  <p className="omni-card-subtitle" style={{ marginTop: "0.375rem" }}>
                    Scenario: <code style={{ fontFamily: "var(--font-mono)" }}>{selectedProposal.scenarioId}</code> • Category: {selectedProposal.defectCategory}
                  </p>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    onClick={() => handleOpenDecision("approved", selectedProposal)}
                    disabled={selectedProposal.humanReviewStatus === "approved"}
                    className="omni-btn omni-btn-primary omni-btn-sm"
                  >
                    ✓ Approve Repair
                  </button>
                  <button
                    onClick={() => handleOpenDecision("rejected", selectedProposal)}
                    disabled={selectedProposal.humanReviewStatus === "rejected"}
                    className="omni-btn omni-btn-outline omni-btn-sm"
                    style={{ color: "var(--theme-danger-text)" }}
                  >
                    ✕ Reject
                  </button>
                </div>
              </div>

              {/* Suspected Root Cause */}
              <div style={{ padding: "1.125rem", background: "var(--theme-container)", borderRadius: "var(--radius-sm)", marginBottom: "1.5rem", border: "1px solid var(--theme-outline)" }}>
                <div style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.25rem" }}>Suspected Root Cause</div>
                <div style={{ color: "var(--theme-on-surface-variant)", fontSize: "0.875rem", lineHeight: 1.5 }}>
                  {selectedProposal.suspectedRootCause}
                </div>
              </div>

              {/* File Info */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
                <div style={{ padding: "0.875rem 1rem", border: "1px solid var(--theme-outline)", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--theme-on-surface-subtle)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Target File</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem", fontWeight: 600, marginTop: "0.25rem" }}>
                    {selectedProposal.localization.filePath || "Unlocalized"}
                  </div>
                </div>
                <div style={{ padding: "0.875rem 1rem", border: "1px solid var(--theme-outline)", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--theme-on-surface-subtle)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Target Selector</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem", fontWeight: 600, marginTop: "0.25rem" }}>
                    {selectedProposal.localization.componentOrSelector || "Global"}
                  </div>
                </div>
              </div>

              {/* Code Diff */}
              <div style={{ marginBottom: "1.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.75rem" }}>
                  <h3 style={{ fontSize: "1rem", fontWeight: 600, fontFamily: "var(--font-heading)" }}>
                    Proposed Code Modification Diff
                  </h3>
                  <span style={{ fontSize: "0.75rem", color: "var(--theme-on-surface-subtle)", fontFamily: "var(--font-mono)" }}>
                    {selectedProposal.proposedCorrection.type}
                  </span>
                </div>

                <div className="omni-code-panel" style={{ background: "#121317", color: "#f8f9fc" }}>
                  <div style={{ color: "#f87171", marginBottom: "0.375rem" }}>
                    --- Current ({selectedProposal.localization.filePath})
                  </div>
                  <pre style={{ margin: 0, color: "#fca5a5" }}>
                    {selectedProposal.proposedCorrection.currentCode}
                  </pre>
                  <div style={{ color: "#4ade80", margin: "0.875rem 0 0.375rem" }}>
                    +++ Proposed Correction
                  </div>
                  <pre style={{ margin: 0, color: "#86efac" }}>
                    {selectedProposal.proposedCorrection.proposedCode}
                  </pre>
                </div>
              </div>

              {/* Required Tests */}
              <div>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, fontFamily: "var(--font-heading)", marginBottom: "0.75rem" }}>
                  Required Validation Tests
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {selectedProposal.requiredValidationTests.map((t, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "0.625rem 0.875rem",
                        borderRadius: "var(--radius-xs)",
                        background: "var(--theme-container)",
                        border: "1px solid var(--theme-outline)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.75rem",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <span style={{ color: "var(--theme-accent-blue)" }}>⚙</span>
                      <span>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="omni-card" style={{ textAlign: "center", padding: "4rem" }}>
              <p>No proposal matches current criteria.</p>
            </div>
          )}
        </div>

        {/* Right Column: Proposals List */}
        <div>
          <div className="omni-card" style={{ padding: "1.5rem" }}>
            <h2 className="omni-card-title" style={{ marginBottom: "0.75rem" }}>
              Proposals ({proposals.length})
            </h2>

            {/* Filter Tabs */}
            <div style={{ display: "flex", gap: "0.25rem", background: "var(--theme-container)", padding: "0.25rem", borderRadius: "var(--radius-pill)", border: "1px solid var(--theme-outline)", marginBottom: "1.25rem" }}>
              {(["all", "pending_review", "approved", "rejected"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`omni-btn omni-btn-sm ${activeTab === tab ? "omni-btn-primary" : "omni-btn-outline"}`}
                  style={{ flex: 1, border: "none", fontSize: "0.6875rem", padding: "0.25rem 0" }}
                >
                  {tab === "all" ? "All" : tab === "pending_review" ? "Pending" : tab === "approved" ? "Approved" : "Rejected"}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {filteredProposals.map((prop) => {
                const isSelected = prop.proposalId === selectedProposal?.proposalId;
                return (
                  <div
                    key={prop.proposalId}
                    onClick={() => setSelectedProposalId(prop.proposalId)}
                    style={{
                      padding: "1.125rem",
                      borderRadius: "var(--radius-sm)",
                      border: isSelected ? "1.5px solid var(--theme-on-surface)" : "1px solid var(--theme-outline)",
                      background: isSelected ? "var(--theme-container)" : "var(--theme-surface)",
                      cursor: "pointer",
                      transition: "all 140ms ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.875rem", fontFamily: "var(--font-mono)" }}>
                        {prop.proposalId}
                      </span>
                      <span
                        className={`omni-badge ${
                          prop.humanReviewStatus === "approved"
                            ? "omni-badge-success"
                            : prop.humanReviewStatus === "rejected"
                            ? "omni-badge-danger"
                            : "omni-badge-warning"
                        }`}
                        style={{ fontSize: "0.625rem" }}
                      >
                        {prop.humanReviewStatus.replace("_", " ")}
                      </span>
                    </div>

                    <div style={{ fontSize: "0.8125rem", color: "var(--theme-on-surface-variant)", marginBottom: "0.5rem" }}>
                      {prop.proposedCorrection.diffSummary}
                    </div>

                    <div style={{ fontSize: "0.75rem", color: "var(--theme-on-surface-subtle)", fontFamily: "var(--font-mono)" }}>
                      {prop.localization.filePath}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Decision Modal */}
      {decisionModal.open && decisionModal.proposal && (
        <div className="omni-modal-overlay" onClick={() => setDecisionModal({ open: false, type: "approved", proposal: null })}>
          <div className="omni-modal" onClick={(e) => e.stopPropagation()}>
            <div className="omni-modal-header">
              <h2 className="omni-card-title">
                {decisionModal.type === "approved" ? "Authorize Code Repair" : "Reject Repair Proposal"}
              </h2>
              <p className="omni-card-subtitle">
                Proposal: <code style={{ fontFamily: "var(--font-mono)" }}>{decisionModal.proposal.proposalId}</code>
              </p>
            </div>

            <div style={{ marginBottom: "1.25rem", fontSize: "0.875rem", color: "var(--theme-on-surface-variant)", lineHeight: 1.5 }}>
              {decisionModal.type === "approved" ? (
                <p>
                  You are authorizing OmniSight to execute this patch inside an isolated Git worktree branch, run production build validation, and perform browser-based visual verification.
                </p>
              ) : (
                <p>
                  Rejecting this proposal halts execution. Please provide a feedback reason so the AI model can improve subsequent candidate generation.
                </p>
              )}
            </div>

            <div className="omni-form-group">
              <label className="omni-label">
                Reviewer Notes {decisionModal.type === "rejected" && "*"}
              </label>
              <textarea
                className="omni-textarea"
                rows={3}
                placeholder="Enter review explanation or validation rationale..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
              />
            </div>

            <div className="omni-modal-actions">
              <button
                type="button"
                onClick={() => setDecisionModal({ open: false, type: "approved", proposal: null })}
                disabled={isSubmitting}
                className="omni-btn omni-btn-outline"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDecision}
                disabled={isSubmitting}
                className={`omni-btn ${decisionModal.type === "approved" ? "omni-btn-primary" : "omni-btn-destructive"}`}
              >
                {isSubmitting ? "Processing..." : decisionModal.type === "approved" ? "Confirm & Authorize Execution" : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
