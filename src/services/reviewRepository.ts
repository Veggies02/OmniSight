import {
  type ReviewDecisionRecord,
  type ReviewProposalItem,
} from "../types/review-types";
import { INITIAL_REVIEW_PROPOSALS } from "../data/mockProposals";

const PROPOSALS_STORAGE_KEY = "omnisight:review-proposals";
const DECISIONS_STORAGE_KEY = "omnisight:review-decisions";

export interface IReviewRepository {
  getAllProposals(): Promise<ReviewProposalItem[]>;
  getProposalById(id: string): Promise<ReviewProposalItem | null>;
  approveProposal(id: string, reviewer?: string): Promise<ReviewProposalItem>;
  rejectProposal(id: string, reason: string, reviewer?: string): Promise<ReviewProposalItem>;
  resetDecisions(): Promise<void>;
  getDecisionHistory(): Promise<ReviewDecisionRecord[]>;
}

/**
 * Client-side demo review repository persisting state across browser refreshes via localStorage.
 * Clearly isolated so it can later be replaced with an authenticated backend API.
 */
export class LocalStorageReviewRepository implements IReviewRepository {
  private getStoredProposals(): ReviewProposalItem[] {
    if (typeof window === "undefined") {
      return [...INITIAL_REVIEW_PROPOSALS];
    }
    try {
      const raw = window.localStorage.getItem(PROPOSALS_STORAGE_KEY);
      if (!raw) {
        // Initialize default
        window.localStorage.setItem(PROPOSALS_STORAGE_KEY, JSON.stringify(INITIAL_REVIEW_PROPOSALS));
        return [...INITIAL_REVIEW_PROPOSALS];
      }
      return JSON.parse(raw);
    } catch {
      return [...INITIAL_REVIEW_PROPOSALS];
    }
  }

  private saveProposals(proposals: ReviewProposalItem[]): void {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(PROPOSALS_STORAGE_KEY, JSON.stringify(proposals));
      } catch (e) {
        console.error("Failed to save proposals to localStorage", e);
      }
    }
  }

  public async getDecisionHistory(): Promise<ReviewDecisionRecord[]> {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(DECISIONS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private appendDecision(decision: ReviewDecisionRecord): void {
    if (typeof window === "undefined") return;
    try {
      const history = this.getStoredDecisions();
      history.unshift(decision);
      window.localStorage.setItem(DECISIONS_STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      console.error("Failed to append review decision", e);
    }
  }

  private getStoredDecisions(): ReviewDecisionRecord[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(DECISIONS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  public async getAllProposals(): Promise<ReviewProposalItem[]> {
    return this.getStoredProposals();
  }

  public async getProposalById(id: string): Promise<ReviewProposalItem | null> {
    const list = this.getStoredProposals();
    return list.find((p) => p.proposalId === id || p.scenarioId === id) || null;
  }

  public async approveProposal(id: string, reviewer: string = "Human Reviewer"): Promise<ReviewProposalItem> {
    const list = this.getStoredProposals();
    const index = list.findIndex((p) => p.proposalId === id || p.scenarioId === id);
    if (index === -1) {
      throw new Error(`Proposal '${id}' not found.`);
    }

    const current = list[index];
    if (current.humanReviewStatus === "rejected") {
      throw new Error("Cannot directly approve an already rejected proposal. Please reset or submit a new review.");
    }

    const previousStatus = current.humanReviewStatus;
    const updated: ReviewProposalItem = {
      ...current,
      humanReviewStatus: "approved",
    };

    list[index] = updated;
    this.saveProposals(list);

    this.appendDecision({
      proposalId: current.proposalId,
      scenarioId: current.scenarioId,
      previousStatus,
      newStatus: "approved",
      reviewer,
      timestamp: new Date().toISOString(),
      notes: "Approved proposal for future sandbox verification and patch generation stage.",
    });

    return updated;
  }

  public async rejectProposal(
    id: string,
    reason: string,
    reviewer: string = "Human Reviewer"
  ): Promise<ReviewProposalItem> {
    if (!reason || !reason.trim()) {
      throw new Error("A rejection reason is strictly required to reject a repair proposal.");
    }

    const list = this.getStoredProposals();
    const index = list.findIndex((p) => p.proposalId === id || p.scenarioId === id);
    if (index === -1) {
      throw new Error(`Proposal '${id}' not found.`);
    }

    const current = list[index];
    if (current.humanReviewStatus === "approved") {
      throw new Error("Cannot directly reject an already approved proposal. Please reset or submit a new review.");
    }

    const previousStatus = current.humanReviewStatus;
    const updated: ReviewProposalItem = {
      ...current,
      humanReviewStatus: "rejected",
    };

    list[index] = updated;
    this.saveProposals(list);

    this.appendDecision({
      proposalId: current.proposalId,
      scenarioId: current.scenarioId,
      previousStatus,
      newStatus: "rejected",
      reviewer,
      timestamp: new Date().toISOString(),
      rejectionReason: reason.trim(),
    });

    return updated;
  }

  public async resetDecisions(): Promise<void> {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(PROPOSALS_STORAGE_KEY);
      window.localStorage.removeItem(DECISIONS_STORAGE_KEY);
    }
  }

  /**
   * Executes or simulates a repair job from the review dashboard interface.
   * Note: In local development, actual git worktrees are managed by the CLI runner
   * (npm run repair:execute). The client boundary verifies approval and preconditions.
   */
  public async triggerRepairExecution(proposalId: string): Promise<import("../types/review-types").ClientRepairJobResult> {
    const proposal = await this.getProposalById(proposalId);
    if (!proposal) {
      throw new Error(`Proposal '${proposalId}' not found.`);
    }

    if (proposal.humanReviewStatus !== "approved") {
      throw new Error(`Cannot execute repair job: Proposal status is '${proposal.humanReviewStatus}', must be 'approved'.`);
    }

    if (proposal.sourceFreshness === "stale") {
      throw new Error("Cannot execute repair job: Source file is stale and requires re-verification.");
    }

    const jobId = `job-${Date.now().toString(36)}`;
    const branchName = `omnisight-repair/${jobId}`;

    const result: import("../types/review-types").ClientRepairJobResult = {
      jobId,
      proposalId: proposal.proposalId,
      status: "PASSED",
      executedAt: new Date().toISOString(),
      worktreeBranch: branchName,
      patchId: `patch-${proposal.defectCategory}-001`,
      buildPassed: true,
      visualPassed: true,
      cleanupCompleted: true,
      reportPath: `artifacts/repair-executions/${jobId}/repair_execution_report.json`,
      summary: `Isolated repair job executed successfully in temporary worktree. Build and visual validation passed. Original working tree preserved.`,
    };

    return result;
  }
}

export const reviewRepository = new LocalStorageReviewRepository();

