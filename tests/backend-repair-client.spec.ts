import { test, expect } from "@playwright/test";
import {
  BackendRepairClient,
  BackendRepairError,
  ScenarioResponse,
  ScenarioPullRequest,
  ScenarioSummary,
  ScenarioOutcome,
} from "../src/services/backendRepairClient";

test.describe("Backend Repair API Client — Multi-Scenario V2 Contract", () => {
  const originalFetch = globalThis.fetch;

  let capturedRequests: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any;
  }> = [];

  test.beforeEach(() => {
    capturedRequests = [];
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchResponse(
    responseBody: any,
    status = 200,
    headers: Record<string, string> = { "Content-Type": "application/json" }
  ) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headerMap: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headerMap[key.toLowerCase()] = value;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([k, v]) => {
            headerMap[k.toLowerCase()] = v;
          });
        } else {
          Object.entries(init.headers).forEach(([k, v]) => {
            headerMap[k.toLowerCase()] = String(v);
          });
        }
      }

      let parsedBody: any = null;
      if (init?.body && typeof init.body === "string") {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      }

      capturedRequests.push({
        url: String(input),
        method: init?.method || "GET",
        headers: headerMap,
        body: parsedBody,
      });

      return new Response(
        typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody),
        {
          status,
          headers,
        }
      );
    }) as any;
  }

  // --------------------------------------------------------------------------
  // 1. getJobScenarios(jobId)
  // --------------------------------------------------------------------------
  test("getJobScenarios: issues GET /jobs/{job_id}/scenarios with proper encoding and no auth header", async () => {
    const mockScenarios: ScenarioResponse[] = [
      {
        scenario_id: "product-image-distortion",
        defect_category: "image_distortion",
        is_mock: true,
        diagnosis: { provider: "mock", model: "mock-vlm-v1", status: "diagnosed" },
        proposal: { proposalId: "prop-1", defectCategory: "image_distortion" },
        review_status: "pending_review",
        approval: null,
        repair_state: "not_started",
        repair_job_id: "job-1--product-image-distortion",
        repair: null,
        pr_status: "not_started",
        pull_request: null,
      },
    ];

    mockFetchResponse(mockScenarios);

    const client = new BackendRepairClient({
      baseUrl: "http://api.omnisight.test:8000",
      getAuthHeader: () => ({ "X-Operator-Token": "secret-token-123" }),
    });

    const result = await client.getJobScenarios("job/alpha 01");

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];
    expect(req.method).toBe("GET");
    expect(req.url).toBe("http://api.omnisight.test:8000/jobs/job%2Falpha%2001/scenarios");
    expect(req.headers["accept"]).toBe("application/json");
    // GET must NOT include operator auth token
    expect(req.headers["x-operator-token"]).toBeUndefined();
    expect(result).toEqual(mockScenarios);
  });

  test("getJobScenarios: supports wrapped { scenarios: [...] } payload shape", async () => {
    const mockScenarios: ScenarioResponse[] = [
      {
        scenario_id: "mobile-nav-overflow",
        defect_category: "responsive_overflow",
        is_mock: true,
        diagnosis: { provider: "mock", model: "mock-vlm-v1", status: "diagnosed" },
        proposal: { proposalId: "prop-nav-1" },
        review_status: "approved",
        approval: { reviewed_by: "qa-lead", reviewed_at: "2026-11-01T12:00:00Z" },
        repair_state: "passed",
        repair_job_id: "job-1--mobile-nav-overflow",
        repair: { outcome: "passed", branch: "omnisight-repair/job-1", commit_sha: "abc1234" },
        pr_status: "not_started",
        pull_request: null,
      },
    ];

    mockFetchResponse({ scenarios: mockScenarios });

    const client = new BackendRepairClient({ baseUrl: "http://localhost:8000" });
    const result = await client.getJobScenarios("job-xyz");

    expect(result).toHaveLength(1);
    expect(result[0].scenario_id).toBe("mobile-nav-overflow");
    expect(result[0].repair?.commit_sha).toBe("abc1234");
  });

  // --------------------------------------------------------------------------
  // 2. getScenario(jobId, scenarioId)
  // --------------------------------------------------------------------------
  test("getScenario: issues GET /jobs/{id}/scenarios/{scenario_id} with dual path encoding", async () => {
    const mockScenario: ScenarioResponse = {
      scenario_id: "low-contrast-text",
      defect_category: "low_contrast",
      is_mock: false,
      diagnosis: { provider: "gemini", model: "gemini-1.5-pro", status: "diagnosed" },
      proposal: { proposalId: "prop-contrast" },
      review_status: "pending_review",
      approval: null,
      repair_state: "not_started",
      repair_job_id: "job-001--low-contrast-text",
      repair: null,
      pr_status: "not_started",
      pull_request: null,
    };

    mockFetchResponse(mockScenario);

    const client = new BackendRepairClient({
      baseUrl: "https://backend.omnisight.ai",
      getAuthHeader: () => ({ "X-Operator-Token": "test-token" }),
    });

    const scenario = await client.getScenario("job:batch#1", "scenario:contrast/test");

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];
    expect(req.method).toBe("GET");
    expect(req.url).toBe(
      "https://backend.omnisight.ai/jobs/job%3Abatch%231/scenarios/scenario%3Acontrast%2Ftest"
    );
    expect(req.headers["x-operator-token"]).toBeUndefined();
    expect(scenario.scenario_id).toBe("low-contrast-text");
    expect(scenario.defect_category).toBe("low_contrast");
  });

  // --------------------------------------------------------------------------
  // 3. approveScenario(jobId, scenarioId, reviewedBy)
  // --------------------------------------------------------------------------
  test("approveScenario: issues POST /jobs/{id}/scenarios/{scenario_id}/approval with required X-Operator-Token", async () => {
    const mockApproved: ScenarioResponse = {
      scenario_id: "product-card-layout-break",
      defect_category: "layout_breakage",
      is_mock: true,
      diagnosis: { provider: "mock", model: "mock-vlm-v1", status: "diagnosed" },
      proposal: { proposalId: "prop-layout" },
      review_status: "approved",
      approval: { reviewed_by: "sarah-qa", reviewed_at: "2026-11-01T15:30:00Z" },
      repair_state: "not_started",
      repair_job_id: "job-42--product-card-layout-break",
      repair: null,
      pr_status: "not_started",
      pull_request: null,
    };

    mockFetchResponse(mockApproved);

    const client = new BackendRepairClient({
      baseUrl: "http://127.0.0.1:8000",
      getAuthHeader: () => ({ "X-Operator-Token": "op-token-999" }),
    });

    const result = await client.approveScenario("job-42", "product-card-layout-break", "sarah-qa");

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://127.0.0.1:8000/jobs/job-42/scenarios/product-card-layout-break/approval");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["x-operator-token"]).toBe("op-token-999");
    expect(req.body).toEqual({ reviewed_by: "sarah-qa" });
    expect(result.review_status).toBe("approved");
    expect(result.approval?.reviewed_by).toBe("sarah-qa");
  });

  // --------------------------------------------------------------------------
  // 4. rejectScenario(jobId, scenarioId, reviewedBy, reason)
  // --------------------------------------------------------------------------
  test("rejectScenario: issues POST /jobs/{id}/scenarios/{scenario_id}/rejection with reason and auth", async () => {
    const mockRejected: ScenarioResponse = {
      scenario_id: "product-image-distortion",
      defect_category: "image_distortion",
      is_mock: true,
      diagnosis: { provider: "mock", model: "mock-vlm-v1", status: "diagnosed" },
      proposal: { proposalId: "prop-img" },
      review_status: "rejected",
      approval: null,
      repair_state: "rejected",
      repair_job_id: "job-55--product-image-distortion",
      repair: null,
      pr_status: "not_started",
      pull_request: null,
    };

    mockFetchResponse(mockRejected);

    const client = new BackendRepairClient({
      baseUrl: "http://127.0.0.1:8000",
      getAuthHeader: () => ({ "X-Operator-Token": "op-token-secret" }),
    });

    const result = await client.rejectScenario(
      "job-55",
      "product-image-distortion",
      "lead-engineer",
      "Risk of breaking gallery layout"
    );

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://127.0.0.1:8000/jobs/job-55/scenarios/product-image-distortion/rejection");
    expect(req.headers["x-operator-token"]).toBe("op-token-secret");
    expect(req.body).toEqual({
      reviewed_by: "lead-engineer",
      reason: "Risk of breaking gallery layout",
    });
    expect(result.review_status).toBe("rejected");
  });

  // --------------------------------------------------------------------------
  // 5. executeScenarioRepair(jobId, scenarioId)
  // --------------------------------------------------------------------------
  test("executeScenarioRepair: issues POST /jobs/{id}/scenarios/{scenario_id}/repair expecting 202 Accepted", async () => {
    const mockJobResponse = {
      job_id: "job-101",
      website_url: "http://localhost:5173",
      status: "applying_patch",
      stage: "repairing",
      source: "manual",
      created_at: "2026-11-01T10:00:00Z",
      updated_at: "2026-11-01T10:05:00Z",
      artifacts: [],
    };

    mockFetchResponse(mockJobResponse, 202);

    const client = new BackendRepairClient({
      baseUrl: "http://localhost:8000",
      getAuthHeader: () => ({ "X-Operator-Token": "op-token-repair" }),
    });

    const result = await client.executeScenarioRepair("job-101", "mobile-nav-overflow");

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://localhost:8000/jobs/job-101/scenarios/mobile-nav-overflow/repair");
    expect(req.headers["x-operator-token"]).toBe("op-token-repair");
    expect((result as any).status).toBe("applying_patch");
    expect((result as any).stage).toBe("repairing");
  });

  // --------------------------------------------------------------------------
  // 6. createScenarioPullRequest(jobId, scenarioId, request)
  // --------------------------------------------------------------------------
  test("createScenarioPullRequest: issues POST /jobs/{id}/scenarios/{scenario_id}/pr with auth and optional body", async () => {
    const mockScenarioWithPr: ScenarioResponse = {
      scenario_id: "mobile-nav-overflow",
      defect_category: "responsive_overflow",
      is_mock: true,
      diagnosis: { provider: "mock", model: "mock-vlm-v1", status: "diagnosed" },
      proposal: { proposalId: "prop-nav" },
      review_status: "approved",
      approval: { reviewed_by: "qa", reviewed_at: "2026-11-01T10:00:00Z" },
      repair_state: "passed",
      repair_job_id: "job-200--mobile-nav-overflow",
      repair: { outcome: "passed", branch: "omnisight-repair/job-200", commit_sha: "fe34a1b" },
      pr_status: "created",
      pull_request: {
        pr_number: 45,
        url: "https://github.com/Veggies02/OmniSight/pull/45",
        state: "draft",
        draft: true,
        head_branch: "omnisight-repair/job-200",
        head_commit_sha: "fe34a1b",
        base_branch: "main",
        repository: "Veggies02/OmniSight",
        existing: false,
      },
    };

    mockFetchResponse(mockScenarioWithPr, 201);

    const client = new BackendRepairClient({
      baseUrl: "http://127.0.0.1:8000",
      getAuthHeader: () => ({ "X-Operator-Token": "op-token-pr" }),
    });

    const result = await client.createScenarioPullRequest("job-200", "mobile-nav-overflow", {
      title: "fix(nav): resolve mobile horizontal overflow",
      body: "Automated OmniSight repair PR",
      base_branch: "main",
    });

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://127.0.0.1:8000/jobs/job-200/scenarios/mobile-nav-overflow/pr");
    expect(req.headers["x-operator-token"]).toBe("op-token-pr");
    expect(req.body).toEqual({
      title: "fix(nav): resolve mobile horizontal overflow",
      body: "Automated OmniSight repair PR",
      base_branch: "main",
    });
    expect((result as ScenarioResponse).pr_status).toBe("created");
    expect((result as ScenarioResponse).pull_request?.pr_number).toBe(45);
  });

  // --------------------------------------------------------------------------
  // 7. getScenarioPullRequest(jobId, scenarioId)
  // --------------------------------------------------------------------------
  test("getScenarioPullRequest: issues GET /jobs/{id}/scenarios/{scenario_id}/pr and returns PR object", async () => {
    const mockPr: ScenarioPullRequest = {
      pr_number: 77,
      url: "https://github.com/Veggies02/OmniSight/pull/77",
      state: "draft",
      draft: true,
      head_branch: "omnisight-repair/job-300",
      head_commit_sha: "998877665544",
      base_branch: "main",
      repository: "Veggies02/OmniSight",
      existing: true,
    };

    mockFetchResponse(mockPr, 200);

    const client = new BackendRepairClient({ baseUrl: "http://localhost:8000" });
    const pr = await client.getScenarioPullRequest("job-300", "low-contrast-text");

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];
    expect(req.method).toBe("GET");
    expect(req.url).toBe("http://localhost:8000/jobs/job-300/scenarios/low-contrast-text/pr");
    expect(req.headers["x-operator-token"]).toBeUndefined();
    expect(pr).toEqual(mockPr);
  });

  test("getScenarioPullRequest: returns null on HTTP 404 (no PR created yet)", async () => {
    mockFetchResponse({ detail: "No PR exists for scenario low-contrast-text" }, 404);

    const client = new BackendRepairClient({ baseUrl: "http://localhost:8000" });
    const pr = await client.getScenarioPullRequest("job-300", "low-contrast-text");

    expect(pr).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 8. Error Handling (400, 401, 403, 404, 409, 500)
  // --------------------------------------------------------------------------
  test("Error handling: 400 Bad Request throws BackendRepairError with server detail", async () => {
    mockFetchResponse({ detail: "Invalid request payload: scenario id malformed" }, 400);

    const client = new BackendRepairClient({ baseUrl: "http://localhost:8000" });

    await expect(client.getScenario("job-1", "bad--id")).rejects.toThrow(
      /Invalid request payload: scenario id malformed/
    );
  });

  test("Error handling: 401 Unauthorized propagates HTTP 401 status", async () => {
    mockFetchResponse({ detail: "Invalid or missing X-Operator-Token" }, 401);

    const client = new BackendRepairClient({ baseUrl: "http://localhost:8000" });

    try {
      await client.approveScenario("job-1", "sc-1");
      expect(true).toBe(false); // should not reach
    } catch (err: any) {
      expect(err).toBeInstanceOf(BackendRepairError);
      expect(err.status).toBe(401);
      expect(err.message).toContain("X-Operator-Token");
    }
  });

  test("Error handling: 403 Forbidden propagates HTTP 403 status", async () => {
    mockFetchResponse({ detail: "Operator role does not have approval permissions" }, 403);

    const client = new BackendRepairClient({ baseUrl: "http://localhost:8000" });

    await expect(client.approveScenario("job-1", "sc-1")).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("approval permissions"),
    });
  });

  test("Error handling: 404 Not Found propagates HTTP 404 status", async () => {
    mockFetchResponse({ detail: "Scenario 'non-existent' not found in job 'job-1'" }, 404);

    const client = new BackendRepairClient({ baseUrl: "http://localhost:8000" });

    await expect(client.getScenario("job-1", "non-existent")).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("not found"),
    });
  });

  test("Error handling: 409 Conflict (e.g. another repair already running) propagates HTTP 409", async () => {
    mockFetchResponse(
      { detail: "Another repair is currently running on the server. Try again shortly." },
      409
    );

    const client = new BackendRepairClient({
      baseUrl: "http://localhost:8000",
      getAuthHeader: () => ({ "X-Operator-Token": "token" }),
    });

    await expect(client.executeScenarioRepair("job-1", "sc-2")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Another repair is currently running"),
    });
  });

  test("Error handling: 500 Internal Server Error propagates HTTP 500 status", async () => {
    mockFetchResponse({ detail: "Database connection failed unexpectedly" }, 500);

    const client = new BackendRepairClient({ baseUrl: "http://localhost:8000" });

    await expect(client.getJobScenarios("job-1")).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining("Database connection failed"),
    });
  });

  // --------------------------------------------------------------------------
  // 9. Legacy API Compatibility
  // --------------------------------------------------------------------------
  test("Legacy Compatibility: getJob, attachProposal, recordApproval, executeRepair, createPullRequest, getPullRequest remain functional", async () => {
    const mockLegacyJob = {
      job_id: "legacy-job-1",
      website_url: "http://example.com",
      status: "repair_proposed",
      stage: "awaiting_approval",
      source: "manual",
      created_at: "2026-10-30T10:00:00Z",
      updated_at: "2026-10-30T10:05:00Z",
      artifacts: [],
      // Accommodates v2 additions seamlessly
      summary: {
        total: 1,
        pending_review: 1,
        approved: 0,
        repairing: 0,
        passed: 0,
        failed: 0,
        rejected: 0,
        unsupported: 0,
        prs_created: 0,
      },
      outcome: null,
    };

    mockFetchResponse(mockLegacyJob);

    const client = new BackendRepairClient({
      baseUrl: "http://localhost:8000",
      getAuthHeader: () => ({ "X-Operator-Token": "legacy-token" }),
    });

    const job = await client.getJob("legacy-job-1");
    expect(job.job_id).toBe("legacy-job-1");
    expect(capturedRequests[0].url).toBe("http://localhost:8000/jobs/legacy-job-1");

    // Test recordApproval (legacy)
    capturedRequests = [];
    mockFetchResponse({ ...mockLegacyJob, status: "applying_patch" });
    const approvedJob = await client.recordApproval("legacy-job-1", "reviewer-bob");
    expect(approvedJob.status).toBe("applying_patch");
    expect(capturedRequests[0].url).toBe("http://localhost:8000/jobs/legacy-job-1/approval");
    expect(capturedRequests[0].headers["x-operator-token"]).toBe("legacy-token");

    // Test executeRepair (legacy)
    capturedRequests = [];
    mockFetchResponse({ ...mockLegacyJob, status: "applying_patch" });
    await client.executeRepair("legacy-job-1");
    expect(capturedRequests[0].url).toBe("http://localhost:8000/jobs/legacy-job-1/repair");

    // Test getPullRequest (legacy)
    capturedRequests = [];
    mockFetchResponse({
      pr_number: 10,
      pr_url: "http://github.com/org/repo/pull/10",
      title: "fix: ui",
      head_branch: "repair/b1",
      base_branch: "main",
      status: "draft",
      is_draft: true,
      merged: false,
      created_at: "2026-10-30T10:00:00Z",
      repository: "org/repo",
      existing: false,
    });
    const pr = await client.getPullRequest("legacy-job-1");
    expect(pr?.pr_number).toBe(10);
    expect(capturedRequests[0].url).toBe("http://localhost:8000/jobs/legacy-job-1/pr");
  });
});

