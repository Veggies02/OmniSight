/**
 * OmniSight Evidence Service
 *
 * Implements confirmed artifact and visual evidence metadata operations:
 * - GET /jobs/{job_id}/artifacts (list all artifact references for a job)
 * - URL resolution for static artifact serving vs mock URIs
 */

import { apiClient, OmniSightApiClient, type RequestOptions } from "../client.ts";
import type { BackendArtifactRef } from "../../types/contracts.ts";

export class EvidenceService {
  private client: OmniSightApiClient;

  constructor(client: OmniSightApiClient = apiClient) {
    this.client = client;
  }

  /**
   * Retrieves artifact references staged for a specific job
   * GET /jobs/{job_id}/artifacts
   */
  public async getJobArtifacts(
    jobId: string,
    options?: RequestOptions
  ): Promise<BackendArtifactRef[]> {
    const cleanId = encodeURIComponent(jobId.replace(/^#/, "").trim());
    return this.client.get<BackendArtifactRef[]>(`jobs/${cleanId}/artifacts`, options);
  }

  /**
   * Resolves an artifact URI to a browser-loadable image or download URL.
   * Handles local filesystem paths, static server paths, and mock:// indicators.
   */
  public resolveArtifactUrl(artifact: { uri?: string; mock?: boolean }): string | undefined {
    if (!artifact.uri) return undefined;

    // Handle mock:// URIs
    if (artifact.uri.startsWith("mock://")) {
      return undefined; // Handled by UI placeholder or fallback assets
    }

    // If already absolute HTTP URL
    if (artifact.uri.startsWith("http://") || artifact.uri.startsWith("https://")) {
      return artifact.uri;
    }

    // Normalize relative artifact path against base URL
    const cleanUri = artifact.uri.replace(/^\/+/, "");
    const base = this.client.getBaseUrl().replace(/\/api\/?$/, "");

    return `${base}/${cleanUri}`;
  }
}

export const evidenceService = new EvidenceService();
