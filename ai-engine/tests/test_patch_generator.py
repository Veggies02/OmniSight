"""Unit tests for the patch generator (patch_generator.py)."""
import json

import pytest

import patch_generator
from patch_generator import (
    PatchLimits,
    STATUS_DECLINED,
    STATUS_NO_DEFECT,
    STATUS_NO_SOURCE,
    STATUS_PROPOSED,
    STATUS_REJECTED,
    STATUS_UNPARSEABLE,
    generate_patch,
)
from schemas import AIFinding, DefectCategory
from vlm_client import MockVisionModel, VLMError

CSS_PATH = "src/components/ProductCard.css"
TSX_PATH = "src/components/ProductCard.tsx"

REPO_FILES = {
    CSS_PATH: (
        ".product-card { display: flex; }\n"
        ".add-to-cart { width: 400px; }\n"
        ".price { color: #333; }\n"
    ),
    TSX_PATH: "\n".join([
        "export function ProductCard() {",
        "  return (",
        '    <div className="product-card">',
        '      <button className="add-to-cart btn">Add</button>',
        "    </div>",
        "  );",
        "}",
    ]),
}

GOOD_DIFF = (
    f"--- a/{CSS_PATH}\n+++ b/{CSS_PATH}\n"
    "@@ -1,3 +1,3 @@\n"
    " .product-card { display: flex; }\n"
    "-.add-to-cart { width: 400px; }\n"
    "+.add-to-cart { max-width: 100%; }\n"
    " .price { color: #333; }\n"
)

VALIDATION = {
    "steps": ["Open /products at 375px wide"],
    "expected_outcome": "The Add to Cart button is fully visible",
    "selectors_to_check": [".add-to-cart", ".price"],
}


def _write_repo(root, files):
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return str(root)


@pytest.fixture
def repo(tmp_path):
    return _write_repo(tmp_path, REPO_FILES)


@pytest.fixture
def finding(screenshots):
    return AIFinding(
        job_id="job-1",
        defect_category=DefectCategory.MOBILE_BUTTON_CLIPPING,
        description="Add to Cart button runs past the right edge",
        evidence_reference=screenshots["clipped_button"],
        confidence=0.9,
        target_selector=".add-to-cart",
    )


@pytest.fixture
def dup_repo(tmp_path):
    return _write_repo(tmp_path, {"src/a.css": ".a { color: red; }\n.a { color: red; }\n"})


@pytest.fixture
def dup_finding(screenshots):
    return AIFinding(
        job_id="job-2",
        defect_category=DefectCategory.INCORRECT_SPACING,
        description="Duplicate rule",
        evidence_reference=screenshots["clean"],
        confidence=0.9,
        target_selector=".a",
    )


def _change(path=CSS_PATH, diff=GOOD_DIFF):
    return {"file_path": path, "description": "Cap the width", "unified_diff": diff}


def _reply(changes, confidence=0.8, summary="Cap the button width", validation=VALIDATION):
    payload = {"summary": summary, "confidence": confidence, "changes": changes}
    if validation is not None:
        payload["validation"] = validation
    return json.dumps(payload)


def _run(finding, repo, reply, **kwargs):
    return generate_patch(finding, repo, MockVisionModel(canned_response=reply), **kwargs)


def _reasons(result):
    return " | ".join(result.reasons)


# --- Accepted patches ---

def test_valid_patch_becomes_a_proposal(finding, repo):
    result = _run(finding, repo, _reply([_change()]))
    assert result.status == STATUS_PROPOSED and result.ok
    proposal = result.proposal
    assert proposal.finding_id == finding.finding_id
    assert proposal.category == DefectCategory.MOBILE_BUTTON_CLIPPING
    assert proposal.requires_human_review is True
    assert proposal.changes[0].file_path == CSS_PATH
    assert "+.add-to-cart { max-width: 100%; }" in proposal.changes[0].unified_diff


def test_diff_is_rewritten_with_correct_hunk_numbers(finding, repo):
    wrong = GOOD_DIFF.replace("@@ -1,3 +1,3 @@", "@@ -9,9 +9,9 @@")
    result = _run(finding, repo, _reply([_change(diff=wrong)]))
    diff = result.proposal.changes[0].unified_diff
    assert "@@ -1,3 +1,3 @@" in diff
    assert "@@ -9,9" not in diff


def test_repository_files_are_never_modified(finding, repo, tmp_path):
    before = (tmp_path / CSS_PATH).read_text(encoding="utf-8")
    _run(finding, repo, _reply([_change()]))
    assert (tmp_path / CSS_PATH).read_text(encoding="utf-8") == before


# --- Rejected patches ---

