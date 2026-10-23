/**
 * OmniSight Backend-to-Frontend Domain Adapters & Resilient Fallback Layer
 *
 * Bridges the gap between backend SQLite schemas (Person 3) and the rich
 * presentation layer expected by the QA Dashboard (Person 4).
 *
 * Provides graceful fallback to mock data when backend is not running or unreachable,
 * ensuring the dashboard never crashes.
 */

import type {
  BackendJobResponse,
  BackendArtifactRef,
} from "../types/contracts.ts";
import {
  type InspectionJob,
  type InspectionEvidence,
  backendJobStatusToBadgeStatus,
} from "../types/dashboard.ts";
import { jobsService } from "./services/jobsService.ts";
import { MOCK_INSPECTION_JOBS, getInspectionJobById } from "../data/mockJobs.ts";

/**
 * Converts a backend ArtifactRef into the frontend InspectionEvidence interface
 */
export function adaptBackendArtifactToEvidence(
  artifact: BackendArtifactRef,
  jobId: string
): InspectionEvidence {
  const isImage = artifact.kind === "screenshot";

  return {
    id: artifact.artifact_id,
    type: artifact.kind === "screenshot" ? "screenshot" : artifact.kind === "trace" ? "playwright-trace" : "dom-snapshot",
    title: artifact.description || `Artifact ${artifact.artifact_id}`,
    viewport: "Desktop (1440 × 900)",
    capturedAt: artifact.created_at,
    description: artifact.description,
    imageUrl: isImage ? artifact.uri : undefined,
    defectiveImageUrl: isImage ? artifact.uri : undefined,
    jobId,
  };
}

/**
 * Converts a backend JobResponse into the full frontend InspectionJob model
 */
export function adaptBackendJobToInspectionJob(backend: BackendJobResponse): InspectionJob {
  const badgeStatus = backendJobStatusToBadgeStatus(backend.status);

  // Derive duration from inspection summary if available
  let duration = "In progress";
  if (backend.inspection?.duration_seconds !== undefined && backend.inspection?.duration_seconds !== null) {
    duration = `${backend.inspection.duration_seconds.toFixed(1)}s`;
  } else if (backend.status === "completed" || backend.status === "failed") {
    duration = "Finished";
  } else if (backend.status === "queued") {
    duration = "Queued";
  }

  // Derive evidence artifacts
  const evidence: InspectionEvidence[] = (backend.artifacts || []).map((art) =>
    adaptBackendArtifactToEvidence(art, backend.job_id)
  );

  return {
    id: backend.job_id,
    application: "OmniShop Storefront",
    targetRoute: backend.website_url.replace(/^https?:\/\/[^/]+/, "") || "/",
    timestamp: backend.created_at,
    startedAt: new Date(backend.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    status: badgeStatus,
    defectsCount: backend.status === "failed" ? 1 : 0,
    validationStatus:
      backend.status === "completed"
        ? "passed"
        : backend.status === "failed"
        ? "failed"
        : backend.status === "validating"
        ? "running"
        : "pending",
    duration,
    viewport: "Desktop (1440 × 900)",
    defectSummary: backend.error || backend.inspection?.message || "Automated scan run",
    defects: [],
    evidence,
    backendJobId: backend.job_id,
    repository: backend.repository,
    commitSha: backend.commit_sha,
  };
}

/**
 * Resilient job loader: Attempts to load jobs from live backend API.
 * If backend is unreachable or returns an error, cleanly falls back to mock data.
 */
export async function loadInspectionJobsWithFallback(options?: {
  status?: BackendJobStatus;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<{ jobs: InspectionJob[]; isLiveBackend: boolean; error?: string }> {
  try {
    const response = await jobsService.listJobs(
      { status: options?.status, limit: options?.limit ?? 50, offset: options?.offset },
      { signal: options?.signal }
    );
    if (response && Array.isArray(response.items) && response.items.length > 0) {
      const adaptedJobs = response.items.map(adaptBackendJobToInspectionJob);
      return { jobs: adaptedJobs, isLiveBackend: true };
    }
    // If backend returns empty list, fall back to mock demonstration jobs
    return { jobs: MOCK_INSPECTION_JOBS, isLiveBackend: false };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Backend unreachable";
    return { jobs: MOCK_INSPECTION_JOBS, isLiveBackend: false, error: errorMsg };
  }
}

/**
 * Resilient job details loader: Attempts to fetch a job from live backend API,
 * falling back to local mock data if not found or if the backend is down.
 */
export async function loadJobDetailsWithFallback(
  jobId: string,
  options?: { signal?: AbortSignal }
): Promise<{ job: InspectionJob | undefined; isLiveBackend: boolean; error?: string }> {
  try {
    const backendJob = await jobsService.getJob(jobId, options);
    if (backendJob) {
      return { job: adaptBackendJobToInspectionJob(backendJob), isLiveBackend: true };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Backend unreachable";
    // Check mock database
    const mockJob = getInspectionJobById(jobId);
    return { job: mockJob, isLiveBackend: false, error: errorMsg };
  }

  const mockJob = getInspectionJobById(jobId);
  return { job: mockJob, isLiveBackend: false };
}
