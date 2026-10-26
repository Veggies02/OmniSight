"""Patch generator: turn a defect finding into a safe, reviewable code fix.

Flow: locate candidate source files, ask the model for a minimal unified
diff, then verify the diff against the real file contents before accepting it.
A proposed diff is only accepted if it names a provided file, matches that
file's contents exactly, stays within the size limits, and actually changes
something. Accepted diffs are rewritten from scratch so their hunk headers
are always correct.

The files in the repository are never modified. Whether a patch may touch a
given file is decided separately by the scope validator.

Limits: context lines must match the file exactly, the rewritten diff uses
LF line endings (apply it with --ignore-whitespace on CRLF checkouts), and
files without a final newline are not specially handled.
"""
import difflib
import os
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from pydantic import ValidationError

from defect_analyzer import extract_json_with_status
from localization import localize_finding
from prompts import MAX_REPAIR_FILES, RepairSource, build_repair_prompt
from schemas import (
    AIFinding,
    CodeChange,
    DefectCategory,
    EvidenceContext,
    PatchProposal,
    ValidationChecklist,
)
from vlm_client import VisionModel

STATUS_PROPOSED = "proposed"
STATUS_NO_DEFECT = "no_defect"
STATUS_NO_SOURCE = "no_source_files"
STATUS_UNPARSEABLE = "unparseable"
STATUS_DECLINED = "model_declined"
STATUS_REJECTED = "rejected"

_MAX_TEXT = 300
_MAX_LIST_ITEMS = 10
_REPAIRED_CONFIDENCE_CAP = 0.5

_HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@")


@dataclass(frozen=True)
class PatchLimits:
    """Size limits that keep a patch small enough to review."""

    max_files: int = MAX_REPAIR_FILES
    max_changed_lines: int = 40
    max_diff_chars: int = 8000


DEFAULT_LIMITS = PatchLimits()


@dataclass(frozen=True)
class PatchResult:
    """Outcome of a patch attempt: a proposal, or the reasons there is none."""

    status: str
    proposal: Optional[PatchProposal] = None
    reasons: Tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.status == STATUS_PROPOSED


def _text(value, limit: int = _MAX_TEXT) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def _normalise_path(value) -> str:
    if not isinstance(value, str):
        return ""
    path = value.strip().replace("\\", "/")
    while path.startswith("./"):
        path = path[2:]
    return path


def _diff_path(line: str, prefix: str) -> str:
    """Extract the file path from a '--- a/x' or '+++ b/x' header line."""
    value = line[4:].split("\t")[0].strip()
    if value.startswith(prefix):
        value = value[len(prefix):]
    return value


def _parse_hunks(lines: List[str]):
    """Split diff body lines into (old_start, old_lines, new_lines) hunks."""
    hunks = []
    current = None
    for line in lines:
        header = _HUNK_HEADER.match(line)
        if header:
            current = (int(header.group(1)), [], [])
            hunks.append(current)
            continue
        if current is None:
            raise ValueError("diff has content before the first hunk header")
        if line.startswith("\\"):
            continue  # "\ No newline at end of file"
        tag, body = (line[0], line[1:]) if line else (" ", "")
        _, old, new = current
        if tag == " ":
            old.append(body)
            new.append(body)
        elif tag == "-":
            old.append(body)
        elif tag == "+":
            new.append(body)
        else:
            raise ValueError(f"unexpected line inside a hunk: {line[:40]!r}")
    if not hunks:
        raise ValueError("diff has no hunks")
    return hunks


def _find_block(original: List[str], old: List[str], start_at: int, expected: int):
    """Locate the old lines in the file by content, using the header number to break ties."""
    last = len(original) - len(old)
    candidates = [
        i for i in range(start_at, last + 1)
        if original[i:i + len(old)] == old
    ]
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    if expected in candidates:
        return expected
    raise ValueError("matches more than one place in the file; more context lines are needed")


