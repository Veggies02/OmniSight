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
import threading
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, FastAPI, Header, HTTPException, Query, Response
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
    RejectionRequest,
    ScenarioPullRequestRequest,
    ScenarioResponse,
)
from job_store import JobNotFoundError, JobStore, ScenarioNotFoundError
from proposal_pipeline import PipelineError, ProposalPipeline, proposal_pipeline_from_env
from proposal_digest import DigestError, check_approval, proposal_digest
from scenario_logic import repair_job_id, repair_state_for
from branch_pusher import BranchPushError, BranchPusher
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
# Only screenshots can be downloaded through the API. JSON files such as ground_truth_eval.json never can.
ARTIFACT_IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
MAX_ARTIFACT_BYTES = 15_000_000


def resolve_artifact_file(repo_root: Path, artifacts_root: Path, uri: str) -> Optional[Path]:
    """Map an artifact reference to a real file, or None if it is not a file inside artifacts/.
    Rejects placeholders (mock://), absolute paths, drive letters, and anything that resolves
    (after following symlinks) outside the artifacts folder."""
    if not uri or "://" in uri or "\x00" in uri:
        return None
    text = uri.replace("\\", "/")
    if text.startswith("/") or re.match(r"^[A-Za-z]:", text):
        return None
    try:
        candidate = (repo_root / text).resolve()
        candidate.relative_to(artifacts_root)
    except (ValueError, OSError):
        return None
    return candidate if candidate.is_file() else None


def run_inspection(
    store: JobStore,
    runner: BrowserRunner,
    job_id: str,
    website_url: str,
    pipeline: Optional[ProposalPipeline] = None,
) -> None:
    """Background task. Never raises: any failure is recorded on the job.
    With a `pipeline`, a real capture is followed by diagnosis and proposal generation."""
    try:
        store.update_status(job_id, JobStatus.INSPECTING)
        result = runner.run(job_id, website_url)
        store.add_artifacts(job_id, result.artifacts)
        summary = Inspection(**result.model_dump(exclude={"artifacts"}))
        store.update_status(job_id, JobStatus.ANALYZING, inspection=summary.model_dump())
        logger.info("job %s inspected (mode=%s executed=%s)", job_id, result.mode, result.executed)
        if pipeline is not None and result.executed and result.run_id:
            run_proposal_pipeline(store, pipeline, job_id, result.run_id)
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


