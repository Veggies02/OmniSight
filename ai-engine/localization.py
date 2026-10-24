"""Source localization: map a defective element to the files most likely behind it.

Given a CSS selector (and optionally a component or file name hint from the
model), search a frontend repository for the stylesheet rules and React/HTML
markup that mention the same classes, ids or test ids, and return ranked
candidates with line numbers and reasons.

This module only reads files. It never modifies anything. Whether a patch may
touch a file is decided later by the patch scope validator.

Limits: the search is textual. It does not understand CSS Modules renames,
styled-components, Tailwind utility classes or classes built at runtime, and
it only sees names written inside quoted strings on a single line.
"""
import os
import re
from dataclasses import dataclass
from typing import Dict, Iterator, List, Optional, Tuple

from schemas import AIFinding

DEFAULT_MAX_RESULTS = 5
MAX_FILE_BYTES = 300_000

_SKIP_DIRS = frozenset({
    "node_modules", "dist", "build", "coverage", "venv", "__pycache__", "__tests__",
})
_STYLE_EXTENSIONS = frozenset({".css", ".scss", ".sass", ".less"})
_MARKUP_EXTENSIONS = frozenset({
    ".tsx", ".jsx", ".ts", ".js", ".html", ".vue", ".svelte",
})

_STYLE_WEIGHT = 3.0
_MARKUP_WEIGHT = 2.0
_TESTID_WEIGHT = 3.0
_PATH_WEIGHT = 6.0
_EXACT_FILE_WEIGHT = 5.0
_PARTIAL_FILE_WEIGHT = 2.0

_ATTRIBUTE = re.compile(r"\[[^\]]*\]")
_PSEUDO = re.compile(r":{1,2}[\w-]+(?:\([^)]*\))?")
_CLASS = re.compile(r"\.(-?[_a-zA-Z][\w-]*)")
_ID = re.compile(r"#(-?[_a-zA-Z][\w-]*)")
_TESTID = re.compile(r"""\[\s*data-testid\s*=\s*["']?([^"'\]\s]+)["']?\s*\]""")
_STRING = re.compile(r"""\"[^\"\n]*\"|'[^'\n]*'|`[^`\n]*`""")


@dataclass(frozen=True)
class SelectorTokens:
    """The searchable names found in a CSS selector."""

    classes: Tuple[str, ...] = ()
    ids: Tuple[str, ...] = ()
    test_ids: Tuple[str, ...] = ()


@dataclass(frozen=True)
class LocalizationMatch:
    """A candidate source file for a defect."""

    file_path: str          # relative to the repo root, with forward slashes
    score: float            # higher means a stronger match
    line: Optional[int]     # best matching line when the selector matched
    reasons: Tuple[str, ...]


def _unique(items) -> Tuple[str, ...]:
    return tuple(dict.fromkeys(items))


def parse_selector(selector: Optional[str]) -> SelectorTokens:
    """Extract class names, ids and data-testid values from a CSS selector.

    Tag names, pseudo-classes (including anything inside :not(...)) and
    attribute values are ignored, since they do not identify a source file.
    """
    if not selector or not isinstance(selector, str):
        return SelectorTokens()

    test_ids = _unique(_TESTID.findall(selector))
    cleaned = _PSEUDO.sub("", _ATTRIBUTE.sub("", selector))
    return SelectorTokens(
        classes=_unique(_CLASS.findall(cleaned)),
        ids=_unique(_ID.findall(cleaned)),
        test_ids=test_ids,
    )


