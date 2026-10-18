"""SQLite persistence for jobs and artifact REFERENCES (never the binary files themselves)."""
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

from job_schemas import ArtifactDraft, JobStatus, check_transition

# Columns added after the first version of the table. Existing databases are
# upgraded in place, so jobs created earlier stay retrievable.
_ADDED_JOB_COLUMNS = {
    "source": "TEXT NOT NULL DEFAULT 'manual'",
    "repository": "TEXT",
    "commit_sha": "TEXT",
    "created_at": "TEXT",
    "updated_at": "TEXT",
    "inspection": "TEXT",  # JSON summary of the inspection result
    "error": "TEXT",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class JobNotFoundError(LookupError):
    pass


class JobStore:
    def __init__(self, db_path) -> None:
        self.db_path = Path(db_path)
        self.init_db()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        # Always close the connection: an open handle keeps the file locked on Windows.
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    # ------------------------------------------------------------------ setup
    def init_db(self) -> None:
        with self._connect() as db:
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    website_url TEXT NOT NULL,
                    status TEXT NOT NULL
                )
                """
            )
            existing = {row["name"] for row in db.execute("PRAGMA table_info(jobs)")}
            for name, ddl in _ADDED_JOB_COLUMNS.items():
                if name not in existing:
                    db.execute(f"ALTER TABLE jobs ADD COLUMN {name} {ddl}")
            now = utc_now()
            db.execute("UPDATE jobs SET created_at = ? WHERE created_at IS NULL", (now,))
            db.execute("UPDATE jobs SET updated_at = ? WHERE updated_at IS NULL", (now,))
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS artifacts (
                    artifact_id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL REFERENCES jobs(job_id),
                    kind TEXT NOT NULL,
                    uri TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    mock INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                )
                """
            )
            db.execute("CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id)")

    # ----------------------------------------------------------------- writes
    def create_job(
        self,
        website_url: str,
        source: str = "manual",
        repository: Optional[str] = None,
        commit_sha: Optional[str] = None,
    ) -> Dict:
        job_id = f"job-{uuid.uuid4()}"
        now = utc_now()
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO jobs (job_id, website_url, status, source, repository,
                                  commit_sha, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (job_id, website_url, JobStatus.QUEUED.value, source, repository, commit_sha, now, now),
            )
        return self.get_job(job_id)  # type: ignore[return-value]

    def update_status(
        self,
        job_id: str,
        new_status: JobStatus,
        *,
        error: Optional[str] = None,
        inspection: Optional[Dict] = None,
    ) -> Dict:
        with self._connect() as db:
            row = db.execute("SELECT status FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
            if row is None:
                raise JobNotFoundError(job_id)
            check_transition(JobStatus(row["status"]), new_status)
            db.execute(
                """
                UPDATE jobs
                SET status = ?, updated_at = ?,
                    error = COALESCE(?, error),
                    inspection = COALESCE(?, inspection)
                WHERE job_id = ?
                """,
                (
                    new_status.value,
                    utc_now(),
                    error,
                    json.dumps(inspection) if inspection is not None else None,
                    job_id,
                ),
            )
        return self.get_job(job_id)  # type: ignore[return-value]

    def add_artifacts(self, job_id: str, drafts: List[ArtifactDraft]) -> None:
        with self._connect() as db:
            for draft in drafts:
                db.execute(
                    """
                    INSERT INTO artifacts (artifact_id, job_id, kind, uri, description, mock, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"art-{uuid.uuid4().hex[:12]}",
                        job_id,
                        draft.kind,
                        draft.uri,
                        draft.description,
                        int(draft.mock),
                        utc_now(),
                    ),
                )

    # ------------------------------------------------------------------ reads
    def _artifacts_for(self, db: sqlite3.Connection, job_id: str) -> List[Dict]:
        rows = db.execute(
            "SELECT * FROM artifacts WHERE job_id = ? ORDER BY created_at, artifact_id", (job_id,)
        ).fetchall()
        return [
            {
                "artifact_id": r["artifact_id"],
                "kind": r["kind"],
                "uri": r["uri"],
                "description": r["description"],
                "mock": bool(r["mock"]),
                "created_at": r["created_at"],
            }
            for r in rows
        ]

    def _to_job(self, db: sqlite3.Connection, row: sqlite3.Row) -> Dict:
        return {
            "job_id": row["job_id"],
            "website_url": row["website_url"],
            "status": row["status"],
            "source": row["source"],
            "repository": row["repository"],
            "commit_sha": row["commit_sha"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "inspection": json.loads(row["inspection"]) if row["inspection"] else None,
            "error": row["error"],
            "artifacts": self._artifacts_for(db, row["job_id"]),
        }

    def get_job(self, job_id: str) -> Optional[Dict]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
            return self._to_job(db, row) if row else None

    def list_jobs(
        self, status: Optional[JobStatus] = None, limit: int = 20, offset: int = 0
    ) -> Tuple[List[Dict], int]:
        where, params = "", []
        if status is not None:
            where, params = "WHERE status = ?", [status.value]
        with self._connect() as db:
            total = db.execute(f"SELECT COUNT(*) AS n FROM jobs {where}", params).fetchone()["n"]
            rows = db.execute(
                f"SELECT * FROM jobs {where} ORDER BY created_at DESC, job_id LIMIT ? OFFSET ?",
                [*params, limit, offset],
            ).fetchall()
            return [self._to_job(db, r) for r in rows], total