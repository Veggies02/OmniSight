# OmniSight Diagnosis-to-Repair Integration Handoff

**Checkout:** `feature/ajay-security-sandbox`

**Scope:** evidence capture, diagnosis, proposal review, repair execution, FastAPI backend, and React dashboard integration.

This document describes contracts found in the current source. It distinguishes repository implementation from components that are mocked, exercised only by local tests, or not connected end to end. The backend reference is also documented in [backend/integration_guide.md](../backend/integration_guide.md).

## 1. Architecture and current flow

The local TypeScript pipeline is composed of:

1. `scripts/capture-visual-evidence.ts` captures baseline and defective screenshots, DOM snapshots, measurements, and manifests beneath `artifacts/visual-evidence/<runId>/`. It also writes model-facing evidence separately from evaluation ground truth. The capture code uses Playwright and the registered scenario definitions.
2. `scripts/run-diagnosis.ts` invokes `DiagnosisService` from `scripts/vlm/diagnosis-service.ts`. The service reads `model_facing_evidence.json`, sanitizes the model-facing text, checks evidence-derived values for leakage, and calls a `VlmProvider`. Leakage checks scan evidence-derived fields individually; the trusted `STANDARD_VLM_PROMPT` is not scanned as untrusted evidence, so its supported category names do not trigger false positives.
3. The service writes attempt-scoped diagnosis artifacts and, only after complete successful diagnosis, publishes `diagnoses-manifest.json` and marks the attempt completed.
4. `scripts/generate-repair-proposals.ts` invokes `RepairProposalService.generateProposalsForRun()`. It validates the current diagnosis manifest and its authoritative attempt record before localization and proposal generation.
5. A human reviews/approves the proposal. `scripts/run-repair-job.ts` validates provenance, current attempt, scenario-to-patch mapping, digest, and approval before invoking `RepairExecutionService` and its isolated worktree workflow.
6. `scripts/evaluate-diagnoses.ts` consumes only a validated, completed diagnosis manifest plus the separate `ground_truth_eval.json` answer key.

The FastAPI backend in `backend/api.py` captures evidence through a `BrowserRunner`, stores job state and artifact references, accepts a proposal, records approval, and launches the repair CLI. Diagnosis and proposal generation are **not automatically invoked by the backend**: the existing guide describes running those commands between inspection and posting a proposal.

## 2. Diagnosis CLI and outcomes

The package scripts in `package.json` are:

```sh
npm run capture:evidence
npm run diagnose:evidence -- --run-id <runId> --provider mock
npm run repair:proposals -- --run-id <runId>
npm run evaluate:diagnoses -- --run-id <runId>
npm run repair:execute -- --proposal <proposal.json> --job-id <jobId>
```

Capture CLI also accepts `--run-id`, `--base-url`, and `--output-dir`. A capture run's `manifest.json` uses `HarnessManifest` from `scripts/evidence-helpers.ts`; its scenario records reference evidence paths relative to the run folder:

```json
{
  "runId": "run-2026-11-08T17-36-08-002Z",
  "timestamp": "2026-11-08T17:36:08.002Z",
  "browser": "chromium",
  "scenariosCaptured": 4,
  "totalScenarios": 4,
  "success": true,
  "artifactsDirectory": ".../artifacts/visual-evidence/<runId>",
  "scenarios": {
    "product-image-distortion": {
      "scenarioId": "product-image-distortion",
      "defectId": "product-image-distortion",
      "route": "/products",
      "viewport": { "width": 1440, "height": 900 },
      "baseline": {
        "screenshotPath": "product-image-distortion/baseline.png",
        "domPath": "product-image-distortion/baseline.html",
        "measurementsPath": "product-image-distortion/baseline-measurements.json",
        "title": "OmniShop",
        "url": "http://127.0.0.1:5173/products",
        "consoleErrors": []
      },
      "defective": { "screenshotPath": "...", "domPath": "...", "measurementsPath": "..." }
    }
  }
}
```

