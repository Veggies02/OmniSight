"""Unit tests for the validation checklist builder (validation_checklist.py)."""
import pytest
from pydantic import ValidationError

from schemas import (
    AIFinding,
    CheckType,
    DefectCategory,
    ValidationCheck,
    ValidationChecklist,
    ViewportConfig,
)
from validation_checklist import build_validation_checklist, safe_selector

ALL = DefectCategory


def _finding(category=ALL.MOBILE_BUTTON_CLIPPING, selector=".add-to-cart"):
    return AIFinding(
        job_id="j1",
        defect_category=category,
        description="d",
        evidence_reference="a.png",
        confidence=0.9,
        target_selector=selector,
    )


def _types(checklist):
    return {check.check_type.value for check in checklist.checks}


# --- Viewports ---

def test_viewports_come_from_the_evidence(make_evidence):
    checklist = build_validation_checklist(_finding(), evidence=make_evidence("clean"))
    assert [(v.width, v.height, v.is_mobile) for v in checklist.viewports] == [
        (375, 812, True), (1280, 720, False),
    ]


def test_desktop_evidence_gets_a_mobile_regression_viewport(make_evidence):
    evidence = make_evidence("clean", viewport=ViewportConfig(width=1280, height=720))
    checklist = build_validation_checklist(_finding(), evidence=evidence)
    assert [(v.width, v.height, v.is_mobile) for v in checklist.viewports] == [
        (1280, 720, False), (375, 812, True),
    ]


@pytest.mark.parametrize("category, mobile", [
    (ALL.MOBILE_BUTTON_CLIPPING, True),
    (ALL.MODAL_OVERFLOW, True),
    (ALL.OVERLAPPING_TEXT, False),
    (ALL.HIDDEN_CONTROL, False),
    (ALL.INCORRECT_SPACING, False),
])
def test_default_viewport_depends_on_category(category, mobile):
    checklist = build_validation_checklist(_finding(category))
    assert checklist.viewports[0].is_mobile is mobile


# --- Selectors ---

def test_safe_selector_is_used_everywhere():
    checklist = build_validation_checklist(_finding())
    assert checklist.selectors_to_check == [".add-to-cart"]
    assert {c.selector for c in checklist.checks if c.selector} == {".add-to-cart"}


@pytest.mark.parametrize("selector", [
    "body; alert(1)", "a{b}", "x\ny", "`id`", "<script>", "a" * 201, "\\x",
])
def test_unsafe_selectors_are_dropped(selector):
    checklist = build_validation_checklist(_finding(selector=selector))
    assert checklist.selectors_to_check == []
    assert all(check.selector is None for check in checklist.checks)


def test_safe_selector_helper():
    assert safe_selector(".a") == ".a"
    assert safe_selector("  .a  ") == ".a"
    assert safe_selector("div[data-testid='x'] > .a:not(.b)") == "div[data-testid='x'] > .a:not(.b)"
    assert safe_selector(None) is None
    assert safe_selector(5) is None


# --- Checks ---

@pytest.mark.parametrize("category, expected", [
    (ALL.MOBILE_BUTTON_CLIPPING, {"in_viewport", "visible_and_clickable", "no_horizontal_scroll", "reanalyze_no_defect", "no_console_errors"}),
    (ALL.OVERLAPPING_TEXT, {"not_covered", "visible_and_clickable", "no_horizontal_scroll", "reanalyze_no_defect", "no_console_errors"}),
    (ALL.HIDDEN_CONTROL, {"visible_and_clickable", "no_horizontal_scroll", "reanalyze_no_defect", "no_console_errors"}),
    (ALL.INCORRECT_SPACING, {"spacing_to_neighbours", "visible_and_clickable", "no_horizontal_scroll", "reanalyze_no_defect", "no_console_errors"}),
    (ALL.MODAL_OVERFLOW, {"in_viewport", "visible_and_clickable", "no_horizontal_scroll", "reanalyze_no_defect", "no_console_errors"}),
    (ALL.OTHER, {"visible_and_clickable", "no_horizontal_scroll", "reanalyze_no_defect", "no_console_errors"}),
])
def test_checks_match_the_category(category, expected):
    assert _types(build_validation_checklist(_finding(category))) == expected


