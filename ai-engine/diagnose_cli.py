"""Standalone CLI for running AI defect diagnosis on visual evidence.

Usage:
    python diagnose_cli.py --evidence-file evidence.json [--model mock|gemini] [--timeout 60]
    python diagnose_cli.py --run-dir artifacts/visual-evidence/<run_id> [--model mock|gemini]

Exit codes:
    0  Analysis completed successfully (check has_defect and error in the output).
    1  Analysis engine failure (model unreachable, runtime error). Stdout still
       contains a structured JSON response with has_defect=false and an error field.
       The backend must treat this as a job failure, not as a clean page.
    2  Invalid input (missing file, bad JSON, unknown flags).

Environment:
    VLM_PROVIDER          mock (default) or gemini
    VLM_API_KEY           Required when provider is gemini
    VLM_MODEL             Gemini model name (default from .env.example)
    VLM_TIMEOUT_SECONDS   Per-request timeout (default 60)
    VLM_MAX_RETRIES       Retry limit with exponential backoff (default 3)

Output:
    Structured AnalysisResponse JSON on stdout. Diagnostic messages on stderr.
    Raw model response is excluded from CLI output to keep payloads small.
"""
import argparse
import json
import os
import sys
import time
import glob
from pathlib import Path

# Ensure the ai-engine directory is on sys.path so local imports work
# regardless of where the CLI is invoked from.
_SELF_DIR = Path(__file__).resolve().parent
if str(_SELF_DIR) not in sys.path:
    sys.path.insert(0, str(_SELF_DIR))

from defect_analyzer import analyze_evidence
from schemas import AnalysisResponse, EvidenceContext, ViewportConfig
from vlm_client import get_vision_client, VLMError, VLMConfigurationError


# =====================================================================
# Exit codes
# =====================================================================

EXIT_SUCCESS = 0
EXIT_ANALYSIS_FAILURE = 1
EXIT_INVALID_INPUT = 2


# =====================================================================
# Evidence loading helpers
# =====================================================================

def _load_evidence_from_file(path: str) -> EvidenceContext:
    """Load an EvidenceContext from a JSON file.

    The file must contain at least job_id and screenshot_path.
    """
    if not os.path.isfile(path):
        _die(f"Evidence file not found: {path}")

    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as exc:
        _die(f"Evidence file is not valid JSON: {exc}")

    if not isinstance(data, dict):
        _die("Evidence file must contain a JSON object, not an array or scalar.")

    required = ("job_id", "screenshot_path")
    for key in required:
        if key not in data:
            _die(f"Evidence file missing required field: '{key}'")

    # Build viewport from nested object or flat fields
    viewport_data = data.get("viewport")
    if isinstance(viewport_data, dict):
        viewport = ViewportConfig(**viewport_data)
    else:
        viewport = ViewportConfig(
            width=data.get("viewport_width", 1280),
            height=data.get("viewport_height", 720),
            is_mobile=data.get("is_mobile", False),
        )

    return EvidenceContext(
        job_id=data["job_id"],
        screenshot_path=data["screenshot_path"],
        url=data.get("url", ""),
        route=data.get("route"),
        viewport=viewport,
        dom_snippet=data.get("dom_snippet"),
        step_name=data.get("step_name"),
    )


def _find_screenshot(scenario_or_run_dir: str) -> str:
    """Find a defective screenshot inside a scenario directory or run directory.

    Explicitly prioritizes defective screenshots and strictly excludes baseline images.
    """
    # 1. Direct defective screenshot names in the folder
    direct_candidates = [
        os.path.join(scenario_or_run_dir, "defective.png"),
        os.path.join(scenario_or_run_dir, "defective-screenshot.png"),
        os.path.join(scenario_or_run_dir, "defective.jpg"),
        os.path.join(scenario_or_run_dir, "defective.webp"),
    ]
    for cand in direct_candidates:
        if os.path.isfile(cand):
            return cand

    # 2. Check immediate subdirectories for defective images
    sub_patterns = [
        os.path.join(scenario_or_run_dir, "*", "defective.png"),
        os.path.join(scenario_or_run_dir, "*", "defective-screenshot.png"),
    ]
    for pattern in sub_patterns:
        matches = glob.glob(pattern)
        if matches:
            return matches[0]

    # 3. Fallback to any non-baseline image in the directory
    for f in sorted(glob.glob(os.path.join(scenario_or_run_dir, "*.png"))):
        base_name = os.path.basename(f).lower()
        if "baseline" not in base_name and "clean" not in base_name:
            return f

    return ""


