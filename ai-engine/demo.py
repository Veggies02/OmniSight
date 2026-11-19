"""Interactive demo script for OmniSight AI Engine.

Walks through the full pipeline from evidence loading to diagnosis, localization,
patch generation, and validation checklist — printing structured, readable output
at each step.

Usage:
    python demo.py                              # Uses built-in sample data
    python demo.py --screenshot path/to/img.png # Uses a real screenshot
    python demo.py --live                       # Uses Gemini instead of mock
"""
import argparse
import json
import os
import sys
import textwrap
import time
from pathlib import Path

# Ensure ai-engine is on the path
_SELF_DIR = Path(__file__).resolve().parent
if str(_SELF_DIR) not in sys.path:
    sys.path.insert(0, str(_SELF_DIR))

from defect_analyzer import analyze_evidence
from localization import localize_finding
from patch_generator import generate_patch
from schemas import (
    AnalysisResponse,
    EvidenceContext,
    ViewportConfig,
    DefectCategory,
)
from validation_checklist import build_validation_checklist
from vlm_client import get_vision_client


# =====================================================================
# Display helpers
# =====================================================================

def _header(title: str) -> None:
    """Print a section header."""
    width = 70
    print()
    print("=" * width)
    print(f"  {title}")
    print("=" * width)


def _subheader(title: str) -> None:
    """Print a sub-section header."""
    print(f"\n--- {title} ---")


def _kv(key: str, value, indent: int = 2) -> None:
    """Print a key-value pair."""
    prefix = " " * indent
    print(f"{prefix}{key}: {value}")


def _json_block(data, label: str = "") -> None:
    """Print a JSON block."""
    if label:
        print(f"\n  {label}:")
    text = json.dumps(data, indent=4, default=str)
    for line in text.splitlines():
        print(f"    {line}")


def _separator() -> None:
    print("-" * 70)


# =====================================================================
# Sample evidence for demo
# =====================================================================

def _create_sample_screenshot(tmp_dir: str) -> str:
    """Create a tiny valid PNG for the demo."""
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    path = os.path.join(tmp_dir, "demo-screenshot.png")
    with open(path, "wb") as f:
        f.write(png_bytes)
    return path


def _build_sample_evidence(screenshot_path: str) -> EvidenceContext:
    """Build a demo evidence context."""
    return EvidenceContext(
        job_id="demo-job-001",
        screenshot_path=screenshot_path,
        url="http://localhost:5173/products",
        route="/products",
        viewport=ViewportConfig(width=375, height=812, is_mobile=True),
        dom_snippet=textwrap.dedent("""\
            <nav class="navbar defect-mobile-nav-overflow">
              <div class="navbar-container" style="width: 650px; min-width: 650px;">
                <ul class="navbar-nav" style="gap: 2.5rem; min-width: 450px;">
                  <li><a class="nav-link" href="/">Home</a></li>
                  <li><a class="nav-link" href="/products">Products</a></li>
                  <li><a class="nav-link" href="/cart">Cart</a></li>
                </ul>
              </div>
            </nav>
        """),
        step_name="mobile-nav-overflow",
    )


# =====================================================================
# Demo steps
# =====================================================================

def step_1_evidence(evidence: EvidenceContext) -> None:
    """Display the evidence context."""
    _header("Step 1: Evidence Context")
    _kv("Job ID", evidence.job_id)
    _kv("Screenshot", evidence.screenshot_path)
    _kv("URL", evidence.url)
    _kv("Route", evidence.route)
    _kv("Viewport", f"{evidence.viewport.width}x{evidence.viewport.height} "
         f"(mobile={evidence.viewport.is_mobile})")
    _kv("Step name", evidence.step_name)
    if evidence.dom_snippet:
        _subheader("DOM Snippet (first 300 chars)")
        snippet = evidence.dom_snippet[:300]
        for line in snippet.splitlines():
            print(f"    {line}")


def step_2_diagnosis(evidence: EvidenceContext, model) -> AnalysisResponse:
    """Run diagnosis and display findings."""
    _header("Step 2: Visual Defect Diagnosis")

    print(f"  Provider: {model.provider_name}")
    print(f"  Mock: {model.is_mock}")

    start = time.perf_counter()
    response = analyze_evidence(evidence, model)
    elapsed = (time.perf_counter() - start) * 1000

    _subheader("Analysis Result")
    _kv("Has defect", response.has_defect)
    _kv("Provider", response.provider)
    _kv("Is mock", response.is_mock)
    _kv("Latency", f"{elapsed:.0f} ms")
    _kv("Findings count", len(response.findings))
    _kv("Error", response.error or "None")

    if response.findings:
        for i, finding in enumerate(response.findings):
            _subheader(f"Finding {i + 1}")
            _kv("Finding ID", finding.finding_id)
            _kv("Category", finding.defect_category.value)
            _kv("Description", finding.description)
            _kv("Confidence", f"{finding.confidence:.2f}")
            _kv("Requires review", finding.requires_human_review)
            _kv("Selector", finding.target_selector or "—")
            _kv("Component", finding.target_component or "—")
            _kv("Uncertainty", finding.uncertainty_notes or "—")
            _kv("Suggested fix", finding.suggested_next_step or "—")
            if finding.bounding_box:
                bb = finding.bounding_box
                _kv("Bounding box", f"({bb.x:.2f}, {bb.y:.2f}) {bb.width:.2f}x{bb.height:.2f}")
    else:
        print("\n  No defects detected.")

    return response


