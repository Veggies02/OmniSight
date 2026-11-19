"""Pushes ONE validated repair commit to the configured GitHub repository.

Contract v2: `git push <remote> <commit_sha>:refs/heads/<branch>`, never forced, and only for a branch that
starts with `omnisight-repair/`. The repository is chosen by the SERVER (never by a request).

The GitHub token stays on the server:
  * it is passed to git through GIT_CONFIG_* environment variables (an Authorization header limited to
    github.com), never in the command line, never in the remote URL, never written to disk;
  * every message that leaves this module is scrubbed of the token first;
  * credential helpers and terminal prompts are switched off, so git can only use that one token.
"""
import base64
import os
import re
import subprocess
from pathlib import Path
from typing import Callable, Dict, List, Optional

from repair_runner import _kill_process_tree

BRANCH_PREFIX = "omnisight-repair/"
BRANCH_RE = re.compile(r"^omnisight-repair/[A-Za-z0-9][A-Za-z0-9._-]{0,150}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
TOKEN_ENV_NAMES = ("OMNISIGHT_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN")
DEFAULT_PUSH_TIMEOUT_SECONDS = 120


class BranchPushError(Exception):
    """`code` is stable for the API: no_token, invalid_repository, invalid_commit, invalid_branch,
    commit_missing, branch_mismatch, push_timeout, push_rejected, push_auth_failed, push_failed."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def github_token_from_env() -> Optional[str]:
    for name in TOKEN_ENV_NAMES:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return None


def valid_branch(branch: object) -> bool:
    return (
        isinstance(branch, str)
        and bool(BRANCH_RE.match(branch))
        and ".." not in branch
        and not branch.endswith((".lock", "."))
    )


def _default_remote_url(repository: str) -> str:
    return f"https://github.com/{repository}.git"


class BranchPusher:
    def __init__(
        self,
        repo_root: Path,
        token_provider: Callable[[], Optional[str]] = github_token_from_env,
        remote_url: Callable[[str], str] = _default_remote_url,
        timeout_seconds: float = DEFAULT_PUSH_TIMEOUT_SECONDS,
    ) -> None:
        self.repo_root = Path(repo_root).resolve()
        self.token_provider = token_provider
        self.remote_url = remote_url
        self.timeout_seconds = timeout_seconds

    # ------------------------------------------------------------------ git
    def _git(self, args: List[str], env: Dict[str, str], timeout: float):
        kwargs = dict(
            cwd=str(self.repo_root), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
        )
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
        else:
            kwargs["start_new_session"] = True
        process = subprocess.Popen(["git"] + args, **kwargs)  # noqa: S603 - fixed argument list, no shell
        try:
            out, err = process.communicate(timeout=timeout)
            return process.returncode, out, err, False
        except subprocess.TimeoutExpired:
            _kill_process_tree(process)
            out, err = process.communicate()
            return None, out or "", err or "", True

    @staticmethod
    def _scrub(text: str, secrets: List[str]) -> str:
        for secret in secrets:
            if secret:
                text = text.replace(secret, "***")
        lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
        return " | ".join(lines[-4:])[:500]

    # ----------------------------------------------------------------- main
    def push(self, repository: str, commit_sha: str, branch: str) -> None:
        if not isinstance(repository, str) or not REPO_RE.match(repository) or ".." in repository:
            raise BranchPushError("invalid_repository", "The target repository name is not valid.")
        if not isinstance(commit_sha, str) or not SHA_RE.match(commit_sha):
            raise BranchPushError("invalid_commit", "The commit must be a full 40-character lowercase hex SHA.")
        if not valid_branch(branch):
            raise BranchPushError(
                "invalid_branch", f"Only branches named {BRANCH_PREFIX}<name> (letters, digits, . _ -) can be pushed."
            )
        token = self.token_provider()
        if not token:
            raise BranchPushError("no_token", "No GitHub token is configured on the server, so nothing was pushed.")

        plain_env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0")
        # The validated commit must exist locally, and a local branch of that name must agree with it.
        code, _, _, timed_out = self._git(["cat-file", "-e", f"{commit_sha}^{{commit}}"], plain_env, 30)
        if timed_out or code != 0:
            raise BranchPushError("commit_missing", "The validated commit is not in the local repository.")
        code, out, _, _ = self._git(["rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"], plain_env, 30)
        if code == 0 and out.strip() != commit_sha:
            raise BranchPushError("branch_mismatch", "The local branch no longer points at the validated commit.")

        header = "AUTHORIZATION: basic " + base64.b64encode(f"x-access-token:{token}".encode()).decode()
        env = dict(
            plain_env,
            GCM_INTERACTIVE="never",
            GIT_CONFIG_COUNT="2",
            GIT_CONFIG_KEY_0="http.https://github.com/.extraheader",
            GIT_CONFIG_VALUE_0=header,
            GIT_CONFIG_KEY_1="credential.helper",  # an empty helper: no cached credential is ever used
            GIT_CONFIG_VALUE_1="",
        )
        secrets = [token, header, header.split(" ")[-1]]
        # No --force, so a remote branch with different history is rejected. --no-verify: no repo hook runs.
        exit_code, _, err, timed_out = self._git(
            ["push", "--no-verify", self.remote_url(repository), f"{commit_sha}:refs/heads/{branch}"],
            env, self.timeout_seconds,
        )
        if timed_out:
            raise BranchPushError("push_timeout", f"The push took longer than {self.timeout_seconds} seconds and was stopped.")
        if exit_code != 0:
            detail = self._scrub(err, secrets) or "no output"
            lowered = err.lower()
            if "non-fast-forward" in lowered or "rejected" in lowered or "fetch first" in lowered:
                raise BranchPushError("push_rejected", f"GitHub refused the push (the branch already exists with other history): {detail}")
            if "authentication" in lowered or "403" in lowered or "401" in lowered or "denied" in lowered:
                raise BranchPushError("push_auth_failed", f"GitHub did not accept the server's credentials: {detail}")
            raise BranchPushError("push_failed", f"git push failed (exit {exit_code}): {detail}")