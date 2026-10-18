"""FastAPI application factory for the OmniSight backend.

Flow:  POST /webhooks/ci  or  POST /jobs
         -> job is saved in SQLite with status "queued"
         -> a background task asks the BrowserRunner to inspect the site
              queued -> inspecting -> analyzing   (or -> failed with an error message)
         -> GET /jobs/{job_id} shows status, the inspection summary and artifact references

Week 1 uses the MOCK runner, so every result is labelled as mock.
"""
import logging
import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from browser_runner import BrowserRunner, runner_from_env
from job_schemas import (
    ArtifactRef,
    BrowserResultNote,
    CIWebhookRequest,
    CIWebhookResponse,
    Inspection,
    JobCreateRequest,
    JobListResponse,
    JobResponse,
    JobStatus,
)
from job_store import JobStore

logger = logging.getLogger("omnisight.backend")

DEFAULT_DB_PATH = Path(__file__).with_name("jobs.db")
SUPPORTED_CI_EVENTS = {"build_success"}


def run_inspection(store: JobStore, runner: BrowserRunner, job_id: str, website_url: str) -> None:
    """Background task. Never raises: any failure is recorded on the job."""
    try:
        store.update_status(job_id, JobStatus.INSPECTING)
        result = runner.run(job_id, website_url)
        store.add_artifacts(job_id, result.artifacts)
        summary = Inspection(mode=result.mode, executed=result.executed, message=result.message)
        store.update_status(job_id, JobStatus.ANALYZING, inspection=summary.model_dump())
        logger.info("job %s inspected (mode=%s executed=%s)", job_id, result.mode, result.executed)
    except Exception as exc:  # noqa: BLE001 - we want to record every failure on the job
        logger.exception("job %s failed during inspection", job_id)
        try:
            store.update_status(job_id, JobStatus.FAILED, error=f"{type(exc).__name__}: {exc}")
        except Exception:  # noqa: BLE001
            logger.exception("job %s could not be marked failed", job_id)


def create_app(db_path: Optional[Path] = None, runner: Optional[BrowserRunner] = None) -> FastAPI:
    store = JobStore(db_path or os.getenv("OMNISIGHT_DB_PATH") or DEFAULT_DB_PATH)
    browser_runner = runner or runner_from_env()

    app = FastAPI(
        title="OmniSight Backend",
        version="0.1.0",
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
        return job

    @router.get("/jobs/{job_id}/artifacts", response_model=List[ArtifactRef])
    def get_job_artifacts(job_id: str):
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return job["artifacts"]

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