def test_unmatched_context_is_rejected(finding, repo):
    bad = GOOD_DIFF.replace("display: flex", "display: grid")
    result = _run(finding, repo, _reply([_change(diff=bad)]))
    assert result.status == STATUS_REJECTED
    assert "does not match" in _reasons(result)
    assert result.proposal is None


def test_file_that_was_not_provided_is_rejected(finding, repo):
    other = GOOD_DIFF.replace(CSS_PATH, "src/other.css")
    result = _run(finding, repo, _reply([_change(path="src/other.css", diff=other)]))
    assert result.status == STATUS_REJECTED
    assert "not one of the provided files" in _reasons(result)


def test_diff_header_must_match_file_path(finding, repo):
    bad = GOOD_DIFF.replace(f"+++ b/{CSS_PATH}", "+++ b/src/components/Other.css")
    result = _run(finding, repo, _reply([_change(diff=bad)]))
    assert result.status == STATUS_REJECTED
    assert "different file" in _reasons(result)


def test_path_traversal_is_rejected(finding, repo):
    result = _run(finding, repo, _reply([_change(path="../secrets.env")]))
    assert result.status == STATUS_REJECTED


def test_new_file_diff_is_rejected(finding, repo):
    bad = GOOD_DIFF.replace(f"--- a/{CSS_PATH}", "--- /dev/null")
    result = _run(finding, repo, _reply([_change(diff=bad)]))
    assert result.status == STATUS_REJECTED


def test_oversized_patch_is_rejected(finding, repo):
    result = _run(finding, repo, _reply([_change()]), limits=PatchLimits(max_changed_lines=1))
    assert result.status == STATUS_REJECTED
    assert "limit" in _reasons(result)


def test_too_many_files_is_rejected(finding, repo):
    reply = _reply([_change(), _change(path=TSX_PATH, diff="x")])
    result = _run(finding, repo, reply, limits=PatchLimits(max_files=1))
    assert result.status == STATUS_REJECTED
    assert "limit is 1" in _reasons(result)


def test_duplicate_diffs_for_one_file_are_rejected(finding, repo):
    result = _run(finding, repo, _reply([_change(), _change()]))
    assert result.status == STATUS_REJECTED
    assert "more than one diff" in _reasons(result)


def test_diff_that_changes_nothing_is_rejected(finding, repo):
    same = GOOD_DIFF.replace("+.add-to-cart { max-width: 100%; }", "+.add-to-cart { width: 400px; }")
    result = _run(finding, repo, _reply([_change(diff=same)]))
    assert result.status == STATUS_REJECTED
    assert "no change" in _reasons(result)


def test_ambiguous_hunk_is_rejected(dup_finding, dup_repo):
    diff = (
        "--- a/src/a.css\n+++ b/src/a.css\n@@ -7,1 +7,1 @@\n"
        "-.a { color: red; }\n+.a { color: blue; }\n"
    )
    result = _run(dup_finding, dup_repo, _reply([_change("src/a.css", diff)]))
    assert result.status == STATUS_REJECTED
    assert "more than one place" in _reasons(result)


def test_header_number_resolves_an_ambiguous_hunk(dup_finding, dup_repo):
    diff = (
        "--- a/src/a.css\n+++ b/src/a.css\n@@ -2,1 +2,1 @@\n"
        "-.a { color: red; }\n+.a { color: blue; }\n"
    )
    result = _run(dup_finding, dup_repo, _reply([_change("src/a.css", diff)]))
    assert result.status == STATUS_PROPOSED
    assert "\n .a { color: red; }\n-.a { color: red; }\n+.a { color: blue; }" in result.proposal.changes[0].unified_diff


# --- No patch ---

def test_model_decline_is_reported(finding, repo):
    reply = _reply([], confidence=0.0, summary="Cannot fix safely")
    result = _run(finding, repo, reply)
    assert result.status == STATUS_DECLINED
    assert result.reasons == ("Cannot fix safely",)
    assert result.proposal is None


def test_unparseable_reply(finding, repo):
    result = _run(finding, repo, "this is not json")
    assert result.status == STATUS_UNPARSEABLE


def test_no_source_files_means_the_model_is_not_called(repo, screenshots):
    nothing = AIFinding(
        job_id="job-3",
        defect_category=DefectCategory.HIDDEN_CONTROL,
        description="Icon hidden",
        evidence_reference=screenshots["clean"],
        confidence=0.9,
        target_selector=".nothing-here",
    )
    model = MockVisionModel(simulate_error=VLMError("model should not be called"))
    result = generate_patch(nothing, repo, model)
    assert result.status == STATUS_NO_SOURCE