def _load_evidence_from_run_dir(run_dir: str) -> list:
    """Build EvidenceContext objects from an evidence run directory.

    Each scenario sub-folder becomes a separate EvidenceContext.
    Falls back to the root directory if there are no sub-folders.
    """
    if not os.path.isdir(run_dir):
        _die(f"Run directory not found: {run_dir}")

    # Derive a job_id from the run directory name
    run_id = os.path.basename(run_dir.rstrip("/\\"))
    job_id = f"job-{run_id}"

    evidences = []

    # Check for scenario sub-folders (each has its own screenshot)
    entries = sorted(os.listdir(run_dir))
    scenario_dirs = [
        e for e in entries
        if os.path.isdir(os.path.join(run_dir, e)) and not e.startswith(".")
    ]

    if scenario_dirs:
        for scenario in scenario_dirs:
            scenario_path = os.path.join(run_dir, scenario)
            screenshot = _find_screenshot(scenario_path)
            if not screenshot:
                _log(f"Warning: no screenshot found in {scenario_path}, skipping.")
                continue

            # Try to read model_facing_evidence.json if it exists
            dom_snippet = None
            evidence_json = os.path.join(scenario_path, "model_facing_evidence.json")
            if os.path.isfile(evidence_json):
                try:
                    with open(evidence_json, encoding="utf-8") as f:
                        ev_data = json.load(f)
                    dom_snippet = ev_data.get("dom_snapshot") or ev_data.get("dom_snippet")
                except (json.JSONDecodeError, OSError):
                    pass

            # Try to read viewport from measurements.json
            viewport = ViewportConfig()
            measurements_json = os.path.join(scenario_path, "measurements.json")
            if os.path.isfile(measurements_json):
                try:
                    with open(measurements_json, encoding="utf-8") as f:
                        mdata = json.load(f)
                    vp = mdata.get("viewport") or {}
                    if isinstance(vp, dict):
                        viewport = ViewportConfig(
                            width=vp.get("width", 1280),
                            height=vp.get("height", 720),
                            is_mobile=vp.get("is_mobile", False),
                        )
                except (json.JSONDecodeError, OSError):
                    pass

            evidences.append(EvidenceContext(
                job_id=job_id,
                screenshot_path=screenshot,
                url="http://localhost:5173",
                route=f"/{scenario}",
                viewport=viewport,
                dom_snippet=dom_snippet,
                step_name=scenario,
            ))
    else:
        # No sub-folders — treat the root as a single scenario
        screenshot = _find_screenshot(run_dir)
        if not screenshot:
            _die(f"No screenshot found in run directory: {run_dir}")

        evidences.append(EvidenceContext(
            job_id=job_id,
            screenshot_path=screenshot,
            url="http://localhost:5173",
            viewport=ViewportConfig(),
        ))

    if not evidences:
        _die(f"No scenarios with screenshots found in: {run_dir}")

    return evidences


# =====================================================================
# Output helpers
# =====================================================================

def _log(msg: str) -> None:
    """Print a diagnostic message to stderr."""
    print(msg, file=sys.stderr)


def _die(msg: str) -> None:
    """Print an error message to stderr and exit with code 2."""
    _log(f"Error: {msg}")
    sys.exit(EXIT_INVALID_INPUT)


def _response_to_dict(response: AnalysisResponse) -> dict:
    """Serialize an AnalysisResponse to a JSON-safe dict.

    Excludes raw_model_response to keep CLI output compact.
    """
    d = response.model_dump(mode="json")
    d.pop("raw_model_response", None)
    return d


