"""Validation checklist builder: concrete re-run instructions for the orchestrator.

After a patch is applied, the orchestrator re-runs the page and needs to know
exactly what to check. The checklist is built from trusted data only: the
finding's category and selector, the original evidence, and the files the
patch changes. Text proposed by the model is never used, because the
checklist may be read by a person or run by a tool.

The checklist has two parts:
- steps and expected_outcome: plain-language instructions for a person
- checks: structured assertions a browser runner can execute
"""
import re
from typing import List, Optional, Sequence

from schemas import (
    AIFinding,
    CheckType,
    DefectCategory,
    EvidenceContext,
    ValidationCheck,
    ValidationChecklist,
    ViewportConfig,
)

MAX_FILES_LISTED = 5
MAX_SELECTOR_CHARS = 200
MIN_GAP_PX = 4

# Ordinary selector characters only: no braces, semicolons, angle brackets,
# backticks, backslashes or line breaks.
_SAFE_SELECTOR = re.compile(r"""[A-Za-z0-9_\- .#>+~\[\]=:"'(),*^$|]+""")

DESKTOP_VIEWPORT = ViewportConfig()
MOBILE_VIEWPORT = ViewportConfig(width=375, height=812, is_mobile=True)

_MOBILE_CATEGORIES = frozenset({
    DefectCategory.MOBILE_BUTTON_CLIPPING,
    DefectCategory.MODAL_OVERFLOW,
})
_SCROLL_CATEGORIES = frozenset({
    DefectCategory.MOBILE_BUTTON_CLIPPING,
    DefectCategory.INCORRECT_SPACING,
    DefectCategory.MODAL_OVERFLOW,
})

_LABELS = {
    DefectCategory.MOBILE_BUTTON_CLIPPING: "clipped button",
    DefectCategory.OVERLAPPING_TEXT: "overlapping text",
    DefectCategory.HIDDEN_CONTROL: "hidden control",
    DefectCategory.INCORRECT_SPACING: "spacing",
    DefectCategory.MODAL_OVERFLOW: "overflowing modal or menu",
}

_CATEGORY_STEPS = {
    DefectCategory.MOBILE_BUTTON_CLIPPING:
        "Check that {target} is fully inside the viewport, not cut off at any edge, and can be clicked.",
    DefectCategory.OVERLAPPING_TEXT:
        "Check that the text in {target} is not covered by or overlapping any other element.",
    DefectCategory.HIDDEN_CONTROL:
        "Check that {target} is visible and that clicking its centre reaches it, not another element.",
    DefectCategory.INCORRECT_SPACING:
        "Check that {target} no longer touches or overlaps its neighbours and keeps a clear gap.",
    DefectCategory.MODAL_OVERFLOW:
        "Check that {target} stays inside the viewport and the page does not scroll sideways.",
    DefectCategory.OTHER:
        "Compare the new screenshot with the original defect screenshot and confirm the problem is gone.",
}

# Checks tied to the defective element, run at the viewport where it was seen.
_PRIMARY_SELECTOR_CHECKS = {
    DefectCategory.MOBILE_BUTTON_CLIPPING: (CheckType.IN_VIEWPORT, CheckType.VISIBLE_AND_CLICKABLE),
    DefectCategory.OVERLAPPING_TEXT: (CheckType.NOT_COVERED,),
    DefectCategory.HIDDEN_CONTROL: (CheckType.VISIBLE_AND_CLICKABLE,),
    DefectCategory.INCORRECT_SPACING: (CheckType.SPACING_TO_NEIGHBOURS,),
    DefectCategory.MODAL_OVERFLOW: (CheckType.IN_VIEWPORT,),
}

_CHECK_TEXT = {
    CheckType.IN_VIEWPORT: "The element is fully inside the viewport and not cut off at any edge",
    CheckType.NO_HORIZONTAL_SCROLL: "The page does not scroll sideways",
    CheckType.VISIBLE_AND_CLICKABLE: "The element is visible and clicking its centre reaches it",
    CheckType.NOT_COVERED: "No other element covers the element at its centre or corners",
    CheckType.SPACING_TO_NEIGHBOURS: "The element keeps a clear gap from its neighbours",
    CheckType.REANALYZE_NO_DEFECT: "A new screenshot analysed by the AI engine shows no defect of this kind",
    CheckType.NO_CONSOLE_ERRORS: "The browser console shows no new errors",
}


def _one_line(text, limit: int) -> str:
    return " ".join(str(text).split())[:limit]


def _viewport_text(viewport: ViewportConfig) -> str:
    kind = "mobile" if viewport.is_mobile else "desktop"
    return f"{viewport.width}x{viewport.height} ({kind})"


