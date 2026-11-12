"""Diagnosis step backed by the Python AI engine. Writes the same diagnoses/ files as `npm run diagnose:evidence`.
Usage (as the pipeline calls it): diagnose_wrapper.py --run-id <id> --provider <mock|gemini>
Needs OMNISIGHT_AI_ENGINE_DIR (the folder holding diagnose_cli.py). OMNISIGHT_REPO_ROOT overrides the repo root.
Optional: --attempt-id attempt-<...>  the id from the diagnosis attempt lock. Without it a lock-format id is generated here.
OMNISIGHT_EXPECTED_SCENARIOS (comma list) overrides the four canonical scenario ids.
Exit 0 = every expected scenario diagnosed; diagnoses/ was published in one step (a directory rename), together
         with diagnosis-attempt.json, in the shape scripts/vlm/diagnosis-manifest.ts validates.
Exit 1 = at least one scenario failed; NOTHING is written, so a failure can never look like a clean page.
Exit 2 = bad input or setup (including a missing, extra or aliased scenario)."""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnosis_adapter import adapt_cli_output  # noqa: E402
from scenario_logic import valid_scenario_id  # noqa: E402

ROOT = Path(os.getenv("OMNISIGHT_REPO_ROOT") or Path(__file__).resolve().parent.parent).resolve()
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
CLI_TIMEOUT_SECONDS = 120
ATTEMPT_ID_RE = re.compile(r"^attempt-[A-Za-z0-9-]+$")  # the pattern validateDiagnosisManifestShape enforces
# The four canonical scenarios of the patch registry (scripts/repair/patch-registry.ts, confirmed by Ajay).
CANONICAL_SCENARIOS = (
    "product-image-distortion", "product-card-layout-break", "low-contrast-text", "mobile-nav-overflow",
)


def expected_scenarios() -> set:
    raw = os.getenv("OMNISIGHT_EXPECTED_SCENARIOS", "").strip()
    return {s.strip() for s in raw.split(",") if s.strip()} if raw else set(CANONICAL_SCENARIOS)


def new_attempt_id() -> str:
    """Same format as acquireDiagnosisLock: attempt-<ms>-<uuid>. Used only when no lock id is passed in."""
    return f"attempt-{int(time.time() * 1000)}-{uuid.uuid4()}"


def die(message: str) -> None:
    print(f"diagnose_wrapper: {message}", file=sys.stderr)
    sys.exit(2)


def inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def defective_screenshot(run_dir: Path, scenario_id: str, relative: str) -> Path:
    """The one file the model may see for a scenario: <run>/<scenario>/defective.*, a plain file, never a link,
    never a baseline or clean image. Anything else stops the run."""
    raw = run_dir / relative.replace("\\", "/")
    if raw.is_symlink() or not raw.is_file() or not inside(raw, run_dir):
        die(f"defective screenshot for {scenario_id} is missing or is a link")
    resolved = raw.resolve()
    name = resolved.name.lower()
    if not name.startswith("defective") or "baseline" in name or "clean" in name:
        die(f"screenshot for {scenario_id} is not a defective image: {resolved.name}")
    if resolved.parent.name != scenario_id or resolved.parent.parent != run_dir.resolve():
        die(f"screenshot for {scenario_id} is not inside its own scenario folder")
    return resolved


