"""Unit tests for the patch scope validator (patch_scope.py)."""
import os

import pytest

from patch_scope import (
    ScopePolicy,
    check_diff_content,
    check_path,
    validate_changes,
    validate_patch_scope,
)
from schemas import CodeChange, DefectCategory, PatchProposal, ValidationChecklist


def _diff(path, removed=(), added=()):
    body = "".join(f"-{line}\n" for line in removed) + "".join(f"+{line}\n" for line in added)
    return f"--- a/{path}\n+++ b/{path}\n@@ -1,1 +1,1 @@\n{body}"


def _change(path, diff):
    return CodeChange(file_path=path, description="x", unified_diff=diff)


def _rules(violations):
    return [v.rule for v in violations]


# --- Path checks ---

@pytest.mark.parametrize("path", [
    "src/App.css",
    "src/components/Card.tsx",
    "index.html",
    "src/styles/main.scss",
    "src\\components\\Card.css",
])
def test_allowed_paths_are_accepted(path):
    assert check_path(path) == []


@pytest.mark.parametrize("path", [
    "/etc/passwd", "C:/Windows/x.css", "C:\\x.css", "//server/share/a.css",
])
def test_absolute_paths_are_rejected(path):
    assert _rules(check_path(path)) == ["absolute_path"]


@pytest.mark.parametrize("path", ["../x.css", "src/../../x.css"])
def test_path_traversal_is_rejected(path):
    assert _rules(check_path(path)) == ["path_traversal"]


@pytest.mark.parametrize("path", ["", "   ", "src/a\x00.css"])
def test_invalid_paths_are_rejected(path):
    assert _rules(check_path(path)) == ["invalid_path"]


@pytest.mark.parametrize("path", [
    "node_modules/lib/a.css",
    "dist/app.css",
    "build/x.css",
    ".github/workflows/x.css",
    "src/tests/a.css",
    "src/__tests__/a.css",
])
def test_denied_locations_are_rejected(path):
    assert _rules(check_path(path)) == ["denied_location"]


@pytest.mark.parametrize("path", [
    "src/App.test.tsx", "src/App.spec.tsx", "src/app.min.css", "vite.config.js",
])
def test_denied_files_are_rejected(path):
    assert _rules(check_path(path)) == ["denied_file"]


@pytest.mark.parametrize("path", [
    "src/a.js", "src/a.ts", "src/a.py", "README.md", "src/logo.svg", "src/a.css.map",
])
def test_other_file_types_are_rejected(path):
    assert _rules(check_path(path)) == ["extension_not_allowed"]


def test_allowed_dirs_restrict_location():
    policy = ScopePolicy(allowed_dirs=("storefront/src",))
    assert check_path("storefront/src/a.css", policy) == []
    assert check_path("Storefront/Src/a.css", policy) == []
    for outside in ("storefront/server/a.css", "src/a.css"):
        assert _rules(check_path(outside, policy)) == ["outside_allowed_dirs"]


def test_custom_extensions_replace_the_defaults():
    policy = ScopePolicy(allowed_extensions=frozenset({".ts"}))
    assert check_path("src/a.ts", policy) == []
    assert _rules(check_path("src/a.css", policy)) == ["extension_not_allowed"]


def test_symlink_pointing_outside_the_repo_is_rejected(tmp_path):
    repo = tmp_path / "repo"
    (repo / "src").mkdir(parents=True)
    outside = tmp_path / "outside.css"
    outside.write_text(".a {}", encoding="utf-8")
    try:
        os.symlink(outside, repo / "src" / "link.css")
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are not available here")
    assert _rules(check_path("src/link.css", repo_root=str(repo))) == ["symlink_escape"]


def test_file_that_does_not_exist_yet_passes_the_symlink_check(tmp_path):
    assert check_path("src/new.css", repo_root=str(tmp_path)) == []


# --- Content checks ---

def test_safe_css_change_passes():
    diff = _diff("src/a.css", [".add-to-cart { width: 400px; }"], [".add-to-cart { max-width: 100%; }"])
    assert check_diff_content("src/a.css", diff) == []


def test_added_script_tag_is_rejected():
    diff = _diff("src/a.tsx", added=["<script>alert(1)</script>"])
    assert _rules(check_diff_content("src/a.tsx", diff)) == ["unsafe_content"]


def test_added_javascript_url_is_rejected():
    diff = _diff("src/a.tsx", added=['<a href="javascript:alert(1)">x</a>'])
    assert _rules(check_diff_content("src/a.tsx", diff)) == ["unsafe_content"]


def test_added_external_url_is_rejected():
    diff = _diff("src/a.css", [".a { color: red; }"], [".a { background: url(https://evil.example/x.png); }"])
    assert _rules(check_diff_content("src/a.css", diff)) == ["unsafe_content"]


def test_added_css_expression_is_rejected():
    diff = _diff("src/a.css", added=[".a { width: expression(alert(1)); }"])
    assert _rules(check_diff_content("src/a.css", diff)) == ["unsafe_content"]


def test_added_event_handler_is_rejected():
    diff = _diff(
        "src/a.tsx",
        ['<button className="b">Add</button>'],
        ['<button className="b" onClick={steal}>Add</button>'],
    )
    assert _rules(check_diff_content("src/a.tsx", diff)) == ["unsafe_content"]


def test_reformatting_an_existing_handler_is_allowed():
    diff = _diff(
        "src/a.tsx",
        ["<button onClick={go}>Add</button>"],
        ["    <button onClick={go}>Add</button>"],
    )
    assert check_diff_content("src/a.tsx", diff) == []


@pytest.mark.parametrize("line", [
    "fetch('/api/x')",
    "dangerouslySetInnerHTML={{ __html: html }}",
    "localStorage.setItem('a', 'b')",
    "useEffect(() => {}, [])",
    "eval(code)",
    "window.location = '/x'",
])
def test_behaviour_and_injection_patterns_are_rejected(line):
    diff = _diff("src/a.tsx", added=[line])
    assert check_diff_content("src/a.tsx", diff)


def test_removing_lines_never_triggers_a_violation():
    diff = _diff("src/a.tsx", removed=["<button onClick={go}>Add</button>", 'fetch("/x")'])
    assert check_diff_content("src/a.tsx", diff) == []


# --- Whole-patch reports ---

def test_good_proposal_is_in_scope():
    diff = _diff("src/a.css", [".a { width: 400px; }"], [".a { max-width: 100%; }"])
    proposal = PatchProposal(
        category=DefectCategory.MOBILE_BUTTON_CLIPPING,
        summary="x",
        changes=[_change("src/a.css", diff)],
        validation=ValidationChecklist(steps=["s"], expected_outcome="ok"),
        confidence=0.8,
    )
    report = validate_patch_scope(proposal)
    assert report.ok
    assert report.violations == ()


def test_every_violation_across_files_is_reported():
    bad_type = _change("src/a.js", _diff("src/a.js", added=["x"]))
    bad_content = _change("src/b.css", _diff("src/b.css", added=["<script>x</script>"]))
    report = validate_changes([bad_type, bad_content])
    assert not report.ok
    assert {v.rule for v in report.violations} == {"extension_not_allowed", "unsafe_content"}


def test_messages_name_the_file():
    report = validate_changes([_change("src/a.js", _diff("src/a.js", added=["x"]))])
    for violation in report.violations:
        assert violation.file_path in violation.message