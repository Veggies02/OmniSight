"""BranchPusher against a real local git repository and a bare repository that stands in for GitHub."""
import subprocess

import pytest

import branch_pusher
from branch_pusher import BranchPushError, BranchPusher, valid_branch

BRANCH = "omnisight-repair/job-1--low-contrast-text"
TOKEN = "ghp_SECRETTOKEN123456"


def git(cwd, *args):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", *args],
        cwd=cwd, check=True, capture_output=True, text=True,
    ).stdout.strip()


@pytest.fixture()
def world(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    (repo / "a.txt").write_text("one")
    git(repo, "add", "a.txt")
    git(repo, "commit", "-qm", "base")
    base = git(repo, "rev-parse", "HEAD")
    (repo / "a.txt").write_text("two")
    git(repo, "commit", "-qam", "fix")
    fix = git(repo, "rev-parse", "HEAD")
    git(repo, "branch", BRANCH, fix)
    bare = tmp_path / "remote.git"
    git(tmp_path, "init", "-q", "--bare", str(bare))
    pusher = BranchPusher(repo_root=repo, token_provider=lambda: TOKEN, remote_url=lambda r: str(bare))
    return dict(repo=repo, bare=bare, pusher=pusher, base=base, fix=fix)


def remote_refs(bare):
    return git(bare, "for-each-ref", "--format=%(refname) %(objectname)")


def test_pushes_exactly_the_validated_commit(world):
    world["pusher"].push("Veggies02/OmniSight", world["fix"], BRANCH)
    assert remote_refs(world["bare"]) == f"refs/heads/{BRANCH} {world['fix']}"


def test_pushing_again_is_harmless(world):
    world["pusher"].push("Veggies02/OmniSight", world["fix"], BRANCH)
    world["pusher"].push("Veggies02/OmniSight", world["fix"], BRANCH)
    assert remote_refs(world["bare"]) == f"refs/heads/{BRANCH} {world['fix']}"


def test_the_branch_does_not_need_to_still_exist_locally(world):
    git(world["repo"], "branch", "-D", BRANCH)
    world["pusher"].push("Veggies02/OmniSight", world["fix"], BRANCH)
    assert remote_refs(world["bare"]) == f"refs/heads/{BRANCH} {world['fix']}"


def test_no_token_means_nothing_is_pushed(world):
    pusher = BranchPusher(repo_root=world["repo"], token_provider=lambda: None, remote_url=lambda r: str(world["bare"]))
    with pytest.raises(BranchPushError) as exc:
        pusher.push("Veggies02/OmniSight", world["fix"], BRANCH)
    assert exc.value.code == "no_token" and remote_refs(world["bare"]) == ""


@pytest.mark.parametrize(
    "branch",
    ["main", "omnisight-repair/", "omnisight-repair/../x", "feature/omnisight-repair/x", "omnisight-repair/a b",
     "omnisight-repair/x.lock", "omnisight-repair/x.", "-omnisight-repair/x", "omnisight-repair/-x",
     "omnisight-repair/a/b", "omnisight-repair/x;y", "", None, 5],
)
def test_only_omnisight_repair_branches_can_be_pushed(world, branch):
    with pytest.raises(BranchPushError) as exc:
        world["pusher"].push("Veggies02/OmniSight", world["fix"], branch)
    assert exc.value.code == "invalid_branch" and remote_refs(world["bare"]) == ""
    assert valid_branch(branch) is False


@pytest.mark.parametrize("sha", ["HEAD", "abc", "g" * 40, "A" * 40, "", None, "refs/heads/x"])
def test_only_full_lowercase_shas_are_pushed(world, sha):
    with pytest.raises(BranchPushError) as exc:
        world["pusher"].push("Veggies02/OmniSight", sha, BRANCH)
    assert exc.value.code == "invalid_commit" and remote_refs(world["bare"]) == ""


@pytest.mark.parametrize("repository", ["", "a", "a/b/c", "../x", "a/..", "a b/c", None])
def test_bad_repository_names_are_refused(world, repository):
    with pytest.raises(BranchPushError) as exc:
        world["pusher"].push(repository, world["fix"], BRANCH)
    assert exc.value.code == "invalid_repository" and remote_refs(world["bare"]) == ""


def test_a_commit_that_is_not_here_is_refused(world):
    with pytest.raises(BranchPushError) as exc:
        world["pusher"].push("Veggies02/OmniSight", "1" * 40, BRANCH)
    assert exc.value.code == "commit_missing" and remote_refs(world["bare"]) == ""


def test_a_local_branch_that_moved_is_refused(world):
    git(world["repo"], "branch", "-f", BRANCH, world["base"])  # the branch no longer points at the fix
    with pytest.raises(BranchPushError) as exc:
        world["pusher"].push("Veggies02/OmniSight", world["fix"], BRANCH)
    assert exc.value.code == "branch_mismatch" and remote_refs(world["bare"]) == ""


def test_a_remote_branch_with_other_history_is_never_overwritten(world):
    other = world["repo"].parent / "other"  # a completely unrelated history already sits on the remote branch
    other.mkdir()
    git(other, "init", "-q")
    (other / "z.txt").write_text("z")
    git(other, "add", "z.txt")
    git(other, "commit", "-qm", "unrelated")
    git(other, "push", str(world["bare"]), f"HEAD:refs/heads/{BRANCH}")
    before = remote_refs(world["bare"])
    with pytest.raises(BranchPushError) as exc:
        world["pusher"].push("Veggies02/OmniSight", world["fix"], BRANCH)
    assert exc.value.code == "push_rejected"
    assert remote_refs(world["bare"]) == before  # nothing was forced


def test_the_token_never_appears_in_arguments_or_messages(world, monkeypatch):
    seen = []
    real_popen = subprocess.Popen

    def spy(args, **kwargs):
        seen.append((list(args), dict(kwargs.get("env") or {})))
        return real_popen(args, **kwargs)

    monkeypatch.setattr(branch_pusher.subprocess, "Popen", spy)
    pusher = BranchPusher(repo_root=world["repo"], token_provider=lambda: TOKEN,
                          remote_url=lambda r: str(world["repo"].parent / "does-not-exist.git"))
    with pytest.raises(BranchPushError) as exc:
        pusher.push("Veggies02/OmniSight", world["fix"], BRANCH)
    assert TOKEN not in str(exc.value) and TOKEN not in repr(exc.value.args)
    import base64
    encoded = base64.b64encode(f"x-access-token:{TOKEN}".encode()).decode()
    for args, env in seen:
        joined = " ".join(args)
        assert TOKEN not in joined and encoded not in joined  # never on the command line
    push_args, push_env = seen[-1]
    assert "--no-verify" in push_args and "--force" not in push_args and "-f" not in push_args
    assert push_env["GIT_TERMINAL_PROMPT"] == "0" and push_env["GIT_CONFIG_VALUE_1"] == ""
    assert encoded in push_env["GIT_CONFIG_VALUE_0"]  # it travels in the environment only


def test_a_stuck_push_is_stopped(world):
    pusher = BranchPusher(repo_root=world["repo"], token_provider=lambda: TOKEN,
                          remote_url=lambda r: str(world["bare"]), timeout_seconds=0.001)
    with pytest.raises(BranchPushError) as exc:
        pusher.push("Veggies02/OmniSight", world["fix"], BRANCH)
    assert exc.value.code == "push_timeout"


def test_token_lookup_order(monkeypatch):
    for name in branch_pusher.TOKEN_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    assert branch_pusher.github_token_from_env() is None
    monkeypatch.setenv("GH_TOKEN", "c")
    assert branch_pusher.github_token_from_env() == "c"
    monkeypatch.setenv("GITHUB_TOKEN", "b")
    assert branch_pusher.github_token_from_env() == "b"
    monkeypatch.setenv("OMNISIGHT_GITHUB_TOKEN", "a")
    assert branch_pusher.github_token_from_env() == "a"