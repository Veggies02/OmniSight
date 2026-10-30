"""GitHub REST API integration client for OmniSight server-side PR workflows.

Safety Invariants:
1. Automated Pull Requests MUST ALWAYS be created as Draft PRs (draft=True).
2. GitHub credentials (tokens) are NEVER accepted from or exposed to the browser client;
   they are read strictly from server-side environment variables (GITHUB_TOKEN or OMNISIGHT_GITHUB_TOKEN).
3. Automated repair operations are idempotent; repeated requests for an existing branch/PR
   safely reuse the existing pull request without error or duplicate branch creation.
"""
import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("omnisight.github_client")


class GitHubClientError(Exception):
    """Base exception for all GitHub client operations."""


class GitHubAuthMissingError(GitHubClientError):
    """Raised when GITHUB_TOKEN is not configured on the server."""


class GitHubAuthError(GitHubClientError):
    """Raised on 401 or 403 response from GitHub."""


class GitHubNotFoundError(GitHubClientError):
    """Raised on 404 response (repo or PR not found)."""


class GitHubRateLimitError(GitHubClientError):
    """Raised on 429 response or primary rate limit exhaustion."""


class GitHubAPIError(GitHubClientError):
    """Raised on unexpected 4xx/5xx responses from GitHub."""

    def __init__(self, message: str, status_code: int = 502, details: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.details = details


class GitHubClient:
    def __init__(
        self,
        token: Optional[str] = None,
        base_url: str = "https://api.github.com",
        client: Optional[httpx.Client] = None,
    ) -> None:
        self.token = (
            token
            if token is not None
            else (os.getenv("GITHUB_TOKEN") or os.getenv("OMNISIGHT_GITHUB_TOKEN") or "").strip()
        )
        self.base_url = base_url.rstrip("/")
        self._external_client = client
        self._default_client: Optional[httpx.Client] = None

    @property
    def http_client(self) -> httpx.Client:
        if self._external_client is not None:
            return self._external_client
        if self._default_client is None:
            self._default_client = httpx.Client(timeout=15.0)
        return self._default_client

    def _headers(self) -> Dict[str, str]:
        if not self.token:
            raise GitHubAuthMissingError(
                "GitHub integration is not configured: GITHUB_TOKEN is missing on server."
            )
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _parse_pr_response(
        self, data: Dict[str, Any], owner: str, repo: str, existing: bool = False
    ) -> Dict[str, Any]:
        head_data = data.get("head") or {}
        base_data = data.get("base") or {}
        user_data = data.get("user") or {}

        head_branch = head_data.get("ref", "")
        base_branch = base_data.get("ref", "main")
        head_commit_sha = head_data.get("sha")

        return {
            "pr_number": data.get("number"),
            "pr_url": data.get("html_url"),
            "title": data.get("title", ""),
            "head_branch": head_branch,
            "base_branch": base_branch,
            "head_commit_sha": head_commit_sha,
            "status": "draft" if data.get("draft") else "open",
            "is_draft": bool(data.get("draft", True)),
            "merged": bool(data.get("merged", False)),
            "created_at": data.get("created_at", ""),
            "repository": f"{owner}/{repo}",
            "existing": existing,
            "author": user_data.get("login"),
        }

    def find_existing_pull_request(
        self, owner: str, repo: str, head: str, base: str = "main"
    ) -> Optional[Dict[str, Any]]:
        """Find an existing open pull request for the head branch if one already exists."""
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls"
        # In GitHub API, head parameter can be 'owner:branch' or just 'branch'
        params = {"state": "open", "base": base, "per_page": 30}
        headers = self._headers()
        try:
            resp = self.http_client.get(url, params=params, headers=headers)
        except httpx.RequestError as exc:
            logger.warning("Network error querying existing PRs: %s", exc)
            return None

        if resp.status_code == 200:
            prs = resp.json()
            clean_head = head.split(":")[-1]
            for pr in prs:
                pr_head = pr.get("head", {}).get("ref", "")
                if pr_head == clean_head or pr_head == head:
                    return self._parse_pr_response(pr, owner, repo, existing=True)
        return None

    def create_draft_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        head: str,
        base: str = "main",
        body: str = "",
        labels: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Create a new GitHub Draft Pull Request, ensuring draft=True invariant."""
        headers = self._headers()
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls"

        payload = {
            "title": title,
            "head": head,
            "base": base,
            "body": body,
            "draft": True,  # Safety invariant: automated repair PRs must always be draft!
        }

        try:
            resp = self.http_client.post(url, json=payload, headers=headers)
        except httpx.RequestError as exc:
            raise GitHubAPIError(f"Network error communicating with GitHub: {exc}", status_code=502)

        if resp.status_code == 201:
            pr_data = resp.json()
            return self._parse_pr_response(pr_data, owner, repo, existing=False)

        if resp.status_code in (401, 403):
            raise GitHubAuthError(
                f"GitHub authentication or authorization failed ({resp.status_code}): {resp.text}"
            )

        if resp.status_code == 404:
            raise GitHubNotFoundError(
                f"Repository '{owner}/{repo}' not found or inaccessible on GitHub."
            )

        if resp.status_code == 429:
            raise GitHubRateLimitError("GitHub API rate limit exceeded.")

        if resp.status_code == 422:
            # Check if this error is because a PR already exists for this branch
            existing_pr = self.find_existing_pull_request(owner, repo, head, base)
            if existing_pr is not None:
                logger.info(
                    "Reusing existing open PR #%s for head %s on %s/%s",
                    existing_pr["pr_number"],
                    head,
                    owner,
                    repo,
                )
                return existing_pr

            raise GitHubAPIError(
                f"GitHub API validation error (422): {resp.text}", status_code=422, details=resp.text
            )

        raise GitHubAPIError(
            f"GitHub API error ({resp.status_code}): {resp.text}",
            status_code=502,
            details=resp.text,
        )

    def get_pull_request(self, owner: str, repo: str, pr_number: int) -> Dict[str, Any]:
        """Fetch pull request status and metadata from GitHub API."""
        headers = self._headers()
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}"

        try:
            resp = self.http_client.get(url, headers=headers)
        except httpx.RequestError as exc:
            raise GitHubAPIError(f"Network error communicating with GitHub: {exc}", status_code=502)

        if resp.status_code == 200:
            pr_data = resp.json()
            return self._parse_pr_response(pr_data, owner, repo, existing=False)

        if resp.status_code in (401, 403):
            raise GitHubAuthError(
                f"GitHub authentication or authorization failed ({resp.status_code}): {resp.text}"
            )

        if resp.status_code == 404:
            raise GitHubNotFoundError(
                f"Pull request #{pr_number} in '{owner}/{repo}' not found on GitHub."
            )

        if resp.status_code == 429:
            raise GitHubRateLimitError("GitHub API rate limit exceeded.")

        raise GitHubAPIError(
            f"GitHub API error ({resp.status_code}): {resp.text}",
            status_code=502,
            details=resp.text,
        )


def github_client_from_env() -> GitHubClient:
    return GitHubClient()
