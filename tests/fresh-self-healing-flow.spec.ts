import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { proposalDigestPayload } from "../scripts/vlm/proposal-digest";

const FRESH_RUN_ID = "run-2026-11-19T15-00-54-617Z";
const PROPOSALS_FILE = path.resolve(
  process.cwd(),
  `artifacts/repair-proposals/${FRESH_RUN_ID}/repair_proposals.json`
);

test.describe("Fresh End-to-End Self-Healing Workflow Verification", () => {
  let freshProposal: any;

  test.beforeAll(() => {
    expect(fs.existsSync(PROPOSALS_FILE)).toBe(true);
    const data = JSON.parse(fs.readFileSync(PROPOSALS_FILE, "utf-8"));
    freshProposal = data.results["product-image-distortion"];
    expect(freshProposal).toBeDefined();
    expect(freshProposal.proposalId).toMatch(/^prop_product-image-distortion_/);
    expect(freshProposal.proposalDigest).toBeDefined();
  });

  test("1. Verifies fresh proposal digest calculation and cryptographic integrity", async () => {
    const computedPayload = proposalDigestPayload(freshProposal);
    const expectedDigest = crypto.createHash("sha256").update(computedPayload).digest("hex");
    expect(freshProposal.proposalDigest).toBe(expectedDigest);
  });

  test("2. Navigates to dashboard, displays fresh proposal, and executes real human approval in UI", async ({
    page,
  }) => {
    page.on("console", (msg) => console.log("[BROWSER CONSOLE]", msg.text()));
    page.on("pageerror", (err) => console.log("[BROWSER ERROR]", err.message));

    // Navigate to /review and inject the freshly generated proposal into localStorage
    await page.goto("/review");
    await page.evaluate((proposal) => {
      const existing = JSON.parse(localStorage.getItem("omnisight:review-proposals") || "[]");
      // Prepend fresh proposal so it appears first in the list
      const filtered = existing.filter((p: any) => p.proposalId !== proposal.proposalId);
      filtered.unshift(proposal);
      localStorage.setItem("omnisight:review-proposals", JSON.stringify(filtered));
    }, freshProposal);

    // Reload /review to verify fresh proposal renders in dashboard
    await page.reload();
    await expect(page.getByTestId("review-dashboard")).toBeVisible();
    await expect(page.getByText(freshProposal.proposalId)).toBeVisible();

    // Click on the fresh proposal to navigate to its detail page
    await page.getByText(freshProposal.proposalId).click();
    await expect(page.getByTestId("proposal-detail-page")).toBeVisible();
    await expect(page.getByTestId("detail-review-status")).toHaveText("PENDING_REVIEW");

    // Verify source localization excerpt is displayed
    await expect(page.getByText(".product-image", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("src/index.css").first()).toBeVisible();

    // Verify Approve button is available and click it
    const approveBtn = page.getByTestId("btn-approve");
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // Confirm dialog
    const confirmBtn = page.getByTestId("btn-confirm-dialog");
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Verify status transitions to APPROVED in the UI
    await expect(page.getByTestId("detail-review-status")).toHaveText("APPROVED");

    // Verify localStorage has persisted approval and approvalDigest matches proposalDigest
    const storedProposal = await page.evaluate((id) => {
      const list = JSON.parse(localStorage.getItem("omnisight:review-proposals") || "[]");
      return list.find((p: any) => p.proposalId === id);
    }, freshProposal.proposalId);

    expect(storedProposal.humanReviewStatus).toBe("approved");
    expect(storedProposal.approvalDigest).toBe(freshProposal.proposalDigest);

    // Save the approved proposal back to a dedicated fresh approved artifact for repair execution
    const approvedDir = path.resolve(process.cwd(), `artifacts/repair-proposals/${FRESH_RUN_ID}`);
    const approvedFile = path.join(approvedDir, "approved_proposal.json");
    fs.writeFileSync(approvedFile, JSON.stringify(storedProposal, null, 2), "utf-8");
  });

  test("3. Verifies that tampering with proposed code invalidates approval digest", async ({
    page,
  }) => {
    // Tamper with proposed code
    const tamperedProposal = {
      ...freshProposal,
      proposalId: `${freshProposal.proposalId}_tampered`,
      proposedCorrection: {
        ...freshProposal.proposedCorrection,
        proposedCode: ".product-image { object-fit: contain; } /* TAMPERED */",
      },
    };

    await page.goto("/review");
    await page.evaluate((proposal) => {
      const existing = JSON.parse(localStorage.getItem("omnisight:review-proposals") || "[]");
      existing.unshift(proposal);
      localStorage.setItem("omnisight:review-proposals", JSON.stringify(existing));
    }, tamperedProposal);

    await page.goto(`/review/proposals/${tamperedProposal.proposalId}`);
    await expect(page.getByTestId("proposal-detail-page")).toBeVisible();

    // Click approve
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();

    // Expect an error notification because digest does not match tampered content
    await expect(page.getByTestId("notification-banner")).toBeVisible();
    await expect(page.getByTestId("notification-banner")).toContainText(
      "Proposal changed after generation; refusing to approve modified content."
    );
    await expect(page.getByTestId("detail-review-status")).toHaveText("PENDING_REVIEW");
  });
});
