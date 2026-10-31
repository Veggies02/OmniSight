import { INITIAL_MULTI_SCENARIO_JOBS } from "../data/mockMultiScenarioJobs";
import type { CaptureJob, ScenarioItem } from "../types/multi-scenario-types";

const STORAGE_KEY = "omnisight:multi-scenario-jobs";

export interface IMultiScenarioRepository {
  getAllJobs(): Promise<CaptureJob[]>;
  getJobById(jobId: string): Promise<CaptureJob | null>;
  approveScenario(jobId: string, scenarioId: string, reviewer?: string): Promise<ScenarioItem>;
  rejectScenario(
    jobId: string,
    scenarioId: string,
    reason: string,
    reviewer?: string
  ): Promise<ScenarioItem>;
  simulateRepair(
    jobId: string,
    scenarioId: string,
    onProgress?: (step: string) => void
  ): Promise<ScenarioItem>;
  resetJob(jobId: string): Promise<CaptureJob>;
}

export class MultiScenarioRepository implements IMultiScenarioRepository {
  private getStoredJobs(): CaptureJob[] {
    if (typeof window === "undefined") {
      return JSON.parse(JSON.stringify(INITIAL_MULTI_SCENARIO_JOBS));
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(INITIAL_MULTI_SCENARIO_JOBS)
        );
        return JSON.parse(JSON.stringify(INITIAL_MULTI_SCENARIO_JOBS));
      }
      return JSON.parse(raw);
    } catch {
      return JSON.parse(JSON.stringify(INITIAL_MULTI_SCENARIO_JOBS));
    }
  }

  private saveJobs(jobs: CaptureJob[]): void {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
      } catch (err) {
        console.warn("Failed to persist multi-scenario jobs to localStorage", err);
      }
    }
  }

  public async getAllJobs(): Promise<CaptureJob[]> {
    return this.getStoredJobs();
  }

  public async getJobById(jobId: string): Promise<CaptureJob | null> {
    const jobs = this.getStoredJobs();
    const found = jobs.find((j) => j.jobId === jobId);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  public async approveScenario(
    jobId: string,
    scenarioId: string,
    reviewer: string = "lead-reviewer@omnisight.dev"
  ): Promise<ScenarioItem> {
    const jobs = this.getStoredJobs();
    const job = jobs.find((j) => j.jobId === jobId);
    if (!job) {
      throw new Error(`Job '${jobId}' not found`);
    }

    const scenario = job.scenarios.find((s) => s.scenarioId === scenarioId);
    if (!scenario) {
      throw new Error(`Scenario '${scenarioId}' not found in job '${jobId}'`);
    }

    scenario.status = "approved";
    scenario.approvalStatus = "approved";
    scenario.reviewedBy = reviewer;
    scenario.timestamps.approvedAt = new Date().toISOString();
    scenario.timestamps.rejectedAt = undefined;
    scenario.rejectionReason = undefined;

    this.saveJobs(jobs);
    return JSON.parse(JSON.stringify(scenario));
  }

  public async rejectScenario(
    jobId: string,
    scenarioId: string,
    reason: string,
    reviewer: string = "lead-reviewer@omnisight.dev"
  ): Promise<ScenarioItem> {
    if (!reason || !reason.trim()) {
      throw new Error("Rejection feedback reason is required.");
    }

    const jobs = this.getStoredJobs();
    const job = jobs.find((j) => j.jobId === jobId);
    if (!job) {
      throw new Error(`Job '${jobId}' not found`);
    }

    const scenario = job.scenarios.find((s) => s.scenarioId === scenarioId);
    if (!scenario) {
      throw new Error(`Scenario '${scenarioId}' not found in job '${jobId}'`);
    }

    scenario.status = "rejected";
    scenario.approvalStatus = "rejected";
    scenario.reviewedBy = reviewer;
    scenario.rejectionReason = reason.trim();
    scenario.timestamps.rejectedAt = new Date().toISOString();
    scenario.timestamps.approvedAt = undefined;

    this.saveJobs(jobs);
    return JSON.parse(JSON.stringify(scenario));
  }

  public async simulateRepair(
    jobId: string,
    scenarioId: string,
    onProgress?: (step: string) => void
  ): Promise<ScenarioItem> {
    const jobs = this.getStoredJobs();
    const job = jobs.find((j) => j.jobId === jobId);
    if (!job) {
      throw new Error(`Job '${jobId}' not found`);
    }

    const scenario = job.scenarios.find((s) => s.scenarioId === scenarioId);
    if (!scenario) {
      throw new Error(`Scenario '${scenarioId}' not found in job '${jobId}'`);
    }

    if (scenario.approvalStatus !== "approved") {
      throw new Error(
        `Scenario '${scenarioId}' cannot be repaired because it has not been approved.`
      );
    }

    // Step 1: Initialize isolated worktree
    onProgress?.("1/3 Initializing isolated Git worktree...");
    await new Promise((r) => setTimeout(r, 250));

    // Step 2: Apply deterministic registered patch
    onProgress?.(`2/3 Applying registered patch: ${scenario.patchId}...`);
    await new Promise((r) => setTimeout(r, 250));

    // Step 3: Run build & visual verification
    onProgress?.("3/3 Running build validation and visual delta checks...");
    await new Promise((r) => setTimeout(r, 250));

    // Determine deterministic outcome (for demo prototype: unsupported defect fails, all others succeed)
    const isSuccess = scenario.patchId !== "unsupported" && scenario.severity !== "low";

    if (isSuccess) {
      scenario.status = "repaired";
      scenario.repairStatus = "completed";
      scenario.validationStatus = "passed";
      scenario.timestamps.repairedAt = new Date().toISOString();
      scenario.repairReport = {
        simulated: true,
        stepsCompleted: [
          "Isolated worktree created at /tmp/worktree-" + scenarioId,
          `Applied patch ${scenario.patchId} to ${scenario.targetFile}`,
          "Vite build passed with 0 warnings",
          "Visual regression checks confirmed 0px delta",
        ],
        durationSeconds: 2.4,
        buildPassed: true,
        visualValidationPassed: true,
        message: "Simulated self-healing repair succeeded and validated in isolated sandbox.",
      };
    } else {
      scenario.status = "failed";
      scenario.repairStatus = "failed";
      scenario.validationStatus = "failed";
      scenario.timestamps.repairedAt = new Date().toISOString();
      scenario.repairReport = {
        simulated: true,
        stepsCompleted: [
          "Isolated worktree created",
          "Attempted patch application",
          "Post-repair visual verification failed threshold requirement",
        ],
        durationSeconds: 1.8,
        buildPassed: true,
        visualValidationPassed: false,
        message: "Simulated visual verification failed: residual contrast or element overflow detected.",
      };
    }

    this.saveJobs(jobs);
    return JSON.parse(JSON.stringify(scenario));
  }

  public async resetJob(jobId: string): Promise<CaptureJob> {
    const defaultJob = INITIAL_MULTI_SCENARIO_JOBS.find((j) => j.jobId === jobId) ||
      INITIAL_MULTI_SCENARIO_JOBS[0];
    const jobs = this.getStoredJobs();
    const idx = jobs.findIndex((j) => j.jobId === jobId);

    if (idx !== -1) {
      jobs[idx] = JSON.parse(JSON.stringify(defaultJob));
    } else {
      jobs.push(JSON.parse(JSON.stringify(defaultJob)));
    }

    this.saveJobs(jobs);
    return JSON.parse(JSON.stringify(defaultJob));
  }
}

export const multiScenarioRepository = new MultiScenarioRepository();
