/**
 * OmniSight Validation Service
 *
 * Coordinates self-healing verification and test-assertion results.
 *
 * Current Backend Status:
 * Person 3's backend state machine includes `validating` status.
 * Granular assertion reporting (`GET /jobs/{job_id}/validation`) is planned for Days 15–17.
 * This service defines the clean boundary and provides typed fallback support.
 */

import { jobsService, JobsService } from "./jobsService.ts";
import type { RequestOptions } from "../client.ts";
import type { JobValidationResult } from "../../types/dashboard.ts";

export class ValidationService {
  private jobs: JobsService;

  constructor(jobs: JobsService = jobsService) {
    this.jobs = jobs;
  }

  /**
   * Fetches validation outcomes for an inspection job.
   */
  public async getJobValidation(
    jobId: string,
    options?: RequestOptions
  ): Promise<JobValidationResult | null> {
    const job = await this.jobs.getJob(jobId, options);

    // If validation summary is embedded on the job response
    const rawVal = (job as unknown as { validation?: JobValidationResult }).validation;
    if (rawVal && typeof rawVal === "object" && Array.isArray(rawVal.checks)) {
      return rawVal;
    }

    return null;
  }
}

export const validationService = new ValidationService();