`model_facing_evidence.json` is a separate, neutralized `ModelFacingEvidence`: `runId`, `timestamp`, `browser`, and a `scenarios[]` list with neutral `scenarioId` alias, route, viewport, screenshot/DOM relative paths, page title, and baseline/defective console error arrays. `ground_truth_eval.json` is a separate `GroundTruthRecord` keyed by scenario and contains `expectedCategory`, `expectedSymptom`, target component, and measurement truth. Only the model-facing file is read by `DiagnosisService`.

`run-diagnosis.ts` accepts `--run-id`, `--run-dir` (alias `--input`), `--output`, `--scenario`, `--provider`, and `--model`. A specified run ID is compared with the `runId` in model-facing evidence; a mismatch fails. Without `--run-dir` or `--run-id`, it chooses the latest `run-*` directory under `artifacts/visual-evidence`.

Exit behavior in `run-diagnosis.ts`:

| Exit | Meaning |
|---|---|
| `0` | `diagnoseRun()` returned a complete successful manifest. `diagnosed`, `no_defect_detected`, and `inconclusive` are valid diagnosis outcomes. |
| `1` | Pipeline error, invalid/missing input, lock conflict, provider/analysis failure, or incomplete scenario processing. |

Provider/analysis failures are recorded as `status: "error"` in attempt-scoped evidence and cause `diagnoseRun()` to throw; they are not converted to clean-page results. An inconclusive result remains a valid completed run. The CLI parser currently ignores unknown flags rather than rejecting them; automation should use only the documented flags.

Provider configuration is implemented by `createVlmProvider()` in `scripts/vlm/vlm-provider.ts`. Supported providers are `mock` and `gemini`; defaults are mock provider and `mock-vlm-v1`. Gemini reads `GEMINI_API_KEY`, `OMNISIGHT_VLM_PROVIDER`, `OMNISIGHT_VLM_MODEL`, `OMNISIGHT_VLM_TIMEOUT_MS`, and `OMNISIGHT_VLM_MAX_RETRIES`. It does not include response bodies or request URLs in `VlmProviderError`; persisted errors use bounded error codes.

## 3. Diagnosis manifest and attempt state

The canonical manifest path is:

```text
artifacts/visual-evidence/<runId>/diagnoses/diagnoses-manifest.json
```

Representative completed manifest (scenario contents abbreviated):

```json
{
  "runId": "run-2026-11-08T17-36-08-002Z",
  "attemptId": "attempt-1794242759935-<uuid>",
  "status": "completed",
  "timestamp": "2026-11-09T12:00:00.000Z",
  "provider": "mock",
  "model": "mock-vlm-v1",
  "scenariosDiagnosed": 1,
  "totalScenarios": 1,
  "results": {
    "product-image-distortion": {
      "scenarioId": "product-image-distortion",
      "status": "diagnosed",
      "diagnosis": {
        "schema_version": "1.0",
        "status": "diagnosed",
        "summary": "Visible defect summary.",
        "defects": [],
        "limitations": []
      },
      "model": "mock-vlm-v1",
      "provider": "mock",
      "executionTimeMs": 20,
      "sanitizedEvidenceRef": {
        "baselineScreenshot": "product-image-distortion/baseline.png",
        "defectiveScreenshot": "product-image-distortion/defective.png",
        "viewport": { "width": 1440, "height": 900 }
      }
    }
  },
  "scenarioAliases": [
    { "alias": "scenario_01", "canonicalScenarioId": "product-image-distortion" }
  ],
  "outputArtifactsDirectory": ".../diagnoses"
}
```

`DiagnosisRunManifest` and `DiagnosisResult` are declared in `scripts/vlm/diagnosis-service.ts` and `scripts/vlm/diagnosis-schema.ts`. Per-result statuses include `diagnosed`, `no_defect_detected`, `inconclusive`, and `error`; the completed manifest validator accepts the first three only. The manifest requires one result for every declared scenario, with result keys equal to canonical `result.scenarioId` values.

The authoritative adjacent state file is `diagnosis-attempt.json`:

```json
{
  "runId": "run-2026-11-08T17-36-08-002Z",
  "attemptId": "attempt-1794242759935-<uuid>",
  "status": "completed",
  "manifestPath": "/absolute/path/artifacts/visual-evidence/<runId>/diagnoses/diagnoses-manifest.json",
  "updatedAt": "2026-11-09T12:00:00.000Z"
}
```

