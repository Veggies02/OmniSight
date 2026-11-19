"""Patch scope validator: make sure a patch only touches what it is allowed to.

A proposed patch comes from a language model, so it is checked before anyone
sees it. Two kinds of check run:

1. Path checks: every file must be a relative path inside the repository, a
   frontend file type on the allowlist, and not in a protected location
   (dependencies, build output, tests, hidden folders, config and lock files).
   When a repo root is given, symlinks that lead outside it are rejected too.
2. Content checks: lines the patch adds must not introduce scripts, external
   resources, raw HTML injection, or new behaviour such as event handlers,
   effects, network calls or storage access. A pattern only counts when the
   patch adds more of it than it removes, so reformatting an existing line
   is fine.

This module only reads paths and text. It never modifies files.
"""
import fnmatch
import os
import re
from dataclasses import dataclass
from typing import FrozenSet, List, Optional, Sequence, Tuple

from schemas import CodeChange, PatchProposal

DEFAULT_ALLOWED_EXTENSIONS = frozenset({
    ".css", ".scss", ".sass", ".less",
    ".tsx", ".jsx", ".html", ".vue", ".svelte",
})
DEFAULT_DENIED_SEGMENTS = frozenset({
    "node_modules", "dist", "build", "coverage",
    "test", "tests", "__tests__", "__mocks__",
})
DEFAULT_DENIED_NAMES = (
    "*.test.*", "*.spec.*", "*.min.*", "*.config.*", "*.lock",
    "package.json", "package-lock.json", "tsconfig*.json", ".env*",
)


@dataclass(frozen=True)
class ScopePolicy:
    """What a patch is allowed to touch.

    allowed_dirs is optional. When set, files must sit under one of these
    folders (relative to the repo root, for example "storefront/src").
    """

    allowed_extensions: FrozenSet[str] = DEFAULT_ALLOWED_EXTENSIONS
    allowed_dirs: Tuple[str, ...] = ()
    denied_segments: FrozenSet[str] = DEFAULT_DENIED_SEGMENTS
    denied_names: Tuple[str, ...] = DEFAULT_DENIED_NAMES


DEFAULT_POLICY = ScopePolicy()


@dataclass(frozen=True)
class ScopeViolation:
    file_path: str
    rule: str
    message: str


@dataclass(frozen=True)
class ScopeReport:
    violations: Tuple[ScopeViolation, ...] = ()

    @property
    def ok(self) -> bool:
        return not self.violations


def _normalise_dir(value: str) -> str:
    return value.replace("\\", "/").strip("/").lower()


def _path_violation(path, policy: ScopePolicy) -> Optional[ScopeViolation]:
    """Return the first path rule the path breaks, or None if it is fine."""
    shown = path if isinstance(path, str) else repr(path)

    def violation(rule: str, message: str) -> ScopeViolation:
        return ScopeViolation(shown, rule, f"{shown}: {message}")

    if not isinstance(path, str) or not path.strip():
        return violation("invalid_path", "the path is empty")
    if any(ord(char) < 32 for char in path):
        return violation("invalid_path", "the path contains control characters")

    value = path.strip().replace("\\", "/")
    if value.startswith("/") or re.match(r"^[A-Za-z]:", value):
        return violation("absolute_path", "the path must be relative to the repository root")

    parts = [part for part in value.split("/") if part not in ("", ".")]
    if not parts:
        return violation("invalid_path", "the path is empty")
    if ".." in parts:
        return violation("path_traversal", "the path must not contain '..'")

    lowered = [part.lower() for part in parts]
    directories, name = lowered[:-1], lowered[-1]
    if any(d in policy.denied_segments or d.startswith(".") for d in directories):
        return violation("denied_location", "the file is in a protected folder")
    if name.startswith(".") or any(
        fnmatch.fnmatchcase(name, pattern.lower()) for pattern in policy.denied_names
    ):
        return violation("denied_file", "this kind of file is protected")

    extension = os.path.splitext(name)[1]
    if extension not in policy.allowed_extensions:
        return violation("extension_not_allowed", f"file type '{extension or 'none'}' is not allowed")

    if policy.allowed_dirs:
        normalised = "/".join(lowered)
        if not any(
            normalised.startswith(_normalise_dir(d) + "/") for d in policy.allowed_dirs
        ):
            return violation("outside_allowed_dirs", "the file is outside the allowed folders")
    return None


