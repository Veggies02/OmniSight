# OmniSight Cross-Subsystem Integration Handoff Package

**Package Location:** `artifacts/integration-handoff/`  
**Current Branch:** `feature/ajay-defect-injection`  
**Latest Head Commit:** `94dc9bd`  
**Integration Stakeholders:**
* **Ajay** — Repair Execution Engine, Browser Automation & Worktree Isolation
* **Yuvraj** — Multimodal VLM Diagnosis Engine (`ai-engine`)
* **Shilpa** — FastAPI Backend Orchestration & Contract V2 Implementation

---

## 1. Directory Contents & Artifact Inventory

This directory contains verified, factual handoff documents and genuine execution artifacts prepared for seamless cross-subsystem integration:

| File Name | Kind | Purpose |
| :--- | :--- | :--- |
| [`repair-report-passed.json`](./repair-report-passed.json) | Genuine JSON Artifact | Real execution report from a successful repair run (`v2-commit-job-1793648238733`). Demonstrates field names for `finalState: "PASSED"`, dual `commitSha`/`commit_sha`, branch naming, and cleanup status. |
| [`repair-report-unsupported.json`](./repair-report-unsupported.json) | Genuine JSON Artifact | Real execution report from an unsupported patch run (`test-unknown-patch-1793648232669`). Demonstrates `finalState: "UNSUPPORTED"`, `failureReason`, and safe no-op behavior. |
| [`diagnosis-contract-comparison.md`](./diagnosis-contract-comparison.md) | Technical Specification | Side-by-side comparison between TypeScript `DiagnosisResult` and Python `AIFinding` / `AnalysisResponse`. Details field differences, category taxonomy differences, and translation rules. |
| [`registered-patch-mapping.md`](./registered-patch-mapping.md) | Technical Specification | Comprehensive registry specification for all four seeded defect scenarios. Proves patch IDs originate from the deterministic TypeScript registry, not the AI models. |
| [`provider-architecture.md`](./provider-architecture.md) | Architectural Proposal | Division of responsibilities across Python VLM, TypeScript proposal service, repair execution engine, and test harness. Proposed for review and signoff. |
| [`dom-sanitizer-findings.md`](./dom-sanitizer-findings.md) | Security Audit Finding | Audit of the DOM sanitization pipeline. Proves `defect-mobile-nav-overflow` was cleanly stripped from model-facing DOM and explains the intermediate CSS trailing-dot artifact. |
| [`README.md`](./README.md) | Package Manifest | This directory guide and quick-start reference. |

---

## 2. Quick-Start Integration Guide by Stakeholder

### For Shilpa (FastAPI Backend Orchestrator)
1. **Contract Implementation:** Review [`diagnosis-contract-comparison.md`](./diagnosis-contract-comparison.md) and [`registered-patch-mapping.md`](./registered-patch-mapping.md).
2. **Subprocess Trigger:** When handling `POST /jobs/{id}/scenarios/{scenario_id}/repair`, invoke the repair CLI:
   ```bash
   npx ts-node scripts/repair/repair-cli.ts \
     --job-id <id> \
     --scenario-id <scenario_id> \
     --patch-id <approved_patch_id> \
     --mode commit
   ```
3. **Report Parsing:** Read the resulting JSON report at `artifacts/repair-executions/<jobId>/repair_execution_report.json`. Both `commitSha` and `commit_sha` are provided for Python Pydantic compatibility.

### For Yuvraj (Python AI / VLM Engine)
1. **Category Alignment:** Review Section 4 of [`diagnosis-contract-comparison.md`](./diagnosis-contract-comparison.md). Note that `product-image-distortion` and `low-contrast-text` currently map to `"other"` in `AJAY_CATEGORY_MAP`.
2. **DOM Safety:** Review [`dom-sanitizer-findings.md`](./dom-sanitizer-findings.md) to verify that model-facing DOM excerpts have zero test label leakage.

### For Ajay (Frontend & Repair Execution Engine)
1. **CLI & Worktree Management:** Repair execution service is hardened and verified on commit `94dc9bd`.
2. **Deterministic Patching:** All four patches in `scripts/repair/patch-registry.ts` are verified and tested against the live testbed.

---

## 3. Verification Commands

To verify the integrity of the JSON reports and mappings in this package:

```bash
# 1. Validate JSON syntax of both reports
node -e '
  JSON.parse(require("fs").readFileSync("artifacts/integration-handoff/repair-report-passed.json"));
  JSON.parse(require("fs").readFileSync("artifacts/integration-handoff/repair-report-unsupported.json"));
  console.log("JSON reports are valid.");
'

# 2. Check Git working tree status
git status
```

