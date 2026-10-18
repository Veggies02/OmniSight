"""Browser-runner interface and the Week 1 MOCK implementation.

How it connects:  webhook / POST /jobs  ->  job service (api.py)  ->  BrowserRunner.run()
Person 1's real runner is a TypeScript CLI (`npm run capture:evidence`). In Week 2 a
`PlaywrightCliRunner` will implement the same `run()` method by launching it as a
subprocess and turning its manifest into ArtifactDraft items. Nothing else changes.
"""
import os
from typing import List, Optional, Protocol

from pydantic import BaseModel

from job_schemas import ArtifactDraft


class RunnerResult(BaseModel):
    mode: str
    executed: bool
    message: str
    artifacts: List[ArtifactDraft]


class BrowserRunner(Protocol):
    mode: str
    disclaimer: str

    def run(self, job_id: str, website_url: str) -> RunnerResult: ...


class MockBrowserRunner:
    """Returns a clearly labelled placeholder. No browser is launched."""

    mode = "mock"
    disclaimer = (
        "MOCK RESULT ONLY. No real browser was launched; "
        "Playwright integration (Person 1) is pending."
    )

    def run(self, job_id: str, website_url: str) -> RunnerResult:
        return RunnerResult(
            mode=self.mode,
            executed=False,
            message=self.disclaimer,
            artifacts=[
                ArtifactDraft(
                    kind="screenshot",
                    uri=f"mock://artifacts/{job_id}/homepage.png",
                    description="MOCK placeholder. No screenshot was captured.",
                    mock=True,
                )
            ],
        )


def runner_from_env(name: Optional[str] = None) -> BrowserRunner:
    """Pick the runner from OMNISIGHT_RUNNER (default: mock). Fails fast on a bad value."""
    chosen = (name or os.getenv("OMNISIGHT_RUNNER") or "mock").strip().lower()
    if chosen == "mock":
        return MockBrowserRunner()
    raise ValueError(
        f"Unsupported OMNISIGHT_RUNNER '{chosen}'. Only 'mock' is available in Week 1."
    )