State status is `running`, `failed`, or `completed`. A consumer requires completed state and exact equality of run ID, attempt ID, and resolved canonical manifest path. The initial state can temporarily use the requested run ID or `__pending__` before evidence is parsed. A failure records `failed`; an attempt-specific failed manifest may exist under `diagnoses/attempts/<attemptId>/`, but it is not a valid canonical completed result.

`readCurrentDiagnosisManifest()` and `validateDiagnosisManifestShape()` in `scripts/vlm/diagnosis-manifest.ts` are the shared consumer checks used by proposal generation, evaluation, and repair execution. There is no silent legacy-manifest import path: absent attempt provenance is rejected.

## 4. Locking, concurrency, and publication

`acquireDiagnosisLock()` in `scripts/vlm/diagnosis-attempt-lock.ts` resolves the output directory and atomically creates `.diagnosis-lock/`. It stores a random owner token, PID, and hostname in `owner.json`. A live local PID, remote-host owner, unreadable owner, or uncertain process state is not stolen; callers fail with a lock-conflict/manual-recovery error. A dead same-host PID can be reclaimed using an atomic rename to a unique stale-lock path. There is no time-based expiry.

Diagnosis, evaluation, proposal generation, and repair execution use this lock. Diagnosis checks lock ownership before writes/publication and releases in `finally`; an exit handler also attempts token-checked cleanup. A process killed without cleanup leaves a lock that the next process can reclaim only when the owner is confirmed dead locally.

Diagnosis writes the attempt artifact first, copies it to a same-directory temporary path, then renames to the canonical manifest. It writes completed attempt state only after the manifest publication. Proposal generation writes an immutable attempt bundle under `repair-proposals/<runId>/attempts/<attemptId>/` and atomically renames canonical companion files, publishing `repair_proposals.json` last. Same-directory rename avoids exposing partially written JSON during normal operation. These writes do not include explicit filesystem `fsync`; crash durability across power loss/filesystem failure is not guaranteed. Replacement behavior should be confirmed on the deployment filesystem/OS.

If a new attempt fails, an older canonical manifest can remain physically on disk, but current state is now failed/new-attempt and shared validation rejects the old manifest. Consumers must use these validators rather than checking file existence alone.

## 5. Proposal generation and scenario mapping

`RepairProposalService.generateProposalsForRun(manifestPath, outputDirectory?, expectedRunId?)` validates the canonical manifest and attempt state, optionally enforces the requested run ID, and refuses failed/error entries. Proposals are mapped by canonical scenario ID. `scenarioAliases` explicitly records evidence IDs (for example, `scenario_01`) that map to internal scenario IDs (for example, `product-image-distortion`). Aliases must be unique, must not collide with a canonical key, and must target an existing canonical result.

Patch selection is through `scenarioId` and `resolveAuthoritativePatch()` / `findPatchForScenario()` in `scripts/repair/patch-registry.ts`; an AI defect category is not the authoritative patch selector. Duplicate canonical scenario identity is rejected, preventing duplicate proposal generation.

Proposal bundle shape:

```json
{
  "runId": "run-...",
  "attemptId": "attempt-...",
  "status": "completed",
  "results": {
    "product-image-distortion": {
      "schemaVersion": "1.0",
      "proposalId": "prop_product-image-distortion_...",
      "runId": "run-...",
      "attemptId": "attempt-...",
      "diagnosisManifestPath": "artifacts/visual-evidence/run-.../diagnoses/diagnoses-manifest.json",
      "registeredPatchId": "patch-product-image-distortion-001",
      "proposalDigest": "<sha256 hex>",
      "scenarioId": "product-image-distortion",
      "status": "proposed",
      "humanReviewStatus": "pending_review"
    }
  }
}
```

Full proposal fields are described by `RepairProposal` in `scripts/vlm/repair-proposal-schema.ts`: diagnosis reference, category/severity, localization and bounded source excerpt/hash, proposed correction, risks, required tests, confidence, status, and review status. `inconclusive`, `unsupported_category`, localization/security failure statuses are not executable.

## 6. Repair execution, approval, and digest

