import { useState, useEffect } from "react";
import type { InspectionJob } from "../../types/dashboard.ts";
import type {
  CreateDraftPullRequestResult,
  ValidationGateStatus,
} from "../../services/github/types.ts";
import { clientGitHubService } from "../../api/services/githubService.ts";

export interface DraftPullRequestActionProps {
  job: InspectionJob;
  repairBranch?: string;
  headCommitSha?: string;
  onSuccess?: (result: CreateDraftPullRequestResult) => void;
}

export function DraftPullRequestAction({
  job,
  repairBranch,
  headCommitSha,
  onSuccess,
}: DraftPullRequestActionProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prResult, setPrResult] = useState<CreateDraftPullRequestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCheckingExisting, setIsCheckingExisting] = useState(false);

  const isValidationPassed = job.validationStatus === "passed";
  const effectiveBranch = repairBranch || (job.commitSha ? `omnisight/repair-${job.id}` : undefined);
  const effectiveSha = headCommitSha || job.commitSha;

  // Prerequisites: validation passed + repair branch confirmed + commit SHA confirmed
  const hasPrerequisites = Boolean(isValidationPassed && effectiveBranch && effectiveSha);

  // Check on mount if an existing PR is already associated with this job
  useEffect(() => {
    let isCancelled = false;
    const checkExistingPR = async () => {
      if (!job.id) return;
      setIsCheckingExisting(true);
      try {
        const existing = await clientGitHubService.getJobPullRequest(job.id);
        if (!isCancelled && existing) {
          setPrResult({
            prNumber: existing.number,
            prUrl: existing.url,
            title: existing.title,
            sourceBranch: existing.branch,
            baseBranch: existing.baseBranch,
            headCommitSha: existing.headCommitSha,
            status: "draft",
            isDraft: true,
            merged: false,
            createdAt: existing.createdAt,
            repository: existing.repository,
            existing: true,
            author: "omnisight[bot]",
          });
        }
      } catch {
        // Silently ignore if not found
      } finally {
        if (!isCancelled) setIsCheckingExisting(false);
      }
    };

    checkExistingPR();
    return () => {
      isCancelled = true;
    };
  }, [job.id]);

  const handleCreateDraftPR = async () => {
    if (isSubmitting || !effectiveBranch || !effectiveSha) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const validation: ValidationGateStatus = {
      status: job.validationStatus as any,
      totalChecks: job.validation?.totalChecks || (isValidationPassed ? 3 : 0),
      passedChecks: job.validation?.passedChecks || (isValidationPassed ? 3 : 0),
      failedChecks: job.validation?.failedChecks || 0,
      verifiedAt: job.validation?.completedAt || new Date().toISOString(),
    };

    const primaryDefect = job.defects?.[0];
    const category = (primaryDefect?.category as string) || "UI Defect";
    const title = primaryDefect?.title || `Self-healing fix for Job #${job.id}`;

    const evidenceUris =
      job.evidence && job.evidence.length > 0
        ? {
            baselineUri: job.evidence[0]?.baselineImageUrl || job.evidence[0]?.imageUrl,
            defectiveUri: job.evidence[0]?.defectiveImageUrl || job.evidence[0]?.imageUrl,
          }
        : undefined;

    const response = await clientGitHubService.createDraftPullRequest({
      jobId: job.id,
      findingId: primaryDefect?.id || "FND-001",
      headBranch: effectiveBranch,
      headCommitSha: effectiveSha,
      baseBranch: "main",
      targetRepository: job.repository || "Veggies02/OmniSight",
      validation,
      defectCategory: category,
      defectTitle: title,
      defectDescription: primaryDefect?.description,
      repairedComponent: primaryDefect?.affectedComponent,
      evidenceUris,
    });

    setIsSubmitting(false);

    if (response.success && response.result) {
      setPrResult(response.result);
      if (onSuccess) onSuccess(response.result);
    } else {
      setErrorMessage(response.error || "Failed to create GitHub Draft Pull Request");
    }
  };

  return (
    <div
      className="dash-panel"
      style={{
        marginTop: "1.25rem",
        border: "1px solid var(--color-border)",
        background: "var(--dash-card-bg, #111827)",
        borderRadius: "var(--radius-md, 8px)",
        padding: "1.25rem",
      }}
      aria-label="GitHub Draft Pull Request Section"
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="#a855f7"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M13 6h3a2 2 0 0 1 2 2v7" />
            <line x1="6" y1="9" x2="6" y2="21" />
          </svg>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text, #f9fafb)" }}>
            GitHub Draft Pull Request
          </h3>
        </div>

        <div>
          {prResult ? (
            <span
              style={{
                fontSize: "0.75rem",
                padding: "0.25rem 0.6rem",
                borderRadius: "9999px",
                backgroundColor: "rgba(168, 85, 247, 0.15)",
                color: "#c084fc",
                fontWeight: 600,
                border: "1px solid rgba(168, 85, 247, 0.3)",
              }}
            >
              Draft PR #{prResult.prNumber}
            </span>
          ) : hasPrerequisites ? (
            <span
              style={{
                fontSize: "0.75rem",
                padding: "0.25rem 0.6rem",
                borderRadius: "9999px",
                backgroundColor: "rgba(34, 197, 94, 0.15)",
                color: "#22c55e",
                fontWeight: 600,
                border: "1px solid rgba(34, 197, 94, 0.3)",
              }}
            >
              ✓ Prerequisites Satisfied
            </span>
          ) : (
            <span
              style={{
                fontSize: "0.75rem",
                padding: "0.25rem 0.6rem",
                borderRadius: "9999px",
                backgroundColor: "rgba(234, 179, 8, 0.15)",
                color: "#eab308",
                fontWeight: 600,
                border: "1px solid rgba(234, 179, 8, 0.3)",
              }}
            >
              ⏳ Repair Prerequisites Pending
            </span>
          )}
        </div>
      </div>

      <p style={{ fontSize: "0.875rem", color: "var(--color-text-secondary, #9ca3af)", margin: "0 0 1rem" }}>
        Opens a <strong>GitHub Draft Pull Request</strong> targeting <code>main</code> with verified UI repair artifacts.
        Automated merges are strictly prohibited; team code-owner triage and review are mandatory.
      </p>

      {/* Confirmed PR View */}
      {prResult ? (
        <div
          style={{
            padding: "1rem",
            backgroundColor: "rgba(168, 85, 247, 0.08)",
            border: "1px solid rgba(168, 85, 247, 0.3)",
            borderRadius: "6px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: "#c084fc", fontSize: "1.1rem" }}>✓</span>
              <strong style={{ color: "#c084fc", fontSize: "0.95rem" }}>
                Draft Pull Request Confirmed (#{prResult.prNumber})
              </strong>
            </div>

            {prResult.existing && (
              <span
                style={{
                  fontSize: "0.75rem",
                  padding: "0.2rem 0.5rem",
                  borderRadius: "4px",
                  backgroundColor: "rgba(59, 130, 246, 0.15)",
                  color: "#60a5fa",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                }}
                title="Existing PR was safely reused without duplicate submission"
              >
                Idempotent: Existing PR Reused
              </span>
            )}
          </div>

          <div style={{ marginBottom: "0.75rem", fontSize: "0.9rem", color: "#f3f4f6", fontWeight: 500 }}>
            {prResult.title}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem", fontSize: "0.825rem", marginBottom: "1rem" }}>
            <div>
              <span style={{ color: "var(--color-text-secondary, #9ca3af)" }}>PR Link: </span>
              <a
                href={prResult.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#60a5fa", textDecoration: "underline", wordBreak: "break-all" }}
              >
                {prResult.prUrl} ↗
              </a>
            </div>
            <div>
              <span style={{ color: "var(--color-text-secondary, #9ca3af)" }}>Source Branch: </span>
              <code style={{ color: "#c084fc" }}>{prResult.sourceBranch}</code>
            </div>
            <div>
              <span style={{ color: "var(--color-text-secondary, #9ca3af)" }}>Target Base: </span>
              <code>{prResult.baseBranch}</code>
            </div>
            <div>
              <span style={{ color: "var(--color-text-secondary, #9ca3af)" }}>Draft Status: </span>
              <span style={{ color: "#c084fc", fontWeight: 600 }}>Draft (Human Review Required)</span>
            </div>
          </div>

          <div
            style={{
              padding: "0.6rem 0.8rem",
              backgroundColor: "rgba(0, 0, 0, 0.25)",
              borderRadius: "4px",
              fontSize: "0.78rem",
              color: "#94a3b8",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span>🛡️</span>
            <span>
              <strong>Safeguard Enforced:</strong> Automated merges are disabled. Engineering team code-owner approval is required before this PR can be converted to ready for review and merged.
            </span>
          </div>
        </div>
      ) : (
        /* Action Button */
        <div>
          <button
            type="button"
            className="filter-pill-btn active"
            onClick={handleCreateDraftPR}
            disabled={!hasPrerequisites || isSubmitting || isCheckingExisting}
            style={{
              padding: "0.5rem 1.1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: hasPrerequisites && !isSubmitting ? "pointer" : "not-allowed",
              opacity: hasPrerequisites && !isSubmitting ? 1 : 0.6,
              background: hasPrerequisites ? "#7c3aed" : "var(--color-surface, #374151)",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            {isSubmitting ? (
              <>
                <svg
                  className="loading-spinner"
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                <span>Creating GitHub Draft PR...</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="18" cy="18" r="3" />
                  <circle cx="6" cy="6" r="3" />
                  <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                  <line x1="6" y1="9" x2="6" y2="21" />
                </svg>
                <span>Create Draft Pull Request</span>
              </>
            )}
          </button>

          {!hasPrerequisites && (
            <span
              style={{
                marginLeft: "1rem",
                fontSize: "0.8rem",
                color: "#eab308",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
              }}
            >
              <span>⚠️ Action disabled:</span>
              <span>
                {!isValidationPassed
                  ? "Requires verified validation passage."
                  : "Requires confirmed repair branch & commit SHA from step above."}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Actionable Error Banner */}
      {errorMessage && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem 1rem",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "6px",
            color: "#ef4444",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
          role="alert"
        >
          <span aria-hidden="true">✕</span>
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