def _make_error_response(job_id: str, error_msg: str, provider: str = "mock") -> dict:
    """Build a structured error response dict for analysis failures."""
    return {
        "job_id": job_id,
        "has_defect": False,
        "is_mock": provider == "mock",
        "provider": provider,
        "findings": [],
        "analysis_latency_ms": None,
        "error": error_msg,
    }


# =====================================================================
# Main
# =====================================================================

def run_diagnosis(evidence: EvidenceContext, provider: str, timeout: int) -> tuple:
    """Run diagnosis on a single evidence item.

    Returns (response_dict, exit_code).
    """
    try:
        model = get_vision_client(provider=provider, timeout=timeout)
    except VLMConfigurationError as exc:
        error_msg = f"VLM configuration error: {exc}"
        _log(error_msg)
        return _make_error_response(evidence.job_id, error_msg, provider), EXIT_ANALYSIS_FAILURE

    try:
        start = time.perf_counter()
        response = analyze_evidence(evidence, model)
        elapsed = time.perf_counter() - start
        _log(f"Analysis completed in {elapsed:.1f}s — has_defect={response.has_defect}, "
             f"findings={len(response.findings)}, provider={response.provider}")

        result = _response_to_dict(response)

        # If there's an error field set, this is an analysis failure even with exit 0
        # But we still return exit 0 — the caller checks the error field
        if response.error:
            return result, EXIT_ANALYSIS_FAILURE

        return result, EXIT_SUCCESS

    except (FileNotFoundError, ValueError) as exc:
        error_msg = f"Evidence validation error: {exc}"
        _log(error_msg)
        return _make_error_response(evidence.job_id, error_msg, provider), EXIT_INVALID_INPUT

    except VLMError as exc:
        error_msg = f"VLM provider error: {exc}"
        _log(error_msg)
        return _make_error_response(evidence.job_id, error_msg, provider), EXIT_ANALYSIS_FAILURE

    except Exception as exc:
        error_msg = f"Unexpected error: {type(exc).__name__}: {exc}"
        _log(error_msg)
        return _make_error_response(evidence.job_id, error_msg, provider), EXIT_ANALYSIS_FAILURE


def main() -> int:
    parser = argparse.ArgumentParser(
        description="OmniSight AI Engine — visual defect diagnosis CLI",
        epilog="Exit codes: 0=success, 1=analysis failure, 2=invalid input",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--evidence-file",
        help="Path to a JSON file containing the evidence context",
    )
    group.add_argument(
        "--run-dir",
        help="Path to a visual-evidence run directory (e.g. artifacts/visual-evidence/<run_id>)",
    )
    parser.add_argument(
        "--model",
        choices=["mock", "gemini"],
        default=None,
        help="VLM provider to use (default: from VLM_PROVIDER env var, or mock)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="Per-request timeout in seconds (default: 60)",
    )

    args = parser.parse_args()
    provider = args.model or os.getenv("VLM_PROVIDER", "mock")

    if args.evidence_file:
        # Single evidence file mode
        evidence = _load_evidence_from_file(args.evidence_file)
        result, code = run_diagnosis(evidence, provider, args.timeout)
        print(json.dumps(result, indent=2, default=str))
        return code

    else:
        # Run directory mode — analyze each scenario
        evidences = _load_evidence_from_run_dir(args.run_dir)
        _log(f"Found {len(evidences)} scenario(s) in {args.run_dir}")

        all_results = {}
        worst_code = EXIT_SUCCESS

        for ev in evidences:
            scenario_name = ev.step_name or "default"
            _log(f"--- Diagnosing scenario: {scenario_name} ---")
            result, code = run_diagnosis(ev, provider, args.timeout)
            all_results[scenario_name] = result
            if code > worst_code:
                worst_code = code

        # Output: keyed by scenario ID
        output = {
            "run_id": os.path.basename(args.run_dir.rstrip("/\\")),
            "provider": provider,
            "total_scenarios": len(evidences),
            "scenarios": all_results,
        }
        print(json.dumps(output, indent=2, default=str))
        return worst_code


if __name__ == "__main__":
    sys.exit(main())