@pytest.mark.parametrize("category", [ALL.MOBILE_BUTTON_CLIPPING, ALL.OVERLAPPING_TEXT])
def test_without_a_selector_only_page_level_checks_remain(category):
    checklist = build_validation_checklist(_finding(category, selector=None))
    assert _types(checklist) == {"no_horizontal_scroll", "reanalyze_no_defect", "no_console_errors"}


def test_regression_viewport_gets_a_light_set_of_checks(make_evidence):
    checklist = build_validation_checklist(_finding(), evidence=make_evidence("clean"))
    regression = checklist.viewports[1]
    types = {c.check_type.value for c in checklist.checks if c.viewport == regression}
    assert types == {"no_horizontal_scroll", "visible_and_clickable"}


def test_steps_name_the_page_step_files_and_selector(make_evidence):
    evidence = make_evidence("clean", step_name="Browse products")
    checklist = build_validation_checklist(
        _finding(), evidence=evidence, changed_files=["src/a.css"],
    )
    assert "http://localhost:5174/products" in checklist.steps[0]
    assert "375x812" in checklist.steps[0]
    assert any("Browse products" in step for step in checklist.steps)
    assert any("src/a.css" in step for step in checklist.steps)
    assert any("`.add-to-cart`" in step for step in checklist.steps)


def test_expected_outcome_names_the_defect_and_viewport(make_evidence):
    checklist = build_validation_checklist(_finding(), evidence=make_evidence("clean"))
    assert "clipped button" in checklist.expected_outcome
    assert "375x812" in checklist.expected_outcome


def test_spacing_check_has_a_minimum_gap():
    checklist = build_validation_checklist(_finding(ALL.INCORRECT_SPACING))
    check = next(c for c in checklist.checks if c.check_type == CheckType.SPACING_TO_NEIGHBOURS)
    assert check.params == {"min_gap_px": 4}


def test_only_modal_checks_look_at_vertical_overflow():
    modal = build_validation_checklist(_finding(ALL.MODAL_OVERFLOW))
    button = build_validation_checklist(_finding(ALL.MOBILE_BUTTON_CLIPPING))
    modal_check = next(c for c in modal.checks if c.check_type == CheckType.IN_VIEWPORT)
    button_check = next(c for c in button.checks if c.check_type == CheckType.IN_VIEWPORT)
    assert modal_check.params["check_vertical"] is True
    assert button_check.params["check_vertical"] is False


def test_reanalysis_check_names_the_category():
    checklist = build_validation_checklist(_finding())
    check = next(c for c in checklist.checks if c.check_type == CheckType.REANALYZE_NO_DEFECT)
    assert check.params == {"category": "mobile_button_clipping"}
    assert check.viewport == checklist.viewports[0]
    assert check.selector == ".add-to-cart"


def test_long_file_lists_are_shortened():
    files = [f"src/f{i}.css" for i in range(8)]
    checklist = build_validation_checklist(_finding(), changed_files=files)
    step = next(s for s in checklist.steps if s.startswith("Apply"))
    assert "src/f4.css" in step
    assert "src/f5.css" not in step
    assert "and 3 more" in step


def test_file_names_cannot_break_a_step_across_lines():
    checklist = build_validation_checklist(_finding(), changed_files=["a\nb.css"])
    assert all("\n" not in step for step in checklist.steps)


def test_checklist_survives_a_json_round_trip():
    checklist = build_validation_checklist(_finding(), changed_files=["src/a.css"])
    assert ValidationChecklist.model_validate_json(checklist.model_dump_json()) == checklist


def test_unknown_check_type_is_rejected():
    with pytest.raises(ValidationError):
        ValidationCheck(check_type="nope", description="x")


def test_steps_are_always_present_and_bounded():
    checklist = build_validation_checklist(_finding(ALL.OTHER, selector=None))
    assert 1 <= len(checklist.steps) <= 10
    assert all(step.strip() for step in checklist.steps)