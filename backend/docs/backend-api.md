# OmniSight Backend API

## 1. Health Check
GET /health

Checks whether the backend server is running.

## 2. Create Job
POST /jobs

Creates a new job and returns a unique job ID.
Job details are stored in SQLite.

## 3. Retrieve Job
GET /jobs/{job_id}

Retrieves a previously created job using its ID.
Returns 404 if the job does not exist.

## 4. CI Webhook
POST /webhooks/ci

Receives CI execution results through a webhook
and processes the corresponding job information.