`run-repair-job.ts` accepts `--proposal`, `--job-id`, `--base-commit`, and `--patch`. It can load a direct proposal object, array, wrapper with `results`, or legacy scenario-keyed map, but executable proposals must have provenance. `validateProposalExecutionProvenance()` requires `runId`, `attemptId`, `diagnosisManifestPath`, `proposalDigest`, a canonical scenario ID, and `status: "proposed"`. It re-reads the current completed diagnosis, matches its run and attempt, and checks `registeredPatchId` against the registry. The diagnosis lock is held throughout validation and execution, so another diagnosis cannot supersede the attempt while the repair is running.

`proposalDigestPayload()` in `scripts/vlm/proposal-digest.ts` canonicalizes a whitelist of immutable proposal fields and computes SHA-256. Approval-only fields are excluded from this payload. Local browser approval in `LocalStorageReviewRepository.approveProposal()` recomputes the hash with Web Crypto; it refuses approval if proposal content changed and stores `approvalDigest`. The CLI requires `approvalDigest === proposalDigest` for proposals marked approved. All execution still requires `humanReviewStatus: "approved"`; the normal flow does not bypass human review.

**Backend approval integration is not yet digest-compatible.** FastAPI `ApprovalRequest` accepts optional `patch_digest_sha256`, signature, nonce, and expiry fields, but the current `job_store.record_approval()` stores supplied metadata without verifying a signature, expiry, nonce, or patch digest. `repair_runner.py` copies the backend approval's reviewer/time into the proposal and sets `humanReviewStatus: "approved"`; it does not populate the TypeScript `approvalDigest` field. `run-repair-job.ts` will therefore reject a digest-bearing proposal if the backend path marks it approved without binding the approval digest. Define and implement one cross-service approval-digest contract before enabling this path. The optional backend `patch_digest_sha256` is not evidence of end-to-end enforcement by itself.

`repair:execute` prints a JSON summary to stdout and detailed progress to stderr. Exit `0` means `finalState === "PASSED"`; rejected, unsupported, failed, and fatal outcomes exit `1`. Reports are written under `artifacts/repair-executions/<jobId>/repair_execution_report.json`. The backend runner also parses the JSON/report rather than trusting exit code alone.

## 7. Secure artifact gateway and evidence integration

`backend/api.py` mounts routes both at `/...` and `/api/...`. The artifact gateway routes are:

```text
GET /artifacts/{category}/{file_path:path}
GET /artifacts/{file_path:path}                 # category prefix or visual-evidence default
```

Allowed categories are `visual-evidence`, `repair-executions`, `verification`, and `screenshots`. Paths are checked for traversal, encoded traversal, null bytes, backslashes, hidden segments, and symlink escape after path resolution. Ground-truth filenames and selected sensitive files are blocked. Only configured safe extensions are served; HTML is served as `text/plain`, with `nosniff`, frame denial, private cache, and inline disposition headers. `repair-executions` requires `X-Operator-Token` when `OMNISIGHT_OPERATOR_TOKEN` is configured. If the token is unset, the current gateway code skips that artifact-specific check; deployment should set the token and review fail-closed behavior before exposing this route.

Evidence routes are `GET /evidence/latest`, `GET /evidence/latest/{scenario_id}`, `GET /jobs/{job_id}/evidence`, `GET /jobs/{job_id}/evidence/{scenario_id}`, plus evidence attached to `GET /jobs/{job_id}`. `ScenarioEvidenceRef` in `backend/job_schemas.py` uses snake_case fields: `scenario_id`, `defect_id`, `route`, `viewport`, `run_id`, `captured_at`, `is_mock`, `baseline_screenshot_url`, `defective_screenshot_url`, `baseline_dom_url`, `defective_dom_url`, `measurements_url`, `manifest_url`, and `measurements`.

`_parse_and_validate_manifest()` validates capture `manifest.json` path references stay inside `artifacts/visual-evidence/<runId>/`; `_build_evidence_contracts()` produces gateway URLs and optional measurement payloads. `tests/test_evidence_integration.py` covers actual workspace manifest parsing, job association, gateway retrieval, traversal rejection, and mock fallback.