def safe_selector(value) -> Optional[str]:
    """Return the selector if it is short and uses only ordinary characters, else None."""
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned or len(cleaned) > MAX_SELECTOR_CHARS:
        return None
    return cleaned if _SAFE_SELECTOR.fullmatch(cleaned) else None


def _viewports(category: DefectCategory, evidence: Optional[EvidenceContext]):
    """Return (primary, regression): where the defect was seen, and the other layout."""
    if evidence is not None:
        primary = evidence.viewport.model_copy()
    elif category in _MOBILE_CATEGORIES:
        primary = MOBILE_VIEWPORT.model_copy()
    else:
        primary = DESKTOP_VIEWPORT.model_copy()
    other = DESKTOP_VIEWPORT if primary.is_mobile else MOBILE_VIEWPORT
    return primary, other.model_copy()


def _check(check_type: CheckType, selector, viewport, params=None) -> ValidationCheck:
    return ValidationCheck(
        check_type=check_type,
        description=_CHECK_TEXT[check_type],
        selector=selector,
        viewport=viewport,
        params=params or {},
    )


def _apply_step(changed_files: Sequence[str]) -> str:
    names = [_one_line(name, 120) for name in changed_files]
    names = [name for name in names if name]
    if not names:
        return "Apply the proposed patch and reload the page."
    listed = ", ".join(names[:MAX_FILES_LISTED])
    extra = len(names) - MAX_FILES_LISTED
    if extra > 0:
        listed += f" and {extra} more"
    return f"Apply the proposed patch ({listed}) and reload the page."


def build_validation_checklist(
    finding: AIFinding,
    evidence: Optional[EvidenceContext] = None,
    changed_files: Sequence[str] = (),
) -> ValidationChecklist:
    """Build concrete re-run instructions for a patch, from trusted data only.

    Args:
        finding: The defect the patch is meant to fix.
        evidence: The original evidence, used for the page URL, journey step
            and viewport. Without it, a viewport is chosen from the category.
        changed_files: Files the patch modifies.
    """
    category = finding.defect_category
    primary, regression = _viewports(category, evidence)
    selector = safe_selector(finding.target_selector)
    label = _LABELS.get(category, "visual")

    target = (
        f"the element matching `{selector}`"
        if selector else "the area of the page where the defect was found"
    )
    category_step = _CATEGORY_STEPS.get(
        category, _CATEGORY_STEPS[DefectCategory.OTHER]
    ).format(target=target)

    page = (
        _one_line(evidence.url, 300)
        if evidence is not None and evidence.url
        else "the page where the defect was found"
    )
    steps: List[str] = [f"Open {page} at {_viewport_text(primary)}."]
    if evidence is not None and evidence.step_name:
        steps.append(f"Repeat the journey step: {_one_line(evidence.step_name, 200)}.")
    steps.append(_apply_step(changed_files))
    steps.append(category_step)
    steps.append("Capture a new screenshot and run the AI analysis on it; it should report no defect of this kind.")
    steps.append("Check the browser console for new errors.")
    steps.append(f"Repeat the checks at {_viewport_text(regression)} to confirm the other layout still works.")

    checks: List[ValidationCheck] = []
    if selector:
        for check_type in _PRIMARY_SELECTOR_CHECKS.get(category, ()):
            params = {}
            if check_type == CheckType.IN_VIEWPORT:
                params = {"check_vertical": category == DefectCategory.MODAL_OVERFLOW}
            elif check_type == CheckType.SPACING_TO_NEIGHBOURS:
                params = {"min_gap_px": MIN_GAP_PX}
            checks.append(_check(check_type, selector, primary, params))
    if category in _SCROLL_CATEGORIES:
        checks.append(_check(CheckType.NO_HORIZONTAL_SCROLL, None, primary))
    checks.append(_check(CheckType.NO_HORIZONTAL_SCROLL, None, regression))
    if selector:
        checks.append(_check(CheckType.VISIBLE_AND_CLICKABLE, selector, regression))
    checks.append(_check(
        CheckType.REANALYZE_NO_DEFECT, selector, primary, {"category": category.value},
    ))
    checks.append(_check(CheckType.NO_CONSOLE_ERRORS, None, primary))

    expected = (
        f"The {label} defect no longer appears at {_viewport_text(primary)}, "
        f"the layout still works at {_viewport_text(regression)}, "
        "and a new analysis reports no defect of this kind."
    )
    return ValidationChecklist(
        steps=steps,
        expected_outcome=expected,
        viewports=[primary, regression],
        selectors_to_check=[selector] if selector else [],
        checks=checks,
    )