def run_proposal_pipeline(store: JobStore, pipeline: ProposalPipeline, job_id: str, run_id: str) -> None:
    """Diagnose the capture, generate one proposal per scenario and store them.
    Never raises. A failed step fails the job and keeps the stage where it stopped."""
    try:
        store.set_stage(job_id, "generating_proposals")
        result = pipeline.run(run_id)
        info = {"run_id": result.run_id, "provider": result.provider, "proposals_path": result.proposals_path}
        store.add_scenarios(job_id, info, result.proposals)
        logger.info("job %s: %d scenario proposal(s) from run %s", job_id, len(result.proposals), run_id)
    except PipelineError as exc:
        logger.error("job %s proposal pipeline failed: %s", job_id, exc)
        _mark_failed(store, job_id, f"Proposal pipeline failed ({exc.code}): {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.exception("job %s proposal pipeline crashed", job_id)
        _mark_failed(store, job_id, f"Proposal pipeline failed: {type(exc).__name__}: {exc}")


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


def _digest_required() -> bool:
    """On unless OMNISIGHT_REQUIRE_APPROVAL_DIGEST is 0, false or no."""
    return os.getenv("OMNISIGHT_REQUIRE_APPROVAL_DIGEST", "1").strip().lower() not in ("0", "false", "no")


def run_scenario_repair(store: JobStore, runner: RepairRunner, job_id: str, scenario_id: str) -> None:
    """Background task: repair ONE approved scenario under the derived id <job_id>--<scenario_id>.
    Never raises. The scenario is already `running` and the job `applying_patch` when this starts.
    Whatever happens, the scenario ends in a final state and the job moves on (a failed repair does not fail the job)."""
    repair_id = repair_job_id(job_id, scenario_id)
    try:
        scenario = store.get_scenario(job_id, scenario_id)
        if scenario is None or scenario["review_status"] != "approved" or not scenario["approval"]:
            raise RepairPreflightError("not_approved", "Scenario has no stored human approval.")
        approval = scenario["approval"]
        if approval.get("digest_verified"):
            # The approval is bound to one exact proposal: refuse if what is stored now is not what was approved.
            if approval.get("patch_digest_sha256") != proposal_digest(scenario["proposal"]):
                raise RepairPreflightError("digest_mismatch", "The stored proposal no longer matches the digest that was approved.")
        elif _digest_required():
            raise RepairPreflightError("digest_missing", "This approval has no verified proposal digest. Approve it again.")
        result = runner.run(repair_id, scenario["proposal"], RepairApproval(**approval))
        store.add_artifacts(job_id, _repair_artifacts(result))
        store.finish_scenario_repair(job_id, scenario_id, repair_state_for(result.outcome), result.model_dump())
        logger.info("job %s scenario %s repair finished: %s", job_id, scenario_id, result.outcome)
    except RepairPreflightError as exc:
        if exc.code == "busy":
            # Nothing ran (another repair held the lock). Put the scenario back so it can be tried again.
            logger.warning("job %s scenario %s: repair runner busy, released", job_id, scenario_id)
            try:
                store.release_scenario_repair(job_id, scenario_id)
            except Exception:  # noqa: BLE001
                logger.exception("job %s scenario %s could not be released", job_id, scenario_id)
            return
        logger.error("job %s scenario %s repair refused: %s", job_id, scenario_id, exc)
        _finish_scenario_error(store, job_id, scenario_id, repair_id, f"Repair refused ({exc.code}): {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.exception("job %s scenario %s failed during repair", job_id, scenario_id)
        _finish_scenario_error(store, job_id, scenario_id, repair_id, f"{type(exc).__name__}: {exc}")


def _finish_scenario_error(store: JobStore, job_id: str, scenario_id: str, repair_id: str, message: str) -> None:
    try:
        error = RepairResult(outcome="error", passed=False, job_id=repair_id, message=message)
        store.finish_scenario_repair(job_id, scenario_id, "error", error.model_dump())
    except Exception:  # noqa: BLE001
        logger.exception("job %s scenario %s could not be marked as errored", job_id, scenario_id)


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
    repo_root: Optional[Path] = None,
    proposal_pipeline: Optional[ProposalPipeline] = None,
    branch_pusher: Optional[BranchPusher] = None,
) -> FastAPI:
    store = JobStore(db_path or os.getenv("OMNISIGHT_DB_PATH") or DEFAULT_DB_PATH)
    browser_runner = runner or runner_from_env()
    repairer = repair_runner or repair_runner_from_env()
    gh_client = github_client or github_client_from_env()
    token = operator_token if operator_token is not None else os.getenv("OMNISIGHT_OPERATOR_TOKEN", "")
    root = Path(repo_root or os.getenv("OMNISIGHT_REPO_ROOT") or Path(__file__).resolve().parent.parent).resolve()
    artifacts_root = (root / "artifacts").resolve()
    # OFF unless OMNISIGHT_AUTO_PROPOSALS=1: then a real capture is followed by diagnosis and proposals.
    pipeline = proposal_pipeline if proposal_pipeline is not None else proposal_pipeline_from_env(root)
    # Pushes the validated repair commit to GitHub (token from the server environment only).
    pusher = branch_pusher if branch_pusher is not None else BranchPusher(repo_root=root)
    pr_lock = threading.Lock()

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
            run_inspection, store, browser_runner, job["job_id"], job["website_url"], pipeline
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
        return job

    @router.get("/jobs/{job_id}/artifacts", response_model=List[ArtifactRef])
    def get_job_artifacts(job_id: str):
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return job["artifacts"]

    @router.get("/jobs/{job_id}/artifacts/{artifact_id}/file")
    def get_artifact_file(job_id: str, artifact_id: str):
        """Serve one screenshot that belongs to this job. The file must be an image inside artifacts/."""
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        artifact = next((a for a in job["artifacts"] if a["artifact_id"] == artifact_id), None)
        if artifact is None:
            raise HTTPException(status_code=404, detail="Artifact not found")
        file_path = resolve_artifact_file(root, artifacts_root, artifact["uri"])
        if file_path is None:
            raise HTTPException(status_code=404, detail="Artifact file is not available")
        media_type = ARTIFACT_IMAGE_TYPES.get(file_path.suffix.lower())
        if media_type is None:
            raise HTTPException(status_code=415, detail="Only image artifacts can be downloaded")
        if file_path.stat().st_size > MAX_ARTIFACT_BYTES:
            raise HTTPException(status_code=413, detail="Artifact file is too large")
        return FileResponse(
            file_path,
            media_type=media_type,
            headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300"},
        )

    # -------------------------------------------------------------- scenarios (v2)
    @router.get("/jobs/{job_id}/scenarios", response_model=List[ScenarioResponse])
    def list_scenarios(job_id: str):
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return job["scenarios"]

    @router.get("/jobs/{job_id}/scenarios/{scenario_id}", response_model=ScenarioResponse)
    def get_scenario(job_id: str, scenario_id: str):
        if store.get_job(job_id) is None:
            raise HTTPException(status_code=404, detail="Job not found")
        scenario = store.get_scenario(job_id, scenario_id)
        if scenario is None:
            raise HTTPException(status_code=404, detail="Scenario not found")
        return scenario

    @router.post("/jobs/{job_id}/scenarios/{scenario_id}/approval", response_model=ScenarioResponse)
    def approve_scenario(
        job_id: str,
        scenario_id: str,
        request: ApprovalRequest,
        x_operator_token: Optional[str] = Header(default=None),
    ):
        require_operator(x_operator_token)
        if not request.reviewed_by.strip():
            raise HTTPException(status_code=422, detail="reviewed_by must not be blank.")
        try:
            scenario = store.get_scenario(job_id, scenario_id)
            if scenario is None:
                raise HTTPException(status_code=404, detail="Scenario not found")
            if scenario["review_status"] == "not_applicable":
                raise HTTPException(
                    status_code=409, detail="This scenario has no supported repair, so it cannot be approved or rejected."
                )
            if scenario["review_status"] != "pending_review":
                raise HTTPException(status_code=409, detail=f"This scenario was already {scenario['review_status']}.")
            run_id = ((store.get_job(job_id) or {}).get("inspection") or {}).get("run_id")
            try:
                binding = check_approval(
                    scenario["proposal"], scenario_id, request.patch_digest_sha256, run_id, required=_digest_required()
                )
            except DigestError as exc:
                logger.warning("job %s scenario %s approval refused: %s", job_id, scenario_id, exc)
                raise HTTPException(status_code=exc.status, detail=str(exc))
            return store.approve_scenario(job_id, scenario_id, request.reviewed_by, binding)
        except JobNotFoundError:
            raise HTTPException(status_code=404, detail="Job not found")
        except ScenarioNotFoundError:
            raise HTTPException(status_code=404, detail="Scenario not found")
        except JobStateError as exc:
            raise HTTPException(status_code=409, detail=str(exc))

    @router.post("/jobs/{job_id}/scenarios/{scenario_id}/rejection", response_model=ScenarioResponse)
    def reject_scenario(
        job_id: str,
        scenario_id: str,
        request: RejectionRequest,
        x_operator_token: Optional[str] = Header(default=None),
    ):
        require_operator(x_operator_token)
        if not request.reviewed_by.strip() or not request.reason.strip():
            raise HTTPException(status_code=422, detail="reviewed_by and reason must not be blank.")
        try:
            return store.reject_scenario(job_id, scenario_id, request.reviewed_by, request.reason)
        except JobNotFoundError:
            raise HTTPException(status_code=404, detail="Job not found")
        except ScenarioNotFoundError:
            raise HTTPException(status_code=404, detail="Scenario not found")
        except JobStateError as exc:
            raise HTTPException(status_code=409, detail=str(exc))

    @router.post("/jobs/{job_id}/scenarios/{scenario_id}/repair", status_code=202, response_model=JobResponse)
    def execute_scenario_repair(
        job_id: str,
        scenario_id: str,
        background_tasks: BackgroundTasks,
        x_operator_token: Optional[str] = Header(default=None),
    ):
        require_operator(x_operator_token)
        if store.get_job(job_id) is None:
            raise HTTPException(status_code=404, detail="Job not found")
        if store.get_scenario(job_id, scenario_id) is None:
            raise HTTPException(status_code=404, detail="Scenario not found")
        if repairer.is_busy():
            raise HTTPException(status_code=409, detail="Another repair is running. Try again when it finishes.")
        try:
            # Moving the scenario to running and the job to applying_patch is the atomic claim.
            claimed = store.claim_scenario_repair(job_id, scenario_id)
        except (JobNotFoundError, ScenarioNotFoundError):
            raise HTTPException(status_code=404, detail="Scenario not found")
        except JobStateError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        background_tasks.add_task(run_scenario_repair, store, repairer, job_id, scenario_id)
        return claimed

    # ------------------------------------------------ scenario pull request (v2)
    def _target_repository() -> str:
        """Decided by the SERVER only: the first entry of OMNISIGHT_GITHUB_REPO (default Veggies02/OmniSight)."""
        return next(
            (r.strip() for r in (os.getenv("OMNISIGHT_GITHUB_REPO") or "Veggies02/OmniSight").split(",") if r.strip()),
            "Veggies02/OmniSight",
        )

    def _push_status(code: str) -> int:
        if code == "no_token":
            return 503
        if code.startswith("push_"):
            return 502
        return 409  # the repair report or the local repository is not in a pushable state

    @router.post("/jobs/{job_id}/scenarios/{scenario_id}/pr", status_code=201, response_model=ScenarioResponse)
    def create_scenario_pull_request(
        job_id: str,
        scenario_id: str,
        response: Response,
        request: Optional[ScenarioPullRequestRequest] = None,
        x_operator_token: Optional[str] = Header(default=None),
    ):
        require_operator(x_operator_token)
        if store.get_job(job_id) is None:
            raise HTTPException(status_code=404, detail="Job not found")
        if store.get_scenario(job_id, scenario_id) is None:
            raise HTTPException(status_code=404, detail="Scenario not found")
        with pr_lock:  # one at a time, so two requests can never push or open the same PR twice
            scenario = store.get_scenario(job_id, scenario_id)
            if scenario is None:
                raise HTTPException(status_code=404, detail="Scenario not found")
            if scenario["pull_request"]:
                response.status_code = 200  # already created: nothing is pushed or opened again
                return scenario
            if scenario["repair_state"] != "passed":
                raise HTTPException(
                    status_code=409,
                    detail=f"Only a scenario whose repair passed can have a pull request (repair_state: {scenario['repair_state']}).",
                )
            repair = scenario["repair"] or {}
            if not repair.get("passed"):
                raise HTTPException(status_code=409, detail="Repair did not pass or has not been successfully executed.")
            if repair.get("visual_passed") is False:
                raise HTTPException(
                    status_code=409, detail="Repair failed visual regression verification; PR creation blocked."
                )
            commit_sha, head_branch = repair.get("commit_sha"), repair.get("branch")
            if not commit_sha or not head_branch:
                raise HTTPException(status_code=409, detail="The repair produced no commit or branch to push.")

            req = request or ScenarioPullRequestRequest()
            base_branch = req.base_branch
            if (
                not re.match(r"^[A-Za-z0-9._/-]{1,200}$", base_branch)
                or ".." in base_branch
                or base_branch.startswith(("/", "-"))
            ):
                raise HTTPException(status_code=422, detail="Invalid base branch name.")

            repository = _target_repository()
            owner, repo_name = repository.split("/", 1)
            try:
                pusher.push(repository, commit_sha, head_branch)
            except BranchPushError as exc:
                logger.error("job %s scenario %s push failed (%s): %s", job_id, scenario_id, exc.code, exc)
                if exc.code != "no_token":
                    store.mark_scenario_pr_failed(job_id, scenario_id)
                raise HTTPException(status_code=_push_status(exc.code), detail=str(exc))

            clean_job_id = job_id.replace("job-", "")
            approval = scenario["approval"] or {}
            title = req.title or f"fix(ui): automated visual repair for {scenario_id} [{clean_job_id[:8]}]"
            body = req.body or "\n".join(
                [
                    "### OmniSight Automated UI Repair Summary",
                    "",
                    f"- **Job ID**: `{job_id}`",
                    f"- **Scenario**: `{scenario_id}`",
                    f"- **Human Reviewer**: {approval.get('reviewed_by', 'operator')} ({approval.get('reviewed_at', '')})",
                    f"- **Repair Outcome**: `{repair.get('outcome', 'passed')}`",
                    f"- **Build Passed**: `{repair.get('build_passed', True)}`",
                    f"- **Test Passed**: `{repair.get('test_passed', True)}`",
                    f"- **Visual Verification**: `{repair.get('visual_passed', True)}`",
                    f"- **Commit**: `{commit_sha}`",
                    "",
                    "> *Safety Notice*: Automated PR created in Draft state. Please inspect visual diffs before merging.",
                ]
            )
            try:
                pr_data = gh_client.create_draft_pull_request(
                    owner=owner,
                    repo=repo_name,
                    title=title,
                    head=head_branch,
                    base=base_branch,
                    body=body,
                    labels=["automated-repair", "omnisight"],
                )
            except GitHubAuthMissingError as exc:
                raise HTTPException(status_code=503, detail=str(exc))
            except Exception as exc:  # noqa: BLE001
                store.mark_scenario_pr_failed(job_id, scenario_id)
                if isinstance(exc, GitHubAuthError):
                    raise HTTPException(status_code=502, detail=f"GitHub authentication failed: {exc}")
                if isinstance(exc, GitHubRateLimitError):
                    raise HTTPException(status_code=429, detail=str(exc))
                if isinstance(exc, GitHubNotFoundError):
                    raise HTTPException(status_code=502, detail=str(exc))
                if isinstance(exc, GitHubAPIError):
                    raise HTTPException(status_code=exc.status_code, detail=str(exc))
                logger.exception("Unexpected error creating pull request: %s", exc)
                raise HTTPException(status_code=502, detail=f"Failed to create pull request: {exc}")

            pr_data = dict(pr_data)
            pr_data["job_id"] = job_id
            pr_data["scenario_id"] = scenario_id
            # the names used in CONTRACT_V2_DRAFT.md, next to the names the GitHub client already returns
            pr_data.setdefault("url", pr_data.get("pr_url"))
            pr_data.setdefault("state", pr_data.get("status"))
            pr_data.setdefault("draft", pr_data.get("is_draft", True))
            return store.record_scenario_pull_request(job_id, scenario_id, pr_data)

    @router.get("/jobs/{job_id}/scenarios/{scenario_id}/pr")
    def get_scenario_pull_request(job_id: str, scenario_id: str):
        if store.get_job(job_id) is None:
            raise HTTPException(status_code=404, detail="Job not found")
        scenario = store.get_scenario(job_id, scenario_id)
        if scenario is None:
            raise HTTPException(status_code=404, detail="Scenario not found")
        if not scenario["pull_request"]:
            raise HTTPException(status_code=404, detail="No pull request has been created for this scenario.")
        return scenario["pull_request"]

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
            return store.record_approval(job_id, request.reviewed_by)
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

        # The target repository is decided by the server, never by the caller or the CI webhook.
        # OMNISIGHT_GITHUB_REPO may list several allowed repos, comma separated; the first is the default.
        allowed_repos = [
            r.strip() for r in (os.getenv("OMNISIGHT_GITHUB_REPO") or "Veggies02/OmniSight").split(",") if r.strip()
        ]
        requested_repo = req.repository or job.get("repository") or allowed_repos[0]
        match = next((r for r in allowed_repos if r.lower() == requested_repo.lower()), None)
        if match is None:
            raise HTTPException(
                status_code=422,
                detail="Target repository is not allowed. Pull requests can only be opened on the server's configured repository.",
            )
        owner, repo_name = match.split("/", 1)

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

        branch_ok = re.compile(r"^[A-Za-z0-9._/-]{1,200}$")
        for label, value in (("head branch", head_branch), ("base branch", base_branch)):
            if not branch_ok.match(value) or ".." in value or value.startswith(("/", "-")):
                raise HTTPException(status_code=422, detail=f"Invalid {label} name.")

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
            run_inspection, store, browser_runner, job["job_id"], job["website_url"], pipeline
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