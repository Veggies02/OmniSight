"""FastAPI application factory for the OmniSight backend.

Flow:  POST /webhooks/ci  or  POST /jobs
         -> job is saved in SQLite with status "queued"
         -> a background task asks the BrowserRunner to inspect the site
              queued -> inspecting -> analyzing   (or -> failed with an error message)
         -> a proposal is attached      POST /jobs/{id}/proposal   analyzing -> repair_proposed
         -> a human approves it         POST /jobs/{id}/approval   (records who and when)
         -> the repair is executed      POST /jobs/{id}/repair     repair_proposed -> applying_patch
              -> completed (all checks passed) or failed (reason and report stored on the job)
         -> GET /jobs/{job_id} shows status, stage, inspection, approval, repair and artifacts

The three repair-flow endpoints need the header  X-Operator-Token  to match the environment
variable OMNISIGHT_OPERATOR_TOKEN. If that variable is not set they are DISABLED (503), so a
forgotten setting can never leave repairs open to anyone. This is a stop-gap for demos, not
real user authentication.
"""
import hmac
import json
import logging
import os
import re
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from browser_runner import BrowserRunner, RunnerError, runner_from_env
from job_schemas import (
    ApprovalRequest,
    ArtifactDraft,
    ArtifactRef,
    BrowserResultNote,
    CIWebhookRequest,
    CIWebhookResponse,
    InvalidTransitionError,
    Inspection,
    JobCreateRequest,
    JobListResponse,
    JobResponse,
    JobStateError,
    JobStatus,
    ProposalRequest,
    PullRequestCreateRequest,
    PullRequestResponse,
    ScenarioEvidenceRef,
)
from job_store import JobNotFoundError, JobStore
from github_client import (
    GitHubAPIError,
    GitHubAuthError,
    GitHubAuthMissingError,
    GitHubClient,
    GitHubNotFoundError,
    GitHubRateLimitError,
    github_client_from_env,
)
from repair_runner import (
    RepairApproval,
    RepairPreflightError,
    RepairResult,
    RepairRunner,
    repair_runner_from_env,
)

logger = logging.getLogger("omnisight.backend")

DEFAULT_DB_PATH = Path(__file__).with_name("jobs.db")
SUPPORTED_CI_EVENTS = {"build_success"}
MAX_PROPOSAL_BYTES = 200_000

# Secure artifact gateway controls
ALLOWED_ARTIFACT_CATEGORIES = {
    "visual-evidence",
    "repair-executions",
    "verification",
    "screenshots",
}

SAFE_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".json": "application/json",
    ".log": "text/plain; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".html": "text/plain; charset=utf-8",
    ".htm": "text/plain; charset=utf-8",
}

BLOCKED_FILENAMES = {
    "ground_truth_eval.json",
    "jobs.db",
    "jobs.db-wal",
    "jobs.db-shm",
    ".env",
    ".gitignore",
    "id_ed25519",
    "id_ed25519.pub",
    "authorized_keys",
}


def run_inspection(store: JobStore, runner: BrowserRunner, job_id: str, website_url: str) -> None:
    """Background task. Never raises: any failure is recorded on the job."""
    try:
        store.update_status(job_id, JobStatus.INSPECTING)
        result = runner.run(job_id, website_url)
        store.add_artifacts(job_id, result.artifacts)
        summary = Inspection(**result.model_dump(exclude={"artifacts"}))
        store.update_status(job_id, JobStatus.ANALYZING, inspection=summary.model_dump())
        logger.info("job %s inspected (mode=%s executed=%s)", job_id, result.mode, result.executed)
    except RunnerError as exc:
        # Expected failure (app down, non-zero exit, bad manifest...). Keep the details.
        logger.error("job %s inspection failed: %s", job_id, exc)
        try:
            store.add_artifacts(job_id, exc.artifacts)
            store.update_status(
                job_id,
                JobStatus.FAILED,
                error=str(exc),
                inspection=exc.inspection.model_dump() if exc.inspection else None,
            )
        except Exception:  # noqa: BLE001
            logger.exception("job %s could not be marked failed", job_id)
    except Exception as exc:  # noqa: BLE001 - we want to record every failure on the job
        logger.exception("job %s failed during inspection", job_id)
        try:
            store.update_status(job_id, JobStatus.FAILED, error=f"{type(exc).__name__}: {exc}")
        except Exception:  # noqa: BLE001
            logger.exception("job %s could not be marked failed", job_id)


