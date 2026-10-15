
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


class JobCreateRequest(BaseModel):
    website_url: AnyHttpUrl


@app.get("/health")
def health_check():
    return {"status": "ok"}


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


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row

        job = connection.execute(
            "SELECT job_id, website_url, status FROM jobs WHERE job_id = ?",
            (job_id,)
        ).fetchone()

    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Job not found"
        )

    return dict(job)