**Frontend contract gap:** `ScenarioEvidenceContract` in `src/types/review-types.ts` declares camelCase fields (`scenarioId`, `runId`, `baselineScreenshotUrl`, etc.), while `BackendRepairClient.getScenarioEvidence()` and related methods directly cast FastAPI JSON without snake_case-to-camelCase normalization. `LocalStorageReviewRepository.getProposalById()` then reads camelCase properties. Align the schema or add a mapper and an integration test before relying on live evidence enrichment.

## 8. Backend API and dashboard contracts

The backend contracts live in `backend/job_schemas.py`; the existing route guide is `backend/integration_guide.md`.

| Route | Contract / behavior |
|---|---|
| `GET /health` | `{"status":"ok"}` |
| `POST /jobs` | `{"website_url":"https://..."}` (also accepts `target_url`); creates job and schedules inspection; returns 201. |
| `POST /webhooks/ci` | `event_type`, `website_url`, `repository` (`owner/name`), `commit_sha`; currently only `build_success` is supported. |
| `GET /jobs?status=&limit=&offset=` | `{items,total,limit,offset}`; limit 1–100. |
| `GET /jobs/{job_id}` | Job state, inspection, proposal, approval, repair, artifact references, and resolved evidence map. |
| `GET /jobs/{job_id}/artifacts` | Metadata references only; this is not a file-serving route. |
| `POST /jobs/{job_id}/proposal` | `{"proposal": {...}}`; requires `proposalId`, max serialized payload 200,000 bytes, operator token. Backend forces `pending_review` and removes caller-provided reviewer fields. Job must be `analyzing`. |
| `POST /jobs/{job_id}/approval` | `{"reviewed_by":"..."}` plus optional approval metadata; operator token; approval recorded once with server timestamp. |
| `POST /jobs/{job_id}/repair` | Operator token; requires attached proposal and approval; returns 202 and schedules repair. |
| `POST /jobs/{job_id}/pr` / `GET /jobs/{job_id}/pr` | Draft PR orchestration/read; operator token for creation. |

Operator actions use `X-Operator-Token`; when unset, repair actions return 503. This token is a demo/operator gate, **not user authentication**, and `backend/integration_guide.md` explicitly says not to ship it in a browser bundle. `BackendRepairClient` in `src/services/backendRepairClient.ts` reads `VITE_API_BASE_URL`, but its default `getAuthHeader` is optional. A server-side proxy/token-injection boundary remains necessary for authenticated browser actions.

`JobResponse` includes `job_id`, `website_url`, `status`, `stage`, `source`, timestamps, optional `inspection`, `proposal`, `approval`, `repair`, `pull_request`, `error`, `artifacts`, and evidence. Backend statuses include `queued`, `inspecting`, `analyzing`, `repair_proposed`, `applying_patch`, `validating`, `pr_created`, `needs_review`, `completed`, and `failed`. Actual backend routes do **not** currently expose multi-scenario `/jobs/{id}/scenarios/...` endpoints.

## 9. Dependencies and integration boundaries

### Yuvraj AI engine

No separate `ai-engine/` source or API endpoint was found in this checkout. The currently implemented AI boundary is the local `VlmProvider` interface in `scripts/vlm/vlm-provider.ts`, with mock and Gemini implementations. A compatible external engine must either implement that provider interface or exchange the strict diagnosis result/manifest schema above. The backend guide states that no endpoint currently accepts diagnosis output; the integration remains a manual CLI-to-API handoff. `ground_truth_eval.json` remains evaluator-only and must never be sent to a model.

### Shilpa canonical backend

The main checkout contains a FastAPI implementation and integration tests. Its intended single-job flow is capture → `analyzing` → externally generated proposal attached → approval → repair CLI. Backend capture and repair subprocesses are implemented, but diagnosis/proposal subprocess orchestration is not. Do not treat the protected canonical integration worktree as reviewed or synchronized by this handoff.

The current backend repair runner creates an approved copy from its stored approval record and invokes the TypeScript CLI. The missing approval digest handoff described above blocks a safe digest-enforced end-to-end repair until agreed and implemented.

### Sahil dashboard