def test_none_category_is_not_repaired(repo, screenshots):
    clean = AIFinding(
        job_id="job-4",
        defect_category=DefectCategory.NONE,
        description="Looks fine",
        evidence_reference=screenshots["clean"],
        confidence=1.0,
    )
    assert generate_patch(clean, repo, MockVisionModel()).status == STATUS_NO_DEFECT


def test_provider_errors_propagate(finding, repo):
    model = MockVisionModel(simulate_error=VLMError("provider down"))
    with pytest.raises(VLMError):
        generate_patch(finding, repo, model)


# --- Confidence and checklist ---

def test_repaired_reply_caps_confidence(finding, repo):
    truncated = _reply([_change()], confidence=0.9)[:-1]  # drop the final brace
    result = _run(finding, repo, truncated)
    assert result.status == STATUS_PROPOSED
    assert result.proposal.confidence == 0.5
    assert "repaired" in _reasons(result)


@pytest.mark.parametrize("value, expected", [(7, 1.0), ("abc", 0.5)])
def test_confidence_is_clamped(finding, repo, value, expected):
    result = _run(finding, repo, _reply([_change()], confidence=value))
    assert result.proposal.confidence == expected


def test_missing_validation_gets_a_default_checklist(finding, repo):
    result = _run(finding, repo, _reply([_change()], validation=None))
    checklist = result.proposal.validation
    assert checklist.steps
    assert checklist.selectors_to_check == [".add-to-cart"]


def test_model_validation_steps_are_used(finding, repo):
    result = _run(finding, repo, _reply([_change()]))
    checklist = result.proposal.validation
    assert checklist.steps == ["Open /products at 375px wide"]
    assert checklist.selectors_to_check == [".add-to-cart", ".price"]


# --- What the model receives ---

class _Recorder:
    """Stand-in model that records its calls and returns a fixed reply."""

    def __init__(self, reply):
        self.reply = reply
        self.calls = []

    def analyze(self, image_path, prompt):
        self.calls.append((image_path, prompt))
        return self.reply


def test_prompt_receives_the_localized_files(finding, repo, monkeypatch):
    captured = {}
    real = patch_generator.build_repair_prompt

    def spy(**kwargs):
        captured.update(kwargs)
        return real(**kwargs)

    monkeypatch.setattr(patch_generator, "build_repair_prompt", spy)
    _run(finding, repo, _reply([_change()]))
    assert [s.path for s in captured["sources"]] == [CSS_PATH, TSX_PATH]
    assert captured["sources"][0].focus_line == 2


def test_screenshot_defaults_to_the_finding_reference(finding, repo):
    model = _Recorder(_reply([_change()]))
    result = generate_patch(finding, repo, model)
    assert result.ok
    assert model.calls[0][0] == finding.evidence_reference
    assert "--- FILES ---" in model.calls[0][1]
    assert "Selector: .add-to-cart" in model.calls[0][1]


def test_evidence_overrides_screenshot_and_viewport(finding, repo, make_evidence):
    evidence = make_evidence("clean")
    model = _Recorder(_reply([_change()]))
    generate_patch(finding, repo, model, evidence=evidence)
    assert model.calls[0][0] == evidence.screenshot_path
    assert "Viewport: 375x812 (mobile)" in model.calls[0][1]

# --- Scope policy ---

from patch_scope import ScopePolicy

TSX_UNSAFE_DIFF = (
    f"--- a/{TSX_PATH}\n+++ b/{TSX_PATH}\n"
    "@@ -3,3 +3,3 @@\n"
    '     <div className="product-card">\n'
    '-      <button className="add-to-cart btn">Add</button>\n'
    '+      <button className="add-to-cart btn" onClick={() => track()}>Add</button>\n'
    "     </div>\n"
)


def test_policy_filters_files_sent_to_model(finding, repo):
    policy = ScopePolicy(allowed_extensions=frozenset({".css"}))
    model = _Recorder(_reply([_change()]))
    result = generate_patch(finding, repo, model, policy=policy)
    prompt = model.calls[0][1]
    assert result.ok
    assert f"<<<FILE {CSS_PATH}>>>" in prompt
    assert f"<<<FILE {TSX_PATH}>>>" not in prompt


def test_unsafe_added_content_is_rejected_by_scope(finding, repo):
    result = _run(finding, repo, _reply([_change(path=TSX_PATH, diff=TSX_UNSAFE_DIFF)]))
    assert result.status == STATUS_REJECTED
    assert "behaviour" in _reasons(result)


def test_no_allowed_files_means_the_model_is_not_called(finding, repo):
    policy = ScopePolicy(allowed_dirs=("elsewhere",))
    model = MockVisionModel(simulate_error=VLMError("model should not be called"))
    result = generate_patch(finding, repo, model, policy=policy)
    assert result.status == STATUS_NO_SOURCE
    