def _apply_hunks(original: List[str], hunks) -> List[str]:
    """Apply hunks to the original lines in memory and return the new lines."""
    result: List[str] = []
    pos = 0
    for number, (old_start, old, new) in enumerate(hunks, start=1):
        if not old:
            raise ValueError(f"hunk {number} has no context or removed lines to locate it")
        try:
            index = _find_block(original, old, pos, old_start - 1)
        except ValueError as exc:
            raise ValueError(f"hunk {number} {exc}")
        if index is None:
            raise ValueError(f"hunk {number} does not match the file")
        result.extend(original[pos:index])
        result.extend(new)
        pos = index + len(old)
    result.extend(original[pos:])
    return result


def _apply_and_canonicalise(path: str, text: str, diff: str) -> Tuple[str, int]:
    """Verify a model diff against the file and rewrite it with correct headers.

    Returns (clean_diff, changed_line_count). Raises ValueError with a reason
    when the diff cannot be accepted.
    """
    original = text.splitlines()
    lines = diff.splitlines()
    while lines and lines[-1] == "":
        lines.pop()
    if len(lines) < 3 or not lines[0].startswith("--- ") or not lines[1].startswith("+++ "):
        raise ValueError("diff must start with '--- a/<path>' and '+++ b/<path>' lines")
    if _diff_path(lines[0], "a/") != path or _diff_path(lines[1], "b/") != path:
        raise ValueError("diff header names a different file than file_path")

    updated = _apply_hunks(original, _parse_hunks(lines[2:]))
    clean = list(difflib.unified_diff(
        original, updated, fromfile=f"a/{path}", tofile=f"b/{path}", n=3, lineterm="",
    ))
    if not clean:
        raise ValueError("diff makes no change")
    changed = sum(1 for line in clean[2:] if line[:1] in ("+", "-"))
    return "\n".join(clean) + "\n", changed


