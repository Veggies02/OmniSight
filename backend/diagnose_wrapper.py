"""Diagnosis step backed by the Python AI engine. Writes the same diagnoses/ files as `npm run diagnose:evidence`.
Usage (as the pipeline calls it): diagnose_wrapper.py --run-id <id> --provider <mock|gemini>
Needs OMNISIGHT_AI_ENGINE_DIR (the folder holding diagnose_cli.py). OMNISIGHT_REPO_ROOT overrides the repo root.
Exit 0 = every scenario diagnosed and files written.
Exit 1 = at least one scenario failed; NOTHING is written, so a failure can never look like a clean page.
Exit 2 = bad input or setup."""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnosis_adapter import adapt_cli_output  # noqa: E402
from scenario_logic import valid_scenario_id  # noqa: E402

ROOT = Path(os.getenv("OMNISIGHT_REPO_ROOT") or Path(__file__).resolve().parent.parent).resolve()
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
CLI_TIMEOUT_SECONDS = 120


def die(message: str) -> None:
    print(f"diagnose_wrapper: {message}", file=sys.stderr)
    sys.exit(2)


def inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def error_response(provider: str, message: str) -> dict:
    return {"has_defect": False, "findings": [], "provider": provider, "error": message}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--provider", default="mock", choices=["mock", "gemini"])
    args = parser.parse_args()

    if not RUN_ID_RE.match(args.run_id):
        die("invalid run id")
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

    responses, viewports = {}, {}
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        for sc in scenarios:
            sid = sc.get("scenarioId")
            if not valid_scenario_id(sid):
                die(f"scenario id {sid!r} is not allowed")
            shot = (run_dir / str(sc.get("defectiveScreenshot", "")).replace("\\", "/")).resolve()
            if not inside(shot, run_dir) or not shot.is_file():
                die(f"defective screenshot for {sid} is missing")
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
    diag_dir.mkdir(exist_ok=True)
    for sid, result in out["results"].items():
        (diag_dir / f"{sid}-diagnosis.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (diag_dir / "diagnoses-manifest.json").write_text(json.dumps(out["manifest"], indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())