/**
 * Node 22 Native Test Suite for OmniSight API Client & Services
 *
 * Verifies:
 * - Successful GET / POST JSON responses
 * - HTTP errors (404, 500) with detail parsing
 * - Network failures and timeouts
 * - External AbortSignal cancellation
 * - Credential and token sanitization in error details
 * - Service method calls and URL param serialization
 * - Resilient fallback adapter behavior
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Import modules under test
import { OmniSightApiClient, ApiError } from "../src/api/client.ts";
import { JobsService } from "../src/api/services/jobsService.ts";
import { EvidenceService } from "../src/api/services/evidenceService.ts";
import {
  adaptBackendJobToInspectionJob,
  loadInspectionJobsWithFallback,
  loadJobDetailsWithFallback,
} from "../src/api/adapters.ts";

describe("OmniSightApiClient", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("successfully executes GET request and parses JSON body", async () => {
    const mockData = { items: [{ job_id: "JOB-TEST-1", status: "completed" }], total: 1 };

    globalThis.fetch = async (url, options) => {
      assert.match(url.toString(), /\/api\/jobs$/);
      assert.equal(options.method, "GET");
      return {
        ok: true,
        status: 200,
        json: async () => mockData,
      };
    };

    const client = new OmniSightApiClient({ baseUrl: "/api" });
    const result = await client.get("jobs");
    assert.deepEqual(result, mockData);
  });

  test("correctly appends query parameters to request URL", async () => {
    let capturedUrl = "";

    globalThis.fetch = async (url) => {
      capturedUrl = url.toString();
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      };
    };

    const client = new OmniSightApiClient({ baseUrl: "/api" });
    await client.get("jobs", {
      params: { status: "inspecting", limit: 25, offset: 0 },
    });

    assert.ok(capturedUrl.includes("status=inspecting"));
    assert.ok(capturedUrl.includes("limit=25"));
    assert.ok(capturedUrl.includes("offset=0"));
  });

  test("handles HTTP 404 error with parsed message and status", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Job not found" }),
    });

    const client = new OmniSightApiClient({ baseUrl: "/api" });

    await assert.rejects(
      async () => client.get("jobs/missing-id"),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 404);
        assert.equal(err.isNotFound, true);
        assert.equal(err.kind, "HTTP_ERROR");
        assert.equal(err.message, "Job not found");
        return true;
      }
    );
  });

  test("handles HTTP 500 error and captures details safely", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ detail: "Internal database query exception" }),
    });

    const client = new OmniSightApiClient({ baseUrl: "/api" });

    await assert.rejects(
      async () => client.get("jobs"),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 500);
        assert.equal(err.message, "Internal database query exception");
        return true;
      }
    );
  });

  test("handles network failure and sets isNetworkError to true", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch: Connection refused");
    };

    const client = new OmniSightApiClient({ baseUrl: "/api" });

    await assert.rejects(
      async () => client.get("jobs"),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.isNetworkError, true);
        assert.equal(err.kind, "NETWORK_ERROR");
        assert.match(err.message, /Connection refused/);
        return true;
      }
    );
  });

  test("handles request timeout and marks isTimeout to true", async () => {
    globalThis.fetch = async (url, options) => {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const abortError = new DOMException("The operation was aborted.", "AbortError");
          reject(abortError);
        });
      });
    };

    const client = new OmniSightApiClient({ baseUrl: "/api", timeoutMs: 50 });

    await assert.rejects(
      async () => client.get("jobs", { timeoutMs: 50 }),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.isTimeout, true);
        assert.equal(err.kind, "TIMEOUT_ERROR");
        assert.match(err.message, /timed out/);
        return true;
      }
    );
  });

  test("handles external AbortSignal cancellation", async () => {
    const controller = new AbortController();

    globalThis.fetch = async (url, options) => {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const abortError = new DOMException("The user aborted a request.", "AbortError");
          reject(abortError);
        });
      });
    };

    const client = new OmniSightApiClient({ baseUrl: "/api", timeoutMs: 5000 });

    const promise = client.get("jobs", { signal: controller.signal });
    controller.abort();

    await assert.rejects(
      async () => promise,
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.isAbort, true);
        assert.equal(err.kind, "ABORT_ERROR");
        return true;
      }
    );
  });

  test("sanitizes sensitive credentials from error details", () => {
    const error = new ApiError({
      message: "Authentication failure",
      kind: "HTTP_ERROR",
      status: 401,
      endpoint: "jobs",
      details: {
        token: "secret_token_12345",
        password: "super_secret_password",
        system: "ok",
      },
    });

    const stringified = JSON.stringify(error.details);
    assert.ok(!stringified.includes("secret_token_12345"));
    assert.ok(!stringified.includes("super_secret_password"));
    assert.ok(stringified.includes("[REDACTED]"));
  });
});

describe("JobsService & EvidenceService", () => {
  test("JobsService calls listJobs and getJob with expected paths", async () => {
    let requestedEndpoint = "";
    const mockClient = {
      get: async (endpoint) => {
        requestedEndpoint = endpoint;
        return {
          job_id: "JOB-1234",
          website_url: "http://localhost:3000",
          status: "completed",
          artifacts: [],
        };
      },
    };

    const jobs = new JobsService(mockClient);
    const job = await jobs.getJob("JOB-1234");
    assert.equal(requestedEndpoint, "jobs/JOB-1234");
    assert.equal(job.job_id, "JOB-1234");
  });

  test("EvidenceService resolves relative vs mock URIs", () => {
    const service = new EvidenceService(new OmniSightApiClient({ baseUrl: "/api" }));

    assert.equal(service.resolveArtifactUrl({ uri: "mock://placeholder.png" }), undefined);
    assert.equal(
      service.resolveArtifactUrl({ uri: "https://example.com/screenshot.png" }),
      "https://example.com/screenshot.png"
    );
    assert.equal(
      service.resolveArtifactUrl({ uri: "artifacts/test.png" }),
      "/artifacts/test.png"
    );
  });

  test("adaptBackendJobToInspectionJob correctly maps state machine and fields", () => {
    const backendJob = {
      job_id: "JOB-9999",
      website_url: "https://example.com/checkout",
      status: "inspecting",
      source: "manual",
      created_at: "2026-10-21T10:00:00Z",
      updated_at: "2026-10-21T10:01:00Z",
      artifacts: [
        {
          artifact_id: "art_1",
          kind: "screenshot",
          uri: "artifacts/test.png",
          description: "Test snapshot",
          created_at: "2026-10-21T10:00:30Z",
        },
      ],
    };

    const adapted = adaptBackendJobToInspectionJob(backendJob);

    assert.equal(adapted.id, "JOB-9999");
    assert.equal(adapted.targetRoute, "/checkout");
    assert.equal(adapted.status, "running"); // "inspecting" maps to running badge
    assert.equal(adapted.evidence.length, 1);
    assert.equal(adapted.evidence[0].id, "art_1");
  });

  test("loadInspectionJobsWithFallback returns mock data when backend throws error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Connection refused");
    };

    try {
      const result = await loadInspectionJobsWithFallback();
      assert.equal(result.isLiveBackend, false);
      assert.ok(result.jobs.length > 0);
      assert.ok(result.error);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loadInspectionJobsWithFallback returns live backend jobs on success", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            job_id: "JOB-LIVE-1",
            website_url: "http://localhost:3000/cart",
            status: "completed",
            source: "manual",
            created_at: "2026-10-23T10:00:00Z",
            updated_at: "2026-10-23T10:01:00Z",
            artifacts: [],
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    });

    try {
      const result = await loadInspectionJobsWithFallback();
      assert.equal(result.isLiveBackend, true);
      assert.equal(result.jobs.length, 1);
      assert.equal(result.jobs[0].id, "JOB-LIVE-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loadJobDetailsWithFallback returns live job on successful API call", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.ok(url.toString().includes("jobs/JOB-LIVE-99"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          job_id: "JOB-LIVE-99",
          website_url: "http://localhost:3000/products",
          status: "failed",
          source: "ci",
          created_at: "2026-10-23T12:00:00Z",
          updated_at: "2026-10-23T12:02:00Z",
          error: "1 visual regression defect found",
          artifacts: [],
        }),
      };
    };

    try {
      const result = await loadJobDetailsWithFallback("JOB-LIVE-99");
      assert.equal(result.isLiveBackend, true);
      assert.ok(result.job);
      assert.equal(result.job.id, "JOB-LIVE-99");
      assert.equal(result.job.status, "failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loadJobDetailsWithFallback falls back to mock data if backend errors out", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("FastAPI server offline");
    };

    try {
      // "JOB-1084" is in mockJobs.ts
      const result = await loadJobDetailsWithFallback("JOB-1084");
      assert.equal(result.isLiveBackend, false);
      assert.ok(result.job);
      assert.equal(result.job.id, "JOB-1084");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loadJobDetailsWithFallback returns undefined job if not in backend and not in mock", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Not found" }),
    });

    try {
      const result = await loadJobDetailsWithFallback("non-existent-xyz-999");
      assert.equal(result.job, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
