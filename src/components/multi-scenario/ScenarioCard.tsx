import React, { useState } from "react";
import type { ScenarioItem } from "../../types/multi-scenario-types";
import { DefectSeverityBadge } from "./DefectSeverityBadge";
import { ConfidenceIndicator } from "./ConfidenceIndicator";

interface Props {
  scenario: ScenarioItem;
  onApprove: (scenarioId: string) => Promise<void>;
  onReject: (scenarioId: string, reason: string) => Promise<void>;
  onSimulateRepair: (scenarioId: string, onProgress: (step: string) => void) => Promise<void>;
}

export const ScenarioCard: React.FC<Props> = ({
  scenario,
  onApprove,
  onReject,
  onSimulateRepair,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [loadingAction, setLoadingAction] = useState(false);
  const [repairProgress, setRepairProgress] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isApproved = scenario.approvalStatus === "approved";
  const isRejected = scenario.approvalStatus === "rejected";
  const isPending = scenario.approvalStatus === "pending";
  const isRepairing = scenario.status === "repairing" || repairProgress !== null;
  const isRepaired = scenario.status === "repaired";
  const isRepairFailed = scenario.status === "failed";

  const handleApprove = async () => {
    try {
      setLoadingAction(true);
      setErrorMessage(null);
      await onApprove(scenario.scenarioId);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to approve scenario");
    } finally {
      setLoadingAction(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectReason.trim()) {
      setErrorMessage("Please provide a reason for rejecting this proposal.");
      return;
    }
    try {
      setLoadingAction(true);
      setErrorMessage(null);
      await onReject(scenario.scenarioId, rejectReason);
      setRejecting(false);
      setRejectReason("");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to reject scenario");
    } finally {
      setLoadingAction(false);
    }
  };

  const handleSimulateRepair = async () => {
    try {
      setLoadingAction(true);
      setErrorMessage(null);
      setRepairProgress("Initializing isolated worktree sandbox...");
      await onSimulateRepair(scenario.scenarioId, (step) => {
        setRepairProgress(step);
      });
    } catch (err: any) {
      setErrorMessage(err.message || "Simulation failed");
    } finally {
      setLoadingAction(false);
      setRepairProgress(null);
    }
  };

  // State styling
  const getCardBorder = () => {
    if (isRepaired) return "#86efac";
    if (isRepairFailed) return "#fca5a5";
    if (isRepairing) return "#93c5fd";
    if (isApproved) return "#bfdbfe";
    if (isRejected) return "#cbd5e1";
    return "#e2e8f0";
  };

  return (
    <div
      data-testid={`scenario-card-${scenario.scenarioId}`}
      data-scenario-status={scenario.status}
      data-approval-status={scenario.approvalStatus}
      style={{
        backgroundColor: "#ffffff",
        borderRadius: "12px",
        border: `1.5px solid ${getCardBorder()}`,
        marginBottom: "1rem",
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.04)",
        overflow: "hidden",
        transition: "border-color 0.2s ease",
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          padding: "1rem 1.25rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
          backgroundColor: isRepaired
            ? "#f0fdf4"
            : isRepairFailed
            ? "#fef2f2"
            : isApproved
            ? "#f8faff"
            : isRejected
            ? "#f8fafc"
            : "#ffffff",
          borderBottom: isExpanded ? "1px solid #f1f5f9" : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="btn-toggle-expand"
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "0.9rem",
              padding: "0.2rem",
              color: "#64748b",
            }}
            aria-label={isExpanded ? "Collapse scenario" : "Expand scenario"}
          >
            {isExpanded ? "▼" : "▶"}
          </button>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span
                data-testid="scenario-title"
                style={{ fontSize: "1.05rem", fontWeight: 700, color: "#1e293b" }}
              >
                {scenario.title}
              </span>
              <span
                data-testid="scenario-defect-category"
                style={{
                  fontSize: "0.75rem",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "6px",
                  backgroundColor: "#f1f5f9",
                  color: "#475569",
                  fontWeight: 500,
                }}
              >
                {scenario.defectType}
              </span>
              <DefectSeverityBadge severity={scenario.severity} />
            </div>
            <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.2rem" }}>
              Scenario ID: <code>{scenario.scenarioId}</code> &bull; Detected:{" "}
              {new Date(scenario.timestamps.detectedAt).toLocaleTimeString()}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          {/* AI Confidence */}
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "0.7rem", color: "#64748b", display: "block" }}>
              Confidence
            </span>
            <ConfidenceIndicator confidence={scenario.confidence} />
          </div>

          {/* Status Badges */}
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <span
              data-testid="scenario-approval-status-badge"
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "0.25rem 0.6rem",
                borderRadius: "9999px",
                textTransform: "uppercase",
                backgroundColor: isApproved
                  ? "#dbeafe"
                  : isRejected
                  ? "#e2e8f0"
                  : "#fef3c7",
                color: isApproved
                  ? "#1e40af"
                  : isRejected
                  ? "#475569"
                  : "#92400e",
              }}
            >
              {scenario.approvalStatus.toUpperCase()}
            </span>

            {isRepaired && (
              <span
                data-testid="scenario-repair-status-badge"
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  padding: "0.25rem 0.6rem",
                  borderRadius: "9999px",
                  backgroundColor: "#dcfce7",
                  color: "#166534",
                }}
              >
                REPAIRED
              </span>
            )}

            {isRepairFailed && (
              <span
                data-testid="scenario-repair-status-badge"
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  padding: "0.25rem 0.6rem",
                  borderRadius: "9999px",
                  backgroundColor: "#fee2e2",
                  color: "#991b1b",
                }}
              >
                REPAIR FAILED
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Expandable Details Body */}
      {isExpanded && (
        <div style={{ padding: "1.25rem" }}>
          {errorMessage && (
            <div
              data-testid="scenario-error-banner"
              style={{
                padding: "0.6rem 0.85rem",
                backgroundColor: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "6px",
                color: "#991b1b",
                fontSize: "0.85rem",
                marginBottom: "1rem",
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "1rem",
              marginBottom: "1rem",
            }}
          >
            {/* 5. Diagnosis Summary */}
            <div
              style={{
                backgroundColor: "#f8fafc",
                padding: "0.85rem",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
              }}
            >
              <strong style={{ fontSize: "0.8rem", color: "#475569", textTransform: "uppercase" }}>
                AI Diagnosis
              </strong>
              <p
                data-testid="scenario-diagnosis"
                style={{ fontSize: "0.875rem", color: "#1e293b", margin: "0.4rem 0 0 0" }}
              >
                {scenario.diagnosis}
              </p>
            </div>

            {/* 6. Proposed Fix */}
            <div
              style={{
                backgroundColor: "#f8fafc",
                padding: "0.85rem",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
              }}
            >
              <strong style={{ fontSize: "0.8rem", color: "#475569", textTransform: "uppercase" }}>
                Proposed Repair
              </strong>
              <p
                data-testid="scenario-proposed-fix"
                style={{ fontSize: "0.875rem", color: "#1e293b", margin: "0.4rem 0 0 0" }}
              >
                {scenario.proposedFix}
              </p>
            </div>
          </div>

          {/* Technical Metadata Row: Patch ID, Target File, Validation Status */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "1.25rem",
              padding: "0.75rem",
              backgroundColor: "#f1f5f9",
              borderRadius: "6px",
              fontSize: "0.8rem",
              color: "#334155",
              marginBottom: "1rem",
            }}
          >
            <div>
              <strong>Patch ID:</strong>{" "}
              <code data-testid="scenario-patch-id">{scenario.patchId}</code>
            </div>
            <div>
              <strong>Target Source:</strong>{" "}
              <code data-testid="scenario-target-file">{scenario.targetFile}</code>
            </div>
            <div>
              <strong>Validation Status:</strong>{" "}
              <span
                data-testid="scenario-validation-status"
                style={{
                  fontWeight: 600,
                  color:
                    scenario.validationStatus === "passed"
                      ? "#16a34a"
                      : scenario.validationStatus === "failed"
                      ? "#dc2626"
                      : "#64748b",
                }}
              >
                {scenario.validationStatus.toUpperCase()}
              </span>
            </div>
            {scenario.reviewedBy && (
              <div>
                <strong>Reviewer:</strong> <span>{scenario.reviewedBy}</span>
              </div>
            )}
          </div>

          {/* State-specific Banners & Progress */}
          {isRepairing && (
            <div
              data-testid="scenario-repairing-progress"
              style={{
                padding: "0.85rem 1rem",
                backgroundColor: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: "8px",
                marginBottom: "1rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div
                  className="spinner"
                  style={{
                    width: "16px",
                    height: "16px",
                    borderWidth: "2px",
                    borderColor: "#3b82f6 transparent transparent transparent",
                  }}
                />
                <span style={{ fontWeight: 600, color: "#1e40af", fontSize: "0.85rem" }}>
                  {repairProgress || "Simulating isolated self-healing repair..."}
                </span>
              </div>
              <div
                style={{
                  height: "4px",
                  backgroundColor: "#dbeafe",
                  borderRadius: "9999px",
                  marginTop: "0.5rem",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: "70%",
                    height: "100%",
                    backgroundColor: "#3b82f6",
                    borderRadius: "9999px",
                  }}
                />
              </div>
            </div>
          )}

          {isRepaired && scenario.repairReport && (
            <div
              data-testid="scenario-repair-success-report"
              style={{
                padding: "0.85rem 1rem",
                backgroundColor: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "8px",
                marginBottom: "1rem",
                color: "#166534",
                fontSize: "0.85rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700 }}>
                <span>✓</span>
                <span>Simulated Repair Succeeded [PROTOTYPE DEMONSTRATION]</span>
              </div>
              <p style={{ margin: "0.3rem 0 0.5rem 0", fontSize: "0.8rem", color: "#15803d" }}>
                {scenario.repairReport.message}
              </p>
              <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.75rem", color: "#166534" }}>
                {scenario.repairReport.stepsCompleted.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ul>
            </div>
          )}

          {isRepairFailed && scenario.repairReport && (
            <div
              data-testid="scenario-repair-failure-report"
              style={{
                padding: "0.85rem 1rem",
                backgroundColor: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "8px",
                marginBottom: "1rem",
                color: "#991b1b",
                fontSize: "0.85rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700 }}>
                <span>✕</span>
                <span>Simulated Repair Failed [PROTOTYPE DEMONSTRATION]</span>
              </div>
              <p style={{ margin: "0.3rem 0", fontSize: "0.8rem" }}>
                {scenario.repairReport.message}
              </p>
            </div>
          )}

          {isRejected && scenario.rejectionReason && (
            <div
              data-testid="scenario-rejection-info"
              style={{
                padding: "0.75rem 1rem",
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                marginBottom: "1rem",
                fontSize: "0.85rem",
                color: "#475569",
              }}
            >
              <strong>Rejection Reason:</strong> {scenario.rejectionReason}
            </div>
          )}

          {/* Action Footer */}
          <div
            data-testid="scenario-actions-bar"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
              paddingTop: "0.5rem",
              borderTop: "1px solid #f1f5f9",
            }}
          >
            {/* Left: Rejection Input or Status Note */}
            <div>
              {rejecting ? (
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="text"
                    data-testid="input-reject-reason"
                    placeholder="Enter reason for rejection..."
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    style={{
                      padding: "0.4rem 0.6rem",
                      fontSize: "0.8rem",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      width: "240px",
                    }}
                  />
                  <button
                    type="button"
                    data-testid="btn-confirm-reject"
                    onClick={handleConfirmReject}
                    disabled={loadingAction}
                    className="btn btn-danger btn-sm"
                    style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}
                  >
                    Confirm Rejection
                  </button>
                  <button
                    type="button"
                    data-testid="btn-cancel-reject"
                    onClick={() => {
                      setRejecting(false);
                      setRejectReason("");
                    }}
                    disabled={loadingAction}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                  Prototype: Decisions apply strictly to this isolated scenario.
                </span>
              )}
            </div>

            {/* Right: Primary Action Buttons */}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {isPending && !rejecting && (
                <>
                  <button
                    type="button"
                    data-testid="btn-scenario-approve"
                    onClick={handleApprove}
                    disabled={loadingAction}
                    className="btn btn-primary btn-sm"
                    style={{
                      backgroundColor: "#2563eb",
                      borderColor: "#2563eb",
                      fontSize: "0.85rem",
                      padding: "0.45rem 1rem",
                      fontWeight: 600,
                    }}
                  >
                    ✓ Approve Scenario
                  </button>
                  <button
                    type="button"
                    data-testid="btn-scenario-reject"
                    onClick={() => setRejecting(true)}
                    disabled={loadingAction}
                    className="btn btn-secondary btn-sm"
                    style={{
                      fontSize: "0.85rem",
                      padding: "0.45rem 1rem",
                      color: "#dc2626",
                      borderColor: "#fca5a5",
                    }}
                  >
                    ✕ Reject
                  </button>
                </>
              )}

              {isApproved && (
                <button
                  type="button"
                  data-testid="btn-simulate-repair"
                  onClick={handleSimulateRepair}
                  disabled={loadingAction || isRepairing}
                  className="btn btn-primary btn-sm"
                  style={{
                    backgroundColor: "#16a34a",
                    borderColor: "#16a34a",
                    fontSize: "0.85rem",
                    padding: "0.45rem 1rem",
                    fontWeight: 600,
                  }}
                >
                  ⚡ Simulate Repair [PROTOTYPE]
                </button>
              )}

              {(isRepaired || isRepairFailed) && (
                <button
                  type="button"
                  data-testid="btn-re-simulate-repair"
                  onClick={handleSimulateRepair}
                  disabled={loadingAction || isRepairing}
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}
                >
                  ↻ Re-run Simulation
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