def step_3_localization(response: AnalysisResponse, repo_root: str | None) -> None:
    """Show source-code localization for each finding."""
    _header("Step 3: Source-Code Localization")

    if not response.findings:
        print("  Skipped — no findings to localize.")
        return

    if not repo_root or not os.path.isdir(repo_root):
        print("  Skipped — no repository root available for localization.")
        print(f"  (Would localize to: {response.findings[0].target_component or 'unknown'})")
        return

    for finding in response.findings:
        _subheader(f"Localizing: {finding.defect_category.value}")
        result = localize_finding(finding, repo_root)
        _kv("File path", result.get("file_path", "—"))
        _kv("Selector", result.get("selector", "—"))
        _kv("Confidence", result.get("confidence", "—"))


def step_4_patch(response: AnalysisResponse, model, repo_root: str | None) -> None:
    """Show patch generation results."""
    _header("Step 4: Repair Patch Generation (Advisory)")

    if not response.findings:
        print("  Skipped — no findings to patch.")
        return

    if not repo_root or not os.path.isdir(repo_root):
        print("  Skipped — no repository root available for patch generation.")
        print("  Note: Patches are advisory only. The deterministic patch")
        print("  registry remains authoritative for actual repairs.")
        return

    for finding in response.findings:
        if finding.defect_category == DefectCategory.NONE:
            continue
        _subheader(f"Patch for: {finding.defect_category.value}")
        try:
            evidence = EvidenceContext(
                job_id=response.job_id,
                screenshot_path=finding.evidence_reference,
                url="http://localhost:5173",
                viewport=ViewportConfig(),
            )
            result = generate_patch(finding, repo_root, model, evidence)
            _kv("Status", result.status)
            if hasattr(result, "proposal") and result.proposal:
                proposal = result.proposal
                _kv("Summary", proposal.summary)
                _kv("Confidence", f"{proposal.confidence:.2f}")
                _kv("Requires review", proposal.requires_human_review)
                for change in proposal.changes:
                    _subheader(f"  Change: {change.file_path}")
                    _kv("Description", change.description, indent=4)
                    print("    Diff:")
                    for line in change.unified_diff.splitlines()[:15]:
                        print(f"      {line}")
            else:
                _kv("Reasons", getattr(result, "reasons", "—"))
        except Exception as exc:
            _kv("Error", f"{type(exc).__name__}: {exc}")

    print("\n  ** All patches are advisory. The deterministic patch registry")
    print("     is authoritative for worktree execution. **")


def step_5_checklist(response: AnalysisResponse) -> None:
    """Show the validation checklist."""
    _header("Step 5: Validation Checklist")

    if not response.findings:
        print("  Skipped — no findings.")
        return

    for finding in response.findings:
        if finding.defect_category == DefectCategory.NONE:
            continue
        _subheader(f"Checklist for: {finding.defect_category.value}")
        try:
            checklist = build_validation_checklist(finding, evidence=None)
            _kv("Expected outcome", checklist.expected_outcome)
            print("  Steps:")
            for j, step in enumerate(checklist.steps, 1):
                print(f"    {j}. {step}")
            if checklist.viewports:
                print("  Viewports:")
                for vp in checklist.viewports:
                    print(f"    - {vp.width}x{vp.height} (mobile={vp.is_mobile})")
            if checklist.selectors_to_check:
                print("  Selectors to verify:")
                for sel in checklist.selectors_to_check:
                    print(f"    - {sel}")
            if checklist.checks:
                print("  Automated checks:")
                for check in checklist.checks:
                    print(f"    - [{check.check_type.value}] {check.description}")
        except Exception as exc:
            _kv("Error", f"{type(exc).__name__}: {exc}")


def step_6_summary(response: AnalysisResponse) -> None:
    """Print a final summary."""
    _header("Summary")
    _kv("Job ID", response.job_id)
    _kv("Defects found", len(response.findings))
    _kv("Provider", f"{response.provider} (mock={response.is_mock})")

    if response.findings:
        print("\n  Findings:")
        for f in response.findings:
            review = " [HUMAN REVIEW REQUIRED]" if f.requires_human_review else ""
            print(f"    - {f.defect_category.value} (confidence: {f.confidence:.0%}){review}")

    print("\n  Pipeline: Evidence -> Diagnosis -> Localization -> Patch -> Checklist")
    print("  All patches are advisory. Human approval is always required.")
    _separator()
    print("  Demo complete.")
    print()


# =====================================================================
# Main
# =====================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="OmniSight AI Engine — interactive demo",
    )
    parser.add_argument(
        "--screenshot",
        help="Path to a real screenshot to analyse",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Use the Gemini provider instead of mock",
    )
    parser.add_argument(
        "--repo-root",
        help="Path to the frontend repository for localization and patch generation",
    )
    args = parser.parse_args()

    provider = "gemini" if args.live else "mock"
    model = get_vision_client(provider=provider)

    print()
    print("  OmniSight AI Engine — Interactive Demo")
    print("  =======================================")
    print(f"  Provider: {model.provider_name} | Mock: {model.is_mock}")
    _separator()

    # Build evidence
    if args.screenshot:
        evidence = _build_sample_evidence(args.screenshot)
    else:
        import tempfile
        tmp = tempfile.mkdtemp(prefix="omnisight-demo-")
        screenshot = _create_sample_screenshot(tmp)
        evidence = _build_sample_evidence(screenshot)

    repo_root = args.repo_root

    # Run the pipeline
    step_1_evidence(evidence)
    response = step_2_diagnosis(evidence, model)
    step_3_localization(response, repo_root)
    step_4_patch(response, model, repo_root)
    step_5_checklist(response)
    step_6_summary(response)


if __name__ == "__main__":
    main()
