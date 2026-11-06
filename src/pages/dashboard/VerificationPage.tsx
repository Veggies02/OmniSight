import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useOmniSight } from "../../context/OmniSightContext";

export const VerificationPage: React.FC = () => {
  const { verifications } = useOmniSight();
  const [selectedJobId, setSelectedJobId] = useState<string>(verifications[0]?.jobId || "");

  const selectedVerification = verifications.find((v) => v.jobId === selectedJobId) || verifications[0];

  return (
    <div>
      {/* Header */}
      <div className="omni-page-header" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: "2rem" }}>
        <div>
          <div className="omni-eyebrow">
            <span>Isolated Git Worktree Validation</span>
          </div>
          <h1 className="omni-title">
            Testing & Post-Repair Visual Verification
          </h1>
          <p className="omni-description">
            Inspect isolated Git worktree build logs, required test execution results, and rendered post-repair browser evidence.
          </p>
        </div>

        <Link to="/dashboard/activity" className="omni-btn omni-btn-outline">
          View Audit Logs →
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "2.5rem" }}>
        {/* Left Column: Verification Evidence */}
        <div>
          {selectedVerification ? (
            <div className="omni-card" style={{ padding: "2rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "1.375rem", fontWeight: 600 }}>
                      {selectedVerification.jobId}
                    </h2>
                    <span
                      className={`omni-badge ${
                        selectedVerification.finalState === "PASSED"
                          ? "omni-badge-success"
                          : selectedVerification.finalState === "REJECTED"
                          ? "omni-badge-danger"
                          : "omni-badge-warning"
                      }`}
                    >
                      {selectedVerification.finalState}
                    </span>
                  </div>
                  <p className="omni-card-subtitle" style={{ marginTop: "0.375rem" }}>
                    Patch ID: <code style={{ fontFamily: "var(--font-mono)" }}>{selectedVerification.patchId}</code> • Executed: {new Date(selectedVerification.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Three-Stage Verification Pipeline Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.75rem" }}>
                <div style={{ padding: "1rem", borderRadius: "var(--radius-sm)", background: "var(--theme-container)", border: "1px solid var(--theme-outline)" }}>
                  <div style={{ fontSize: "0.6875rem", color: "var(--theme-on-surface-subtle)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>1. Production Build</div>
                  <div style={{ fontWeight: 600, marginTop: "0.25rem", color: selectedVerification.buildPassed ? "var(--theme-success-text)" : "var(--theme-danger-text)" }}>
                    {selectedVerification.buildPassed ? "✓ PASS (tsc + vite)" : "✕ FAILED"}
                  </div>
                </div>

                <div style={{ padding: "1rem", borderRadius: "var(--radius-sm)", background: "var(--theme-container)", border: "1px solid var(--theme-outline)" }}>
                  <div style={{ fontSize: "0.6875rem", color: "var(--theme-on-surface-subtle)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>2. Worktree Tests</div>
                  <div style={{ fontWeight: 600, marginTop: "0.25rem", color: selectedVerification.requiredTestsPassed ? "var(--theme-success-text)" : "var(--theme-danger-text)" }}>
                    {selectedVerification.requiredTestsPassed ? "✓ PASS (Isolated Worktree)" : "✕ SKIPPED / FAILED"}
                  </div>
                </div>

                <div style={{ padding: "1rem", borderRadius: "var(--radius-sm)", background: "var(--theme-container)", border: "1px solid var(--theme-outline)" }}>
                  <div style={{ fontSize: "0.6875rem", color: "var(--theme-on-surface-subtle)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>3. Visual Verifier</div>
                  <div style={{ fontWeight: 600, marginTop: "0.25rem", color: selectedVerification.visualValidationPassed ? "var(--theme-success-text)" : "var(--theme-danger-text)" }}>
                    {selectedVerification.visualValidationPassed ? "✓ PASS (Playwright Rendered)" : "✕ FAILED"}
                  </div>
                </div>
              </div>

              {selectedVerification.failureReason && (
                <div style={{ padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", background: "var(--theme-danger-bg)", border: "1px solid var(--theme-danger-border)", color: "var(--theme-danger-text)", fontSize: "0.875rem", marginBottom: "1.75rem" }}>
                  <strong>Safety Pre-Flight Halt:</strong> {selectedVerification.failureReason}
                </div>
              )}

              {/* Rendered Visual Screenshot */}
              <div style={{ marginBottom: "1.75rem" }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, fontFamily: "var(--font-heading)", marginBottom: "0.75rem" }}>
                  Playwright Post-Repair Visual Capture
                </h3>
                <div style={{ border: "1px solid var(--theme-outline)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--theme-container)" }}>
                  <div style={{ padding: "0.625rem 1rem", fontSize: "0.75rem", fontWeight: 600, borderBottom: "1px solid var(--theme-outline)", background: "var(--theme-surface)", color: "var(--theme-success-text)", display: "flex", justifyContent: "space-between" }}>
                    <span>Rendered in Isolated Worktree Server</span>
                    <span style={{ color: "var(--theme-on-surface-subtle)" }}>Clean 1:1 Aspect Ratio Restored</span>
                  </div>
                  <img
                    src={selectedVerification.verifiedScreenshotUrl}
                    alt="Verified post repair render"
                    style={{ width: "100%", height: "300px", objectFit: "contain", display: "block", background: "#0e1117" }}
                  />
                </div>
              </div>

              {/* Worktree Info */}
              <div>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, fontFamily: "var(--font-heading)", marginBottom: "0.75rem" }}>
                  Isolated Execution Environment
                </h3>
                <div className="omni-code-panel">
                  <div>Worktree: <span style={{ color: "var(--theme-accent-blue)", fontWeight: 600 }}>{selectedVerification.isolatedWorktree}</span></div>
                  <div>Patch ID: <span style={{ color: "var(--theme-on-surface)", fontWeight: 600 }}>{selectedVerification.patchId}</span></div>
                  <div style={{ marginTop: "0.5rem", color: "var(--theme-on-surface-subtle)" }}>Diff Summary:</div>
                  <pre style={{ margin: 0, color: "var(--theme-on-surface)" }}>{selectedVerification.diffSummary}</pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="omni-card" style={{ textAlign: "center", padding: "4rem" }}>
              <p>No verification run recorded.</p>
            </div>
          )}
        </div>

        {/* Right Column: Verification History */}
        <div>
          <div className="omni-card" style={{ padding: "1.5rem" }}>
            <h2 className="omni-card-title" style={{ marginBottom: "0.75rem" }}>
              Verification Runs ({verifications.length})
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {verifications.map((v) => {
                const isSelected = v.jobId === selectedVerification?.jobId;
                return (
                  <div
                    key={v.jobId}
                    onClick={() => setSelectedJobId(v.jobId)}
                    style={{
                      padding: "1.125rem",
                      borderRadius: "var(--radius-sm)",
                      border: isSelected ? "1.5px solid var(--theme-on-surface)" : "1px solid var(--theme-outline)",
                      background: isSelected ? "var(--theme-container)" : "var(--theme-surface)",
                      cursor: "pointer",
                      transition: "all 140ms ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.875rem", fontFamily: "var(--font-mono)" }}>
                        {v.jobId}
                      </span>
                      <span
                        className={`omni-badge ${
                          v.finalState === "PASSED"
                            ? "omni-badge-success"
                            : v.finalState === "REJECTED"
                            ? "omni-badge-danger"
                            : "omni-badge-warning"
                        }`}
                        style={{ fontSize: "0.625rem" }}
                      >
                        {v.finalState}
                      </span>
                    </div>

                    <div style={{ fontSize: "0.8125rem", color: "var(--theme-on-surface-variant)", marginBottom: "0.25rem" }}>
                      {v.defectCategory}
                    </div>

                    <div style={{ fontSize: "0.75rem", color: "var(--theme-on-surface-subtle)" }}>
                      {new Date(v.createdAt).toLocaleTimeString()} • Build: {v.buildPassed ? "Pass" : "Fail"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