def _iter_source_files(repo_root: str) -> Iterator[Tuple[str, str, bool]]:
    """Yield (relative_path, text, is_stylesheet) for each searchable file."""
    for dirpath, dirnames, filenames in os.walk(repo_root):
        dirnames[:] = sorted(
            d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".")
        )
        for name in sorted(filenames):
            lower = name.lower()
            ext = os.path.splitext(lower)[1]
            is_style = ext in _STYLE_EXTENSIONS
            if not (is_style or ext in _MARKUP_EXTENSIONS):
                continue
            if ".min." in lower or ".test." in lower or ".spec." in lower:
                continue
            full = os.path.join(dirpath, name)
            try:
                if os.path.getsize(full) > MAX_FILE_BYTES:
                    continue
                with open(full, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
            except OSError:
                continue
            rel = os.path.relpath(full, repo_root).replace(os.sep, "/")
            yield rel, text, is_style


def _normalise_hint(hint: Optional[str]) -> Optional[str]:
    if not isinstance(hint, str):
        return None
    cleaned = hint.strip().replace("\\", "/")
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    return cleaned or None


def _hint_score(rel: str, hint: str) -> Tuple[float, str]:
    """Score how well a file path matches a component or file name hint."""
    rel_l = rel.lower()
    hint_l = hint.lower()

    if "/" in hint_l and (rel_l == hint_l or rel_l.endswith("/" + hint_l)):
        return _PATH_WEIGHT, f'path matches component hint "{hint}"'

    hint_base = os.path.basename(hint_l)
    file_base = os.path.basename(rel_l)
    hint_stem, hint_ext = os.path.splitext(hint_base)
    file_stem = os.path.splitext(file_base)[0]
    if not hint_stem:
        return 0.0, ""

    if hint_ext and file_base == hint_base:
        return _EXACT_FILE_WEIGHT, f'file name matches component hint "{hint}"'
    if not hint_ext and file_stem == hint_stem:
        return _EXACT_FILE_WEIGHT, f'file name matches component hint "{hint}"'
    if file_stem == hint_stem:
        return _PARTIAL_FILE_WEIGHT, f'same name as component hint "{hint}" (different file type)'
    if (
        len(hint_stem) >= 4
        and len(file_stem) >= 4
        and (hint_stem in file_stem or file_stem in hint_stem)
    ):
        return _PARTIAL_FILE_WEIGHT, f'file name resembles component hint "{hint}"'
    return 0.0, ""


def locate_source(
    repo_root: str,
    selector: Optional[str] = None,
    component_hint: Optional[str] = None,
    max_results: int = DEFAULT_MAX_RESULTS,
) -> List[LocalizationMatch]:
    """Find the source files most likely responsible for a defective element.

    Args:
        repo_root: Folder of the frontend project to search.
        selector: CSS selector of the defective element, if known.
        component_hint: Component or file name suggested by the model.
        max_results: Maximum number of candidates to return.

    Returns:
        Candidates ordered from most to least likely. Empty when the selector
        and hint give nothing to search for, or nothing matches.

    Raises:
        FileNotFoundError: If repo_root is not a folder.
    """
    if not os.path.isdir(repo_root):
        raise FileNotFoundError(f"Repo root not found: {repo_root}")

    parsed = parse_selector(selector)
    tokens: List[Tuple[str, str]] = (
        [("class", n) for n in parsed.classes]
        + [("id", n) for n in parsed.ids]
        + [("data-testid", n) for n in parsed.test_ids]
    )
    hint = _normalise_hint(component_hint)
    if not tokens and hint is None:
        return []

    word = {
        t: re.compile(rf"(?<![\w-]){re.escape(t[1])}(?![\w-])") for t in tokens
    }
    style = {}
    for kind, name in tokens:
        if kind == "class":
            style[(kind, name)] = re.compile(rf"\.{re.escape(name)}(?![\w-])")
        elif kind == "id":
            style[(kind, name)] = re.compile(rf"#{re.escape(name)}(?![\w-])")

    hits: Dict[Tuple[str, str], Dict[str, Tuple[float, int, str]]] = {t: {} for t in tokens}
    direct: Dict[str, Tuple[float, str]] = {}

    for rel, text, is_style in _iter_source_files(repo_root):
        if hint:
            hint_score, hint_reason = _hint_score(rel, hint)
            if hint_score:
                direct[rel] = (hint_score, hint_reason)
        if not tokens:
            continue

        for line_no, line in enumerate(text.splitlines(), start=1):
            if is_style:
                for t in tokens:
                    pattern = style.get(t)
                    if pattern and rel not in hits[t] and pattern.search(line):
                        marker = "." if t[0] == "class" else "#"
                        hits[t][rel] = (_STYLE_WEIGHT, line_no, f"styles {marker}{t[1]}")
            else:
                segments = _STRING.findall(line)
                if not segments:
                    continue
                for t in tokens:
                    if rel in hits[t]:
                        continue
                    if any(word[t].search(seg) for seg in segments):
                        weight = _TESTID_WEIGHT if t[0] == "data-testid" else _MARKUP_WEIGHT
                        hits[t][rel] = (weight, line_no, f'uses {t[0]} "{t[1]}"')

    scores: Dict[str, float] = {}
    reasons: Dict[str, List[str]] = {}
    best_line: Dict[str, Tuple[float, int]] = {}

    # A name found in many files tells us less, so its weight is shared out.
    for per_file in hits.values():
        spread = len(per_file)
        for rel, (weight, line_no, reason) in per_file.items():
            share = weight / spread
            scores[rel] = scores.get(rel, 0.0) + share
            reasons.setdefault(rel, []).append(reason)
            if rel not in best_line or share > best_line[rel][0]:
                best_line[rel] = (share, line_no)

    for rel, (hint_score, hint_reason) in direct.items():
        scores[rel] = scores.get(rel, 0.0) + hint_score
        reasons.setdefault(rel, []).append(hint_reason)

    matches = [
        LocalizationMatch(
            file_path=rel,
            score=round(score, 2),
            line=best_line[rel][1] if rel in best_line else None,
            reasons=tuple(reasons[rel]),
        )
        for rel, score in scores.items()
    ]
    matches.sort(key=lambda m: (-m.score, m.file_path))
    return matches[:max(0, max_results)]


def localize_finding(
    finding: AIFinding,
    repo_root: str,
    max_results: int = DEFAULT_MAX_RESULTS,
) -> List[LocalizationMatch]:
    """Locate source files for a finding using its selector and component hint."""
    return locate_source(
        repo_root,
        selector=finding.target_selector,
        component_hint=finding.target_component,
        max_results=max_results,
    )