def _repair_artifacts(result: RepairResult) -> List[ArtifactDraft]:
    drafts = []
    if result.proposal_path:
        drafts.append(ArtifactDraft(kind="other", uri=result.proposal_path, description="Approved proposal given to the repair CLI"))
    if result.report_path:
        drafts.append(ArtifactDraft(kind="other", uri=result.report_path, description="Repair execution report"))
    return drafts


def run_repair(store: JobStore, runner: RepairRunner, job_id: str) -> None:
    """Background task. Never raises: the outcome, or any failure, is recorded on the job.
    The job is already in applying_patch when this starts."""
    try:
        job = store.get_job(job_id)
        if job is None or not job.get("proposal") or not job.get("approval"):
            raise RepairPreflightError("not_approved", "Job has no stored proposal and approval.")
        result = runner.run(job_id, job["proposal"], RepairApproval(**job["approval"]))
        store.add_artifacts(job_id, _repair_artifacts(result))
        if result.passed:
            store.update_status(job_id, JobStatus.COMPLETED, repair=result.model_dump())
        else:
            store.update_status(job_id, JobStatus.FAILED, error=result.message, repair=result.model_dump())
        logger.info("job %s repair finished: %s", job_id, result.outcome)
    except RepairPreflightError as exc:
        logger.error("job %s repair refused: %s", job_id, exc)
        _mark_failed(store, job_id, f"Repair refused ({exc.code}): {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.exception("job %s failed during repair", job_id)
        _mark_failed(store, job_id, f"{type(exc).__name__}: {exc}")


def _mark_failed(store: JobStore, job_id: str, message: str) -> None:
    try:
        store.update_status(job_id, JobStatus.FAILED, error=message)
    except Exception:  # noqa: BLE001
        logger.exception("job %s could not be marked failed", job_id)


def create_app(
    db_path: Optional[Path] = None,
    runner: Optional[BrowserRunner] = None,
    repair_runner: Optional[RepairRunner] = None,
    operator_token: Optional[str] = None,
    github_client: Optional[GitHubClient] = None,
    artifacts_dir: Optional[Path] = None,
) -> FastAPI:
    store = JobStore(db_path or os.getenv("OMNISIGHT_DB_PATH") or DEFAULT_DB_PATH)
    browser_runner = runner or runner_from_env()
    repairer = repair_runner or repair_runner_from_env()
    gh_client = github_client or github_client_from_env()
    token = operator_token if operator_token is not None else os.getenv("OMNISIGHT_OPERATOR_TOKEN", "")

    # Resolve artifacts root directory
    if artifacts_dir:
        resolved_artifacts_dir = Path(artifacts_dir).resolve()
    elif os.getenv("OMNISIGHT_ARTIFACTS_DIR"):
        resolved_artifacts_dir = Path(os.getenv("OMNISIGHT_ARTIFACTS_DIR")).resolve()
    elif os.getenv("OMNISIGHT_REPO_ROOT"):
        resolved_artifacts_dir = (Path(os.getenv("OMNISIGHT_REPO_ROOT")).resolve() / "artifacts").resolve()
    else:
        # Traverse upwards from current file to find the workspace artifacts folder
        cur = Path(__file__).resolve().parent
        candidate_artifacts = None
        for _ in range(6):
            candidate = cur / "artifacts"
            if candidate.is_dir() and candidate != cur:
                if (candidate / "visual-evidence").is_dir() or (cur / "package.json").is_file():
                    candidate_artifacts = candidate.resolve()
                    break
            if cur.parent == cur:
                break
            cur = cur.parent
        resolved_artifacts_dir = candidate_artifacts or (Path(__file__).resolve().parent.parent / "artifacts").resolve()

    app = FastAPI(
        title="OmniSight Backend",
        version="0.2.0",
        description="Job intake, status tracking and orchestration for OmniSight (Person 3).",
    )

    # The React dashboard runs on a different port, so the browser needs CORS headers.
    origins = os.getenv("OMNISIGHT_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in origins.split(",") if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def require_operator(supplied: Optional[str]) -> None:
        if not token:
            raise HTTPException(
                status_code=503,
                detail="Repair actions are disabled: set OMNISIGHT_OPERATOR_TOKEN on the server.",
            )
        if not supplied or not hmac.compare_digest(supplied.encode(), token.encode()):
            raise HTTPException(status_code=401, detail="Missing or wrong X-Operator-Token.")

    router = APIRouter()

    @router.get("/health")
    def health_check():
        return {"status": "ok"}

    @router.post("/jobs", status_code=201, response_model=JobResponse)
    def create_job(request: JobCreateRequest, background_tasks: BackgroundTasks):
        job = store.create_job(str(request.website_url), source="manual")
        background_tasks.add_task(
            run_inspection, store, browser_runner, job["job_id"], job["website_url"]
        )
        return job

    @router.get("/jobs", response_model=JobListResponse)
    def list_jobs(
        status: Optional[JobStatus] = None,
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        items, total = store.list_jobs(status=status, limit=limit, offset=offset)
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    @router.get("/jobs/{job_id}", response_model=JobResponse)
    def get_job(job_id: str):
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        ev_map = _build_job_evidence(job)
        if ev_map:
            job["evidence"] = ev_map
        return job

    @router.get("/jobs/{job_id}/artifacts", response_model=List[ArtifactRef])
    def get_job_artifacts(job_id: str):
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return job["artifacts"]

    # ------------------------------------------------ secure artifact gateway
    def _serve_artifact(category: str, rel_path: str, x_operator_token: Optional[str] = None) -> FileResponse:
        # 1. Validate category format and allowlist
        if not re.match(r"^[a-zA-Z0-9_\-]+$", category):
            raise HTTPException(status_code=403, detail="Invalid artifact category identifier.")
        if category not in ALLOWED_ARTIFACT_CATEGORIES:
            raise HTTPException(
                status_code=403,
                detail=f"Artifact category '{category}' is not accessible via the public gateway.",
            )

        # 2. Operator authorization check for sensitive execution reports
        if category == "repair-executions":
            if token:
                if not x_operator_token or not hmac.compare_digest(x_operator_token.encode(), token.encode()):
                    raise HTTPException(status_code=401, detail="Missing or wrong X-Operator-Token.")

        # 3. Path traversal string checks (raw and decoded)
        raw_check = rel_path.lower()
        if ".." in raw_check or "%2e" in raw_check or "%5c" in raw_check:
            raise HTTPException(status_code=403, detail="Path traversal sequences are forbidden.")
        if "\x00" in rel_path or "%00" in raw_check:
            raise HTTPException(status_code=400, detail="Null bytes are forbidden.")
        if "\\" in rel_path:
            raise HTTPException(status_code=403, detail="Backslash path separators are forbidden.")

        try:
            decoded_path = urllib.parse.unquote(rel_path)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid URL encoding in path.")

        decoded_lower = decoded_path.lower()
        if ".." in decoded_lower or "\x00" in decoded_path or "\\" in decoded_path:
            raise HTTPException(status_code=403, detail="Path traversal sequences are forbidden.")

        # 4. Check individual path segments
        segments = [s for s in decoded_path.strip("/").split("/") if s]
        if not segments:
            raise HTTPException(status_code=404, detail="Artifact path cannot be empty.")

        for seg in segments:
            if seg in {"..", "."}:
                raise HTTPException(status_code=403, detail="Path traversal sequences are forbidden.")
            if seg.startswith("."):
                raise HTTPException(status_code=403, detail="Access to hidden files or directories is forbidden.")

        # 5. Filesystem canonicalization & symlink escape verification
        category_root = (resolved_artifacts_dir / category).resolve()
        if not category_root.exists() or not category_root.is_dir():
            raise HTTPException(status_code=404, detail="Artifact category directory not found.")

        candidate = (category_root / "/".join(segments)).resolve()
        try:
            candidate.relative_to(category_root)
        except ValueError:
            raise HTTPException(status_code=403, detail="Path traversal / symlink escape detected.")

        if candidate.is_dir():
            raise HTTPException(status_code=404, detail="Artifact not found.")

        # 6. Check filename and blocked patterns
        target_name = segments[-1]
        target_name_lower = target_name.lower()
        if "ground_truth" in target_name_lower:
            raise HTTPException(status_code=403, detail="Access to ground truth evaluation data is forbidden.")
        if target_name_lower in BLOCKED_FILENAMES:
            raise HTTPException(status_code=403, detail=f"Access to '{target_name}' is forbidden.")

        # 7. Check extension and MIME type allowlist
        ext = Path(target_name).suffix.lower()
        if not ext or ext not in SAFE_MIME_TYPES:
            raise HTTPException(
                status_code=415,
                detail=f"File extension '{ext}' is not permitted. Allowed: {sorted(SAFE_MIME_TYPES.keys())}",
            )

        if not candidate.exists() or not candidate.is_file():
            raise HTTPException(status_code=404, detail="Artifact not found.")

        # 8. Return secure FileResponse with strict defense-in-depth headers
        # HTML DOM snapshots are served strictly as text/plain to prevent stored XSS attacks
        media_type = SAFE_MIME_TYPES[ext]
        return FileResponse(
            path=str(candidate),
            media_type=media_type,
            headers={
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "Cache-Control": "private, max-age=3600",
                "Content-Disposition": "inline",
            },
        )

    @router.get("/artifacts/{category}/{file_path:path}")
    def get_artifact(
        category: str,
        file_path: str,
        x_operator_token: Optional[str] = Header(default=None),
    ):
        """Secure artifact gateway: serves authorized visual and execution artifacts."""
        return _serve_artifact(category, file_path, x_operator_token)

    @router.get("/artifacts/{file_path:path}")
    def get_artifact_shorthand(
        file_path: str,
        x_operator_token: Optional[str] = Header(default=None),
    ):
        """Shorthand artifact gateway: auto-detects category prefix or defaults to visual-evidence."""
        cleaned = file_path.strip("/")
        parts = cleaned.split("/", 1)
        if len(parts) == 2 and parts[0] in ALLOWED_ARTIFACT_CATEGORIES:
            return _serve_artifact(parts[0], parts[1], x_operator_token)
        return _serve_artifact("visual-evidence", cleaned, x_operator_token)

    # ------------------------------------------------ structured evidence contract
    def _parse_and_validate_manifest(manifest_path: Path) -> Dict[str, Any]:
        """Validates manifest structure and ensures all referenced paths are within visual-evidence."""
        if not manifest_path.is_file():
            raise HTTPException(status_code=404, detail="Evidence manifest not found.")
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Invalid manifest JSON: {exc}")

        if not isinstance(data, dict):
            raise HTTPException(status_code=422, detail="Manifest must be a JSON object.")
        if "runId" not in data or "scenarios" not in data:
            raise HTTPException(status_code=422, detail="Manifest missing required runId or scenarios fields.")

        run_id = str(data["runId"])
        if not re.match(r"^[A-Za-z0-9._\-]+$", run_id) or ".." in run_id:
            raise HTTPException(status_code=403, detail="Invalid runId format in manifest.")

        category_root = (resolved_artifacts_dir / "visual-evidence").resolve()
        run_dir = (category_root / run_id).resolve()
        try:
            run_dir.relative_to(category_root)
        except ValueError:
            raise HTTPException(status_code=403, detail="Manifest run directory escapes visual-evidence boundary.")

        # Validate scenario paths
        for sid, sc in (data.get("scenarios") or {}).items():
            if not re.match(r"^[A-Za-z0-9._\-]+$", sid) or ".." in sid:
                raise HTTPException(status_code=403, detail=f"Invalid scenario ID format: {sid}")
            for side in ("baseline", "defective"):
                part = sc.get(side) or {}
                for k in ("screenshotPath", "domPath", "measurementsPath"):
                    p_val = part.get(k)
                    if p_val:
                        p_str = str(p_val)
                        if ".." in p_str or "\\" in p_str or p_str.startswith("/") or "%2e" in p_str.lower():
                            raise HTTPException(status_code=403, detail=f"Path traversal detected in manifest: {p_str}")
                        target = (run_dir / p_str).resolve()
                        try:
                            target.relative_to(run_dir)
                        except ValueError:
                            raise HTTPException(status_code=403, detail=f"File escapes run directory: {p_str}")

        return data

    def _build_evidence_contracts(manifest_data: Dict[str, Any]) -> Dict[str, ScenarioEvidenceRef]:
        run_id = manifest_data["runId"]
        timestamp = manifest_data.get("timestamp")
        scenarios = manifest_data.get("scenarios") or {}
        contracts: Dict[str, ScenarioEvidenceRef] = {}

        for sid, sc in scenarios.items():
            b_part = sc.get("baseline") or {}
            d_part = sc.get("defective") or {}

            # Construct secure gateway URLs
            b_shot = f"/artifacts/visual-evidence/{run_id}/{b_part['screenshotPath']}" if b_part.get("screenshotPath") else None
            d_shot = f"/artifacts/visual-evidence/{run_id}/{d_part['screenshotPath']}" if d_part.get("screenshotPath") else None
            b_dom = f"/artifacts/visual-evidence/{run_id}/{b_part['domPath']}" if b_part.get("domPath") else None
            d_dom = f"/artifacts/visual-evidence/{run_id}/{d_part['domPath']}" if d_part.get("domPath") else None

            # Load measurements if available
            meas_url = None
            meas_data = None
            if d_part.get("measurementsPath"):
                meas_file = (resolved_artifacts_dir / "visual-evidence" / run_id / d_part["measurementsPath"]).resolve()
                if meas_file.is_file():
                    meas_url = f"/artifacts/visual-evidence/{run_id}/{d_part['measurementsPath']}"
                    try:
                        meas_data = json.loads(meas_file.read_text(encoding="utf-8"))
                    except Exception:
                        pass
            elif (resolved_artifacts_dir / "visual-evidence" / run_id / sid / "measurements.json").is_file():
                meas_file = (resolved_artifacts_dir / "visual-evidence" / run_id / sid / "measurements.json").resolve()
                meas_url = f"/artifacts/visual-evidence/{run_id}/{sid}/measurements.json"
                try:
                    meas_data = json.loads(meas_file.read_text(encoding="utf-8"))
                except Exception:
                    pass

            contracts[sid] = ScenarioEvidenceRef(
                scenario_id=sid,
                defect_id=sc.get("defectId", sid),
                route=sc.get("route"),
                viewport=sc.get("viewport"),
                run_id=run_id,
                captured_at=timestamp,
                is_mock=False,
                baseline_screenshot_url=b_shot,
                defective_screenshot_url=d_shot,
                baseline_dom_url=b_dom,
                defective_dom_url=d_dom,
                measurements_url=meas_url,
                manifest_url=f"/artifacts/visual-evidence/{run_id}/manifest.json",
                measurements=meas_data,
            )
        return contracts

    def _build_job_evidence(job: Dict) -> Dict[str, ScenarioEvidenceRef]:
        """Resolves evidence contracts for a job from its inspection run or stored artifacts."""
        run_id = None
        if job.get("inspection") and job["inspection"].get("run_id"):
            run_id = job["inspection"]["run_id"]
        else:
            for art in job.get("artifacts") or []:
                if art["uri"].endswith("manifest.json") and "visual-evidence" in art["uri"]:
                    m = re.search(r"visual-evidence/([^/]+)/manifest\.json", art["uri"])
                    if m:
                        run_id = m.group(1)
                        break

        if run_id:
            manifest_file = resolved_artifacts_dir / "visual-evidence" / run_id / "manifest.json"
            if manifest_file.is_file():
                data = _parse_and_validate_manifest(manifest_file)
                return _build_evidence_contracts(data)

        # Check for mock artifacts
        has_mock = any(art.get("mock") for art in job.get("artifacts") or [])
        if has_mock:
            return {
                "mock-scenario": ScenarioEvidenceRef(
                    scenario_id="mock-scenario",
                    run_id="mock-run",
                    is_mock=True,
                    baseline_screenshot_url=f"mock://artifacts/{job['job_id']}/homepage.png",
                    defective_screenshot_url=f"mock://artifacts/{job['job_id']}/homepage.png",
                )
            }

        return {}

    @router.get("/jobs/{job_id}/evidence", response_model=List[ScenarioEvidenceRef])
    def get_job_evidence(job_id: str):
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        evidence_map = _build_job_evidence(job)
        return list(evidence_map.values())

    @router.get("/jobs/{job_id}/evidence/{scenario_id}", response_model=ScenarioEvidenceRef)
    def get_job_scenario_evidence(job_id: str, scenario_id: str):
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        evidence_map = _build_job_evidence(job)
        if scenario_id not in evidence_map:
            raise HTTPException(
                status_code=404,
                detail=f"Evidence for scenario '{scenario_id}' not found for job {job_id}.",
            )
        return evidence_map[scenario_id]

    @router.get("/evidence/latest", response_model=List[ScenarioEvidenceRef])
    def get_latest_evidence():
        """Returns evidence contracts from the latest valid visual-evidence run in the workspace."""
        ve_dir = (resolved_artifacts_dir / "visual-evidence").resolve()
        if not ve_dir.is_dir():
            return []
        candidates = sorted(
            [d for d in ve_dir.iterdir() if d.is_dir() and (d / "manifest.json").is_file()],
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            return []
        data = _parse_and_validate_manifest(candidates[0] / "manifest.json")
        return list(_build_evidence_contracts(data).values())

    @router.get("/evidence/latest/{scenario_id}", response_model=ScenarioEvidenceRef)
    def get_latest_scenario_evidence(scenario_id: str):
        """Returns evidence for a specific scenario from the latest visual-evidence run."""
        all_ev = get_latest_evidence()
        for ev in all_ev:
            if ev.scenario_id == scenario_id:
                return ev
        raise HTTPException(status_code=404, detail=f"Latest evidence for scenario '{scenario_id}' not found.")

    # ------------------------------------------------------------ repair flow
    @router.post("/jobs/{job_id}/proposal", response_model=JobResponse)
    def attach_proposal(
        job_id: str, request: ProposalRequest, x_operator_token: Optional[str] = Header(default=None)
    ):
        require_operator(x_operator_token)
        proposal = dict(request.proposal)
        if not isinstance(proposal.get("proposalId"), str) or not proposal["proposalId"]:
            raise HTTPException(status_code=422, detail="Proposal needs a proposalId string.")
        if len(json.dumps(proposal)) > MAX_PROPOSAL_BYTES:
            raise HTTPException(status_code=422, detail="Proposal is too large.")
        # Whatever the proposal claims about review is discarded: approval has one source only.
        proposal["humanReviewStatus"] = "pending_review"
        proposal.pop("reviewedBy", None)
        proposal.pop("reviewedAt", None)
        try:
            return store.update_status(job_id, JobStatus.REPAIR_PROPOSED, proposal=proposal)
        except JobNotFoundError:
            raise HTTPException(status_code=404, detail="Job not found")
        except InvalidTransitionError:
            raise HTTPException(status_code=409, detail="A proposal can only be attached to a job that finished inspection (status analyzing).")

    @router.post("/jobs/{job_id}/approval", response_model=JobResponse)
    def approve_proposal(
        job_id: str, request: ApprovalRequest, x_operator_token: Optional[str] = Header(default=None)
    ):
        require_operator(x_operator_token)
        try:
            extra = request.model_dump(exclude={"reviewed_by"}, exclude_unset=True)
            return store.record_approval(job_id, request.reviewed_by, **extra)
        except JobNotFoundError:
            raise HTTPException(status_code=404, detail="Job not found")
        except JobStateError as exc:
            raise HTTPException(status_code=409, detail=str(exc))

    @router.post("/jobs/{job_id}/repair", status_code=202, response_model=JobResponse)
    def execute_repair(
        job_id: str, background_tasks: BackgroundTasks, x_operator_token: Optional[str] = Header(default=None)
    ):
        require_operator(x_operator_token)
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        if job["status"] != JobStatus.REPAIR_PROPOSED.value or not job["proposal"]:
            raise HTTPException(status_code=409, detail="Only a job with an attached proposal can be repaired.")
        if not job["approval"]:
            raise HTTPException(status_code=409, detail="This proposal has not been approved by a human reviewer.")
        if repairer.is_busy():
            raise HTTPException(status_code=409, detail="Another repair is running. Try again when it finishes.")
        try:
            # Moving to applying_patch is the atomic claim: a second request fails this check.
            claimed = store.update_status(job_id, JobStatus.APPLYING_PATCH)
        except InvalidTransitionError:
            raise HTTPException(status_code=409, detail="This job's repair has already been started.")
        background_tasks.add_task(run_repair, store, repairer, job_id)
        return claimed

    # ----------------------------------------------------------- PR creation
    @router.post("/jobs/{job_id}/pr", status_code=201, response_model=PullRequestResponse)
    def create_pull_request(
        job_id: str,
        request: Optional[PullRequestCreateRequest] = None,
        x_operator_token: Optional[str] = Header(default=None),
    ):
        require_operator(x_operator_token)
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")

        # Idempotency check: if PR is already recorded for this job, return it directly
        if job.get("pull_request"):
            existing_pr = dict(job["pull_request"])
            existing_pr["existing"] = True
            return existing_pr

        # Preflight status eligibility check
        if job["status"] not in (JobStatus.COMPLETED.value, JobStatus.PR_CREATED.value):
            raise HTTPException(
                status_code=409,
                detail=f"Only completed jobs with successful repairs can create pull requests (current status: {job['status']}).",
            )

        if not job.get("approval"):
            raise HTTPException(
                status_code=409,
                detail="Repair proposal has not been approved by a human reviewer.",
            )

        repair = job.get("repair")
        if not repair or not repair.get("passed"):
            raise HTTPException(
                status_code=409,
                detail="Repair did not pass or has not been successfully executed.",
            )

        if repair.get("visual_passed") is False:
            raise HTTPException(
                status_code=409,
                detail="Repair failed visual regression verification; PR creation blocked.",
            )

        req = request or PullRequestCreateRequest()

        target_repo = (
            req.repository
            or job.get("repository")
            or os.getenv("OMNISIGHT_GITHUB_REPO")
            or "Veggies02/OmniSight"
        )
        if "/" not in target_repo:
            raise HTTPException(
                status_code=422,
                detail=f"Target repository '{target_repo}' is invalid; must be in 'owner/repo' format.",
            )
        owner, repo_name = target_repo.split("/", 1)

        base_branch = req.base_branch or "main"
        proposal = job.get("proposal") or {}
        scenario_id = (
            proposal.get("scenarioId")
            or proposal.get("id")
            or "ui-defect"
        )
        clean_job_id = job_id.replace("job-", "")
        default_branch = f"repair/{scenario_id}-{clean_job_id[:8]}"
        head_branch = (
            req.head_branch
            or repair.get("branch")
            or proposal.get("branch")
            or default_branch
        )

        title = req.title or f"fix(ui): automated visual repair for {scenario_id} [{clean_job_id[:8]}]"
        reviewer = job["approval"].get("reviewed_by", "operator")
        reviewed_at = job["approval"].get("reviewed_at", "")
        body_lines = [
            "### OmniSight Automated UI Repair Summary",
            "",
            f"- **Job ID**: `{job_id}`",
            f"- **Scenario**: `{scenario_id}`",
            f"- **Human Reviewer**: {reviewer} ({reviewed_at})",
            f"- **Repair Outcome**: `{repair.get('outcome', 'passed')}` (Exit code {repair.get('exit_code', 0)})",
            f"- **Build Passed**: `{repair.get('build_passed', True)}`",
            f"- **Test Passed**: `{repair.get('test_passed', True)}`",
            f"- **Visual Verification**: `{repair.get('visual_passed', True)}`",
            "",
            "#### Verification Report",
            f"```\n{repair.get('message', 'All post-repair checks passed.')}\n```",
            "",
            "> *Safety Notice*: Automated PR created in Draft state. Please inspect visual diffs before merging.",
        ]
        body = req.body or "\n".join(body_lines)

        try:
            pr_data = gh_client.create_draft_pull_request(
                owner=owner,
                repo=repo_name,
                title=title,
                head=head_branch,
                base=base_branch,
                body=body,
                labels=req.labels,
            )
        except GitHubAuthMissingError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except GitHubAuthError as exc:
            raise HTTPException(status_code=502, detail=f"GitHub authentication failed: {exc}")
        except GitHubRateLimitError as exc:
            raise HTTPException(status_code=429, detail=str(exc))
        except GitHubNotFoundError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        except GitHubAPIError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc))
        except Exception as exc:
            logger.exception("Unexpected error creating pull request: %s", exc)
            raise HTTPException(status_code=502, detail=f"Failed to create pull request: {exc}")

        pr_data["job_id"] = job_id
        store.record_pull_request(job_id, pr_data)
        return pr_data

    @router.get("/jobs/{job_id}/pr", response_model=PullRequestResponse)
    def get_pull_request(job_id: str):
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        if not job.get("pull_request"):
            raise HTTPException(
                status_code=404, detail=f"No pull request has been created for job {job_id}."
            )
        return job["pull_request"]

    # ------------------------------------------------------------------- CI
    @router.post("/webhooks/ci", status_code=201, response_model=CIWebhookResponse)
    def ci_webhook(request: CIWebhookRequest, background_tasks: BackgroundTasks):
        if request.event_type not in SUPPORTED_CI_EVENTS:
            raise HTTPException(status_code=400, detail="Unsupported CI event type")
        job = store.create_job(
            str(request.website_url),
            source="ci_webhook",
            repository=request.repository,
            commit_sha=request.commit_sha,
        )
        background_tasks.add_task(
            run_inspection, store, browser_runner, job["job_id"], job["website_url"]
        )
        return CIWebhookResponse(
            message="CI event received; inspection job queued",
            job_id=job["job_id"],
            website_url=job["website_url"],
            repository=request.repository,
            commit_sha=request.commit_sha,
            status=JobStatus.QUEUED,
            browser_result=BrowserResultNote(
                type=browser_runner.mode, executed=False, message=browser_runner.disclaimer
            ),
        )

    app.include_router(router)
    # The dashboard's contract document uses an /api prefix, so serve both without
    # listing everything twice in Swagger.
    app.include_router(router, prefix="/api", include_in_schema=False)
    return app