def error_response(provider: str, message: str) -> dict:
    return {"has_defect": False, "findings": [], "provider": provider, "error": message}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--provider", default="mock", choices=["mock", "gemini"])
    parser.add_argument("--attempt-id", default=None)
    args = parser.parse_args()

    if not RUN_ID_RE.match(args.run_id):
        die("invalid run id")
    if args.attempt_id is not None and not ATTEMPT_ID_RE.match(args.attempt_id):
        die("invalid attempt id")
    attempt_id = args.attempt_id or new_attempt_id()
    engine_dir = os.getenv("OMNISIGHT_AI_ENGINE_DIR", "")
    cli = Path(engine_dir) / "diagnose_cli.py"
    if not engine_dir or not cli.is_file():
        die("OMNISIGHT_AI_ENGINE_DIR must point at the folder containing diagnose_cli.py")
    evidence_root = ROOT / "artifacts" / "visual-evidence"
    run_dir = evidence_root / args.run_id
    if not run_dir.is_dir() or not inside(run_dir, evidence_root):
        die(f"no capture folder for run {args.run_id}")
    try:
        meta = json.loads((run_dir / "model_facing_evidence.json").read_text(encoding="utf-8-sig"))
        scenarios = meta["scenarios"]
    except (OSError, ValueError, KeyError) as exc:
        die(f"model_facing_evidence.json unusable: {exc}")
    if not isinstance(scenarios, list) or not scenarios:
        die("model_facing_evidence.json lists no scenarios")
    seen = set()
    for sc in scenarios:  # one entry per canonical scenario: a repeated id would be an alias counted twice
        sid = sc.get("scenarioId") if isinstance(sc, dict) else None
        if not valid_scenario_id(sid):
            die(f"scenario id {sid!r} is not allowed")
        if sid in seen:
            die(f"scenario {sid} appears more than once")
        seen.add(sid)
    expected = expected_scenarios()
    # Exactly the canonical scenarios: an alias such as scenario_01 is never guessed into one, and a missing one
    # is a failure, not a smaller run.
    if seen - expected:
        die(f"scenario(s) not in the canonical set (aliases are not accepted here): {', '.join(sorted(seen - expected))}")
    if expected - seen:
        die(f"expected scenario(s) missing from the capture: {', '.join(sorted(expected - seen))}")

    responses, viewports = {}, {}
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        for sc in scenarios:
            sid = sc["scenarioId"]
            shot = defective_screenshot(run_dir, sid, str(sc.get("defectiveScreenshot", "")))
            vp = sc.get("viewport") or {}
            width, height = int(vp.get("width", 1280)), int(vp.get("height", 720))
            viewports[sid] = {"width": width, "height": height}
            evidence = {
                "job_id": f"job-{args.run_id}",
                "screenshot_path": str(shot),
                "url": "http://localhost:5173",
                "route": sc.get("route"),
                "viewport": {"width": width, "height": height, "is_mobile": False},
                "step_name": sid,
            }  # no DOM on purpose: nothing unsanitized reaches the model
            evidence_file = Path(tmp) / f"{sid}.json"
            evidence_file.write_text(json.dumps(evidence), encoding="utf-8")
            try:
                proc = subprocess.run(
                    [sys.executable, str(cli), "--evidence-file", str(evidence_file), "--model", args.provider],
                    capture_output=True, text=True, encoding="utf-8", errors="replace",
                    timeout=CLI_TIMEOUT_SECONDS, env=env,
                )
            except subprocess.TimeoutExpired:
                resp = error_response(args.provider, "AI engine call timed out")
            except OSError as exc:
                resp = error_response(args.provider, f"AI engine could not start: {type(exc).__name__}")
            else:
                if proc.returncode != 0:  # exit 1 or 2 is a failure, never a clean page
                    resp = error_response(args.provider, f"AI engine exited with code {proc.returncode}")
                else:
                    try:
                        resp = json.loads(proc.stdout)
                        if not isinstance(resp, dict):
                            raise ValueError("not an object")
                    except ValueError:
                        resp = error_response(args.provider, "AI engine output was not valid JSON")
            if resp.get("error"):  # a non-null error is a failed scenario even when the exit code was 0
                resp = error_response(str(resp.get("provider") or args.provider), str(resp["error"]))
            for finding in resp.get("findings") or []:
                finding["evidence_reference"] = f"{sid}/defective.png"  # no local paths in the output
            responses[sid] = resp

    try:
        out = adapt_cli_output({"run_id": args.run_id, "provider": args.provider, "scenarios": responses}, viewports)
    except ValueError as exc:
        die(str(exc))
    failed = [sid for sid, r in out["results"].items() if r["status"] == "error"]
    if failed:
        print(f"diagnose_wrapper: scenarios failed, nothing published: {', '.join(failed)}", file=sys.stderr)
        return 1
    diag_dir = run_dir / "diagnoses"
    manifest = out["manifest"]
    manifest.update({
        "attemptId": attempt_id,
        "status": "completed",
        "scenarioAliases": [],  # explicit: every id here is canonical, nothing is aliased
        "outputArtifactsDirectory": str(diag_dir),
    })
    # Build everything next to the final folder, then publish with one rename: a reader sees all of it or none of it.
    # Short names on purpose: Windows refuses paths over 260 characters, and attempt ids are long.
    tag = uuid.uuid4().hex[:8]
    staging = run_dir / f".diagnoses-new-{tag}"
    old = run_dir / f".diagnoses-old-{tag}"
    try:
        staging.mkdir()
        for sid, result in out["results"].items():
            (staging / f"{sid}-diagnosis.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        (staging / "diagnoses-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        attempt_state = {
            "runId": args.run_id,
            "attemptId": attempt_id,
            "status": "completed",
            "manifestPath": str(diag_dir / "diagnoses-manifest.json"),
            "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
        (staging / "diagnosis-attempt.json").write_text(json.dumps(attempt_state, indent=2), encoding="utf-8")
        if diag_dir.exists():
            diag_dir.rename(old)
        staging.rename(diag_dir)
    except OSError as exc:
        print(f"diagnose_wrapper: could not publish the diagnoses: {exc}", file=sys.stderr)
        shutil.rmtree(staging, ignore_errors=True)
        if old.exists() and not diag_dir.exists():
            old.rename(diag_dir)  # put back what was there
        return 1
    shutil.rmtree(old, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
