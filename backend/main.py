
from uuid import uuid4
import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import AnyHttpUrl, BaseModel

app = FastAPI()

# Keep the database beside this Python file
DB_PATH = Path(__file__).with_name("jobs.db")


def init_db():
    with sqlite3.connect(DB_PATH) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                website_url TEXT NOT NULL,
                status TEXT NOT NULL
            )
        """)


# Create the table if it doesn't already exist
init_db()


# Request model for manually creating an inspection job
class JobCreateRequest(BaseModel):
    website_url: AnyHttpUrl


# Request model for a simulated CI webhook event
class CIWebhookRequest(BaseModel):
    event_type: str
    website_url: AnyHttpUrl
    repository: str
    commit_sha: str


@app.get("/health")
def health_check():
    return {"status": "ok"}


# Task 2: Create an inspection job manually
@app.post("/jobs", status_code=201)
def create_job(request: JobCreateRequest):
    job_id = f"job-{uuid4()}"
    website_url = str(request.website_url)
    status = "queued"

    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """
            INSERT INTO jobs (job_id, website_url, status)
            VALUES (?, ?, ?)
            """,
            (job_id, website_url, status)
        )

    return {
        "job_id": job_id,
        "website_url": website_url,
        "status": status
    }


# Task 3: Retrieve a job by its ID
@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row

        job = connection.execute(
            """
            SELECT job_id, website_url, status
            FROM jobs
            WHERE job_id = ?
            """,
            (job_id,)
        ).fetchone()

    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Job not found"
        )

    return dict(job)


# Task 4: Receive a simulated CI event and queue an inspection job
@app.post("/webhooks/ci", status_code=201)
def ci_webhook(request: CIWebhookRequest):
    # Accept only successful build events
    if request.event_type != "build_success":
        raise HTTPException(
            status_code=400,
            detail="Unsupported CI event type"
        )

    job_id = f"job-{uuid4()}"
    website_url = str(request.website_url)
    status = "queued"

    # Persist the inspection job in SQLite
    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """
            INSERT INTO jobs (job_id, website_url, status)
            VALUES (?, ?, ?)
            """,
            (job_id, website_url, status)
        )

    return {
        "message": "CI event received; inspection job queued",
        "job_id": job_id,
        "website_url": website_url,
        "repository": request.repository,
        "commit_sha": request.commit_sha,
        "status": status,
        "browser_result": {
            "type": "mock",
            "executed": False,
            "message": (
                "Mock result only. Browser inspection has not run. "
                "Playwright integration is pending."
            )
        }
    }
