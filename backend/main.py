from uuid import uuid4

from fastapi import FastAPI
from pydantic import AnyHttpUrl, BaseModel

app = FastAPI()


# Defines the data required to create an inspection job
class JobCreateRequest(BaseModel):
    website_url: AnyHttpUrl


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/jobs", status_code=201)
def create_job(request: JobCreateRequest):
    job_id = f"job-{uuid4()}"

    return {
        "job_id": job_id,
        "website_url": str(request.website_url),
        "status": "queued"
    }