def _escapes_repo(repo_root: str, path: str) -> bool:
    """True if the file, after following symlinks, lies outside the repo."""
    parts = [p for p in path.strip().replace("\\", "/").split("/") if p not in ("", ".")]
    full = os.path.join(repo_root, *parts)
    if not os.path.exists(full):
        return False
    root_real = os.path.normcase(os.path.realpath(repo_root))
    full_real = os.path.normcase(os.path.realpath(full))
    try:
        return os.path.commonpath([root_real, full_real]) != root_real
    except ValueError:  # for example, different drives on Windows
        return True


def check_path(
    path,
    policy: ScopePolicy = DEFAULT_POLICY,
    repo_root: Optional[str] = None,
) -> List[ScopeViolation]:
    """Check one file path against the policy. Empty list means it is allowed."""
    found = _path_violation(path, policy)
    if found is not None:
        return [found]
    if repo_root and _escapes_repo(repo_root, path):
        return [ScopeViolation(
            path, "symlink_escape",
            f"{path}: the file resolves to a location outside the repository",
        )]
    return []


# Each rule is (name, description, patterns). A rule is violated when the patch
# adds more matches than it removes.
_CONTENT_RULES = (
    ("script_execution", "script or code-execution constructs", (
        re.compile(r"<\s*script\b", re.IGNORECASE),
        re.compile(r"\beval\s*\("),
        re.compile(r"\bnew\s+Function\b"),
        re.compile(r"document\s*\.\s*write"),
    )),
    ("javascript_url", "a javascript: URL", (
        re.compile(r"javascript\s*:", re.IGNORECASE),
    )),
    ("html_injection", "raw HTML injection", (
        re.compile(r"dangerouslySetInnerHTML"),
        re.compile(r"\.(?:inner|outer)HTML\b"),
    )),
    ("external_resource", "an external resource URL", (
        re.compile(r"https?://", re.IGNORECASE),
        re.compile(r"url\(\s*['\"]?\s*//"),
    )),
    ("css_script_hook", "legacy CSS script hooks", (
        re.compile(r"expression\s*\(", re.IGNORECASE),
        re.compile(r"behavior\s*:", re.IGNORECASE),
        re.compile(r"-moz-binding", re.IGNORECASE),
    )),
    ("behaviour_change", "behaviour, network or storage code", (
        re.compile(r"\bon[A-Z][A-Za-z]*\s*="),
        re.compile(r"\bon[a-z]{3,}\s*=", re.IGNORECASE),
        re.compile(r"\buse(?:Layout)?Effect\b"),
        re.compile(r"\bfetch\s*\("),
        re.compile(r"\bXMLHttpRequest\b"),
        re.compile(r"\bWebSocket\b"),
        re.compile(r"\baxios\b"),
        re.compile(r"\b(?:local|session)Storage\b"),
        re.compile(r"document\s*\.\s*cookie"),
        re.compile(r"window\s*\.\s*location"),
        re.compile(r"\bimport\s*\("),
        re.compile(r"\brequire\s*\("),
    )),
)


def check_diff_content(path: str, diff: str) -> List[ScopeViolation]:
    """Check the lines a unified diff adds, relative to the lines it removes."""
    lines = diff.splitlines() if isinstance(diff, str) else []
    start = 2 if (
        len(lines) >= 2 and lines[0].startswith("--- ") and lines[1].startswith("+++ ")
    ) else 0
    body = lines[start:]
    added = "\n".join(line[1:] for line in body if line.startswith("+"))
    removed = "\n".join(line[1:] for line in body if line.startswith("-"))

    found: List[ScopeViolation] = []
    for _name, description, patterns in _CONTENT_RULES:
        gained = (
            sum(len(p.findall(added)) for p in patterns)
            - sum(len(p.findall(removed)) for p in patterns)
        )
        if gained > 0:
            found.append(ScopeViolation(
                path, "unsafe_content", f"{path}: the patch adds {description}",
            ))
    return found


def validate_changes(
    changes: Sequence[CodeChange],
    policy: ScopePolicy = DEFAULT_POLICY,
    repo_root: Optional[str] = None,
) -> ScopeReport:
    """Check every change in a patch and collect all violations."""
    violations: List[ScopeViolation] = []
    for change in changes:
        found = check_path(change.file_path, policy, repo_root)
        violations.extend(found)
        if not found:
            violations.extend(check_diff_content(change.file_path, change.unified_diff))
    return ScopeReport(tuple(violations))


def validate_patch_scope(
    proposal: PatchProposal,
    policy: ScopePolicy = DEFAULT_POLICY,
    repo_root: Optional[str] = None,
) -> ScopeReport:
    """Check a whole patch proposal against the policy."""
    return validate_changes(proposal.changes, policy, repo_root)