The dashboard has a React review UI (`src/pages/review/ProposalDetailPage.tsx`, `src/pages/dashboard/RepairCenterPage.tsx`) and API client (`src/services/backendRepairClient.ts`). `LocalStorageReviewRepository` persists browser proposals/decisions and can use the backend when a proposal has an associated backend job ID. With no job ID, `triggerRepairExecution()` returns a simulated successful preview; it does not run the repair CLI. `MultiScenarioRepository` in `src/services/multiScenarioRepository.ts` is a localStorage implementation and `simulateRepair()` is explicitly simulated.

The API client contains multi-scenario methods (`getJobScenarios`, `approveScenario`, `executeScenarioRepair`, scenario PR methods), and `tests/backend-repair-client.spec.ts` tests requests with mocked `fetch`. The current FastAPI router does not implement those `/scenarios` endpoints, so those client unit tests do not demonstrate backend interoperability. In addition to the missing server routes, the evidence snake_case/camelCase mismatch and token-proxy issue need resolution.

## 10. Tests and verification status

Relevant test files:

- `tests/vlm-diagnosis.spec.ts` — diagnosis schema, leakage sanitization, mock provider, safe provider failures, CLI failure exit, manifest provenance, concurrent worker locking, scenario aliases, and pipeline integration.
- `tests/fixtures/diagnosis-lock-worker.ts` — isolated process used to verify lock exclusion.
- `tests/repair-proposals.spec.ts` — proposal schema, localization, source freshness, attempt-state checks, aliases, unknown mappings, and inconclusive results.
- `tests/run-repair-job.spec.ts` and `tests/repair-execution.spec.ts` — provenance, stale proposal, approval/digest, patch mapping, worktree and execution behavior.
- `tests/evaluation-dataset.spec.ts` — leakage checks and manifest attempt-state rejection.
- `backend/tests/test_secure_artifact_gateway.py` — gateway categories, traversal, symlink escape, ground-truth blocking, MIME/security headers, operator-token checks, and route aliases.
- `backend/tests/test_evidence_integration.py` — evidence manifest parsing, evidence/job association, gateway retrieval, and mock fallback.
- `tests/backend-repair-client.spec.ts` — client route/serialization tests using mocked `fetch` (not a live backend integration test).

Most recent recorded local verification on this branch: the five focused Playwright suites (`vlm-diagnosis`, `repair-proposals`, `run-repair-job`, `repair-execution`, `evaluation-dataset`) passed **125/125**, and `npm run build` (`tsc -b && vite build`) passed. These validate local TypeScript/mock and browser execution paths; they do not establish real Gemini quality or full FastAPI/dashboard interoperability.

The new Python gateway/evidence suites were not run during handoff preparation: this environment has neither `pytest` nor a `pytest` Python module installed. They are present in source but should be run in the backend test environment. No real Gemini request or live dashboard-to-backend authenticated flow was exercised.

## 11. Integration gaps and recommended sequence

1. Agree one approval digest contract across browser, backend approval record, backend runner, and `run-repair-job.ts`; bind the backend approval to the exact `proposalDigest` and preserve it as `approvalDigest` in the execution copy.
2. Add snake_case response normalization (or align the TS evidence types) and test the actual FastAPI response shape through `BackendRepairClient`.
3. Decide whether multi-scenario backend routes will be implemented or the dashboard will use the single-job API; do not connect the mocked client methods as if server routes already exist.
4. Add a server-side proxy or authenticated backend-for-frontend for `X-Operator-Token`; configure artifact-report authorization to fail closed if the token is absent.
5. Integrate the external AI engine at `VlmProvider` or manifest boundary, with explicit ownership of evidence run IDs, attempt IDs, failure statuses, and alias mapping. Ensure backend orchestration does not score or propose from stale attempts.
6. Run backend pytest suites, live FastAPI contract tests, and one end-to-end mocked capture → diagnosis → proposal → approval → repair flow in the agreed integration environment. Real-provider quality evaluation is a separate activity.

Until these contracts are aligned and exercised together, the TypeScript diagnosis/proposal/execution path is locally tested, but the cross-team backend/dashboard/AI-engine pipeline is **not fully integration-ready**.
