import React, { useState } from "react";

interface ReviewDecisionDialogProps {
  isOpen: boolean;
  type: "approve" | "reject";
  proposalId: string;
  scenarioId: string;
  onConfirmApprove: () => void;
  onConfirmReject: (reason: string) => void;
  onCancel: () => void;
}

export const ReviewDecisionDialog: React.FC<ReviewDecisionDialogProps> = ({
  isOpen,
  type,
  proposalId,
  scenarioId,
  onConfirmApprove,
  onConfirmReject,
  onCancel,
}) => {
  const [rejectionReason, setRejectionReason] = useState("");
  const [validationError, setValidationError] = useState("");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (type === "approve") {
      onConfirmApprove();
    } else {
      if (!rejectionReason.trim()) {
        setValidationError("A rejection reason is required before submitting.");
        return;
      }
      onConfirmReject(rejectionReason.trim());
    }
  };

  return (
    <div className="dialog-overlay" data-testid="review-dialog-overlay" role="dialog" aria-modal="true">
      <div className="dialog-container">
        <div className="dialog-header">
          <h3 className="dialog-title">
            {type === "approve" ? "Confirm Proposal Approval" : "Reject Repair Proposal"}
          </h3>
          <button
            type="button"
            className="dialog-close-btn"
            onClick={onCancel}
            aria-label="Close dialog"
            data-testid="dialog-close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="dialog-body">
            <p className="dialog-meta-text">
              Target: <strong>{proposalId}</strong> ({scenarioId})
            </p>

            {type === "approve" ? (
              <div className="approval-notice-box" data-testid="approval-notice">
                <p>
                  <strong>Important Non-Destructive Invariant:</strong>
                </p>
                <p>
                  Approving this proposal records human verification that the suggested fix is sound.
                  <strong> It does NOT modify application source code, commit changes, or apply patches.</strong>
                </p>
                <p>The proposal will be marked ready for the upcoming sandbox application phase.</p>
              </div>
            ) : (
              <div className="rejection-form-group">
                <label htmlFor="rejection-reason" className="dialog-input-label">
                  Reason for Rejection <span className="text-rose-500">*</span>
                </label>
                <textarea
                  id="rejection-reason"
                  data-testid="rejection-reason-input"
                  className="form-input dialog-textarea"
                  rows={4}
                  placeholder="Provide specific feedback (e.g. unintended layout side effect, incorrect selector, or inappropriate token override)..."
                  value={rejectionReason}
                  onChange={(e) => {
                    setRejectionReason(e.target.value);
                    if (validationError) setValidationError("");
                  }}
                  autoFocus
                />
                {validationError && (
                  <p className="dialog-error-text" data-testid="dialog-error-text">
                    {validationError}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={onCancel}
              data-testid="btn-cancel-dialog"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`btn ${type === "approve" ? "btn-primary" : "btn-danger"}`}
              data-testid="btn-confirm-dialog"
            >
              {type === "approve" ? "Confirm Approval" : "Confirm Rejection"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
