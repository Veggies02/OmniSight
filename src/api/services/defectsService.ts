/**
 * OmniSight Defects Service
 *
 * Coordinates defect findings retrieval across the backend orchestrator and VLM pipeline.
 *
 * Current Backend Status:
 * In Week 1, the backend stores findings on the job inspection summary.
 * A dedicated `/jobs/{job_id}/defects` sub-route is agreed for Week 2 integration.
 * This service provides the typed boundary and gracefully surfaces findings.
 */

import { jobsService, JobsService } from "./jobsService.ts";
import type { RequestOptions } from "../client.ts";
import type { AIFinding } from "../../types/contracts.ts";

export class DefectsService {
  private jobs: JobsService;

  constructor(jobs: JobsService = jobsService) {
    this.jobs = jobs;
  }

  /**
   * Fetches defect findings for a job.
   * Extracts findings from job inspection payload or returns an empty list.
   */
  public async getJobDefects(jobId: string, options?: RequestOptions): Promise<AIFinding[]> {
    const job = await this.jobs.getJob(jobId, options);

    // If findings are embedded in inspection summary (P2/P3 format)
    const inspection = job.inspection as unknown as { findings?: AIFinding[] } | undefined;
    if (inspection && Array.isArray(inspection.findings)) {
      return inspection.findings;
    }

    return [];
  }
}

export const defectsService = new DefectsService();