def _load_sources(repo_root: str, matches) -> Tuple[Dict[str, str], List[RepairSource]]:
    """Read the localized files so the diff can be checked against real contents."""
    texts: Dict[str, str] = {}
    sources: List[RepairSource] = []
    for match in matches:
        full = os.path.join(repo_root, *match.file_path.split("/"))
        try:
            with open(full, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        except OSError:
            continue
        texts[match.file_path] = text
        sources.append(RepairSource(path=match.file_path, text=text, focus_line=match.line))
    return texts, sources


def _clean_list(value) -> List[str]:
    if not isinstance(value, list):
        return []
    items = [_text(item) for item in value if isinstance(item, str)]
    return [item for item in items if item][:_MAX_LIST_ITEMS]


def _clamp_confidence(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.5
    if number != number:  # NaN
        return 0.5
    return max(0.0, min(1.0, number))


def _build_checklist(raw, finding: AIFinding) -> ValidationChecklist:
    """Use the model's validation steps, with safe defaults for anything missing."""
    raw = raw if isinstance(raw, dict) else {}
    steps = _clean_list(raw.get("steps")) or [
        "Re-run the original inspection step and capture a new screenshot"
    ]
    expected = _text(raw.get("expected_outcome")) or (
        f"The {finding.defect_category.value} defect no longer appears"
    )
    selectors = _clean_list(raw.get("selectors_to_check"))
    if not selectors and finding.target_selector:
        selectors = [_text(finding.target_selector)]
    return ValidationChecklist(
        steps=steps, expected_outcome=expected, selectors_to_check=selectors,
    )


def generate_patch(
    finding: AIFinding,
    repo_root: str,
    model: VisionModel,
    evidence: Optional[EvidenceContext] = None,
    limits: PatchLimits = DEFAULT_LIMITS,
) -> PatchResult:
    """Propose a minimal, verified code fix for one defect finding.

    Args:
        finding: The defect to repair.
        repo_root: Folder of the frontend project.
        model: Provider used to generate the diff (mock or real).
        evidence: Original evidence, used for the screenshot and viewport.
            When omitted, the finding's evidence_reference is the screenshot.
        limits: Size limits for the patch.

    Returns:
        A PatchResult. Only status "proposed" carries a PatchProposal, and
        that proposal always requires human review.

    Raises:
        FileNotFoundError: If repo_root is not a folder.
        VLMError: If the model provider fails.
    """
    if finding.defect_category == DefectCategory.NONE:
        return PatchResult(STATUS_NO_DEFECT, reasons=("The finding is not a defect.",))

    matches = localize_finding(finding, repo_root, max_results=limits.max_files)
    texts, sources = _load_sources(repo_root, matches)
    if not sources:
        return PatchResult(
            STATUS_NO_SOURCE,
            reasons=("No source files matched the selector or component hint.",),
        )

    width, height, is_mobile = 1280, 720, False
    screenshot = finding.evidence_reference
    if evidence is not None:
        width, height = evidence.viewport.width, evidence.viewport.height
        is_mobile = evidence.viewport.is_mobile
        screenshot = evidence.screenshot_path

    prompt = build_repair_prompt(
        category=finding.defect_category.value,
        description=finding.description,
        sources=sources,
        target_selector=finding.target_selector,
        suggested_next_step=finding.suggested_next_step,
        viewport_width=width,
        viewport_height=height,
        is_mobile=is_mobile,
    )
    raw_reply = model.analyze(screenshot, prompt)

    try:
        data, repaired = extract_json_with_status(raw_reply)
    except ValueError:
        return PatchResult(
            STATUS_UNPARSEABLE,
            reasons=("The model reply could not be read as a patch proposal.",),
        )

    raw_changes = data.get("changes")
    if not isinstance(raw_changes, list) or not raw_changes:
        summary = _text(data.get("summary")) or "The model did not propose a change."
        return PatchResult(STATUS_DECLINED, reasons=(summary,))

    if len(raw_changes) > limits.max_files:
        return PatchResult(
            STATUS_REJECTED,
            reasons=(f"Patch touches {len(raw_changes)} files, the limit is {limits.max_files}.",),
        )

    problems: List[str] = []
    changes: List[CodeChange] = []
    seen = set()
    total_changed = 0

    for number, item in enumerate(raw_changes, start=1):
        label = f"change {number}"
        if not isinstance(item, dict):
            problems.append(f"{label}: not a valid change entry")
            continue
        path = _normalise_path(item.get("file_path"))
        diff = item.get("unified_diff")
        if path not in texts:
            problems.append(f"{label}: '{path}' was not one of the provided files")
            continue
        if path in seen:
            problems.append(f"{label}: more than one diff for '{path}'")
            continue
        seen.add(path)
        if not isinstance(diff, str) or not diff.strip():
            problems.append(f"{label} ({path}): the diff is empty")
            continue
        if len(diff) > limits.max_diff_chars:
            problems.append(f"{label} ({path}): the diff is longer than {limits.max_diff_chars} characters")
            continue
        try:
            clean_diff, changed = _apply_and_canonicalise(path, texts[path], diff)
        except ValueError as exc:
            problems.append(f"{label} ({path}): {exc}")
            continue
        total_changed += changed
        changes.append(CodeChange(
            file_path=path,
            description=_text(item.get("description")) or "Proposed change",
            unified_diff=clean_diff,
        ))

    if total_changed > limits.max_changed_lines:
        problems.append(
            f"Patch changes {total_changed} lines, the limit is {limits.max_changed_lines}."
        )
    if problems:
        return PatchResult(STATUS_REJECTED, reasons=tuple(problems))

    confidence = _clamp_confidence(data.get("confidence", 0.5))
    notes: Tuple[str, ...] = ()
    if repaired:
        confidence = min(confidence, _REPAIRED_CONFIDENCE_CAP)
        notes = ("The model reply was malformed and had to be repaired; confidence was capped.",)

    try:
        proposal = PatchProposal(
            finding_id=finding.finding_id,
            category=finding.defect_category,
            summary=_text(data.get("summary")) or "Proposed fix",
            changes=changes,
            validation=_build_checklist(data.get("validation"), finding),
            confidence=confidence,
            requires_human_review=True,
        )
    except ValidationError as exc:
        return PatchResult(STATUS_REJECTED, reasons=(f"Proposal failed validation: {exc.error_count()} error(s).",))

    return PatchResult(STATUS_PROPOSED, proposal=proposal, reasons=notes)