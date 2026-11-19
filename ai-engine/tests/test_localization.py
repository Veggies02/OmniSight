"""Unit tests for source localization (localization.py)."""
import pytest

import localization
from localization import locate_source, localize_finding, parse_selector
from schemas import AIFinding, DefectCategory

PRODUCT_TSX = "src/components/ProductCard.tsx"
PRODUCT_CSS = "src/components/ProductCard.css"
NAVBAR_TSX = "src/components/Navbar.tsx"
NAVBAR_CSS = "src/components/Navbar.css"

REPO_FILES = {
    PRODUCT_TSX: "\n".join([
        "export function ProductCard() {",
        "  return (",
        '    <div className="product-card">',
        '      <button className="add-to-cart btn">Add</button>',
        "    </div>",
        "  );",
        "}",
    ]),
    PRODUCT_CSS: ".product-card { display: flex; }\n.add-to-cart { width: 400px; }\n",
    NAVBAR_TSX: "\n".join([
        "export function Navbar() {",
        "  return (",
        '    <nav className="nav-menu" data-testid="main-nav">',
        '      <button id="hamburger" className="btn">Menu</button>',
        "    </nav>",
        "  );",
        "}",
    ]),
    NAVBAR_CSS: ".nav-menu { overflow: visible; }\n#hamburger { width: 400px; }\n",
    "src/App.tsx": "// TODO: fix add-to-cart width\nexport const App = () => null;\n",
    "src/components/ProductCard.test.tsx": 'const cls = "add-to-cart";\n',
    "node_modules/ui-lib/button.css": ".add-to-cart { color: red; }\n",
    "dist/bundle.js": 'var a = "add-to-cart";\n',
}


@pytest.fixture
def repo(tmp_path):
    for rel, content in REPO_FILES.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return str(tmp_path)


def _paths(matches):
    return [m.file_path for m in matches]


# --- parse_selector ---

def test_parse_extracts_classes_and_ids_and_ignores_pseudo():
    tokens = parse_selector("button.add-to-cart#buy:hover")
    assert tokens.classes == ("add-to-cart",)
    assert tokens.ids == ("buy",)
    assert tokens.test_ids == ()


def test_parse_extracts_testid_and_multiple_classes():
    tokens = parse_selector("div[data-testid='main-nav'] > .a.b::before")
    assert tokens.test_ids == ("main-nav",)
    assert tokens.classes == ("a", "b")
    assert tokens.ids == ()


def test_parse_ignores_negated_classes_and_attribute_values():
    assert parse_selector(".a:not(.b)").classes == ("a",)
    assert parse_selector('a[href="/x.y"]').classes == ()


@pytest.mark.parametrize("selector", [None, "", "   "])
def test_parse_empty_selector(selector):
    tokens = parse_selector(selector)
    assert tokens.classes == () and tokens.ids == () and tokens.test_ids == ()


# --- locate_source ---

def test_class_selector_prefers_stylesheet_definition(repo):
    matches = locate_source(repo, ".add-to-cart")
    assert _paths(matches) == [PRODUCT_CSS, PRODUCT_TSX]
    assert matches[0].line == 2
    assert matches[1].line == 4


def test_component_hint_boosts_matching_file(repo):
    matches = locate_source(repo, ".add-to-cart", component_hint="ProductCard.tsx")
    assert _paths(matches) == [PRODUCT_TSX, PRODUCT_CSS]
    assert matches[0].score == 6.0
    assert matches[1].score == 3.5


def test_hint_only_returns_files_with_that_name(repo):
    matches = locate_source(repo, component_hint="Navbar")
    assert set(_paths(matches)) == {NAVBAR_TSX, NAVBAR_CSS}
    assert all(m.score == 5.0 for m in matches)


def test_path_style_hint(repo):
    matches = locate_source(repo, component_hint="components/ProductCard.tsx")
    assert matches[0].file_path == PRODUCT_TSX
    assert "path matches" in matches[0].reasons[0]


def test_windows_style_hint_is_normalised(repo):
    matches = locate_source(repo, component_hint="src\\components\\ProductCard.tsx")
    assert matches[0].file_path == PRODUCT_TSX
    assert matches[0].score == 6.0


def test_id_selector(repo):
    matches = locate_source(repo, "#hamburger")
    assert _paths(matches) == [NAVBAR_CSS, NAVBAR_TSX]
    assert matches[0].line == 2


def test_testid_selector_only_matches_markup(repo):
    matches = locate_source(repo, "[data-testid='main-nav']")
    assert _paths(matches) == [NAVBAR_TSX]


def test_skips_dependency_build_and_test_files(repo):
    paths = _paths(locate_source(repo, ".add-to-cart"))
    assert not any("node_modules" in p or "dist/" in p or ".test." in p for p in paths)


def test_mentions_outside_strings_are_ignored(repo):
    assert "src/App.tsx" not in _paths(locate_source(repo, ".add-to-cart"))


def test_no_match_returns_empty_list(repo):
    assert locate_source(repo, ".does-not-exist") == []


def test_nothing_to_search_for_returns_empty_list(repo):
    assert locate_source(repo) == []
    assert locate_source(repo, selector="div") == []


def test_missing_repo_root_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        locate_source(str(tmp_path / "nope"), ".a")


def test_max_results_limits_output(repo):
    assert len(locate_source(repo, ".btn")) == 2
    assert len(locate_source(repo, ".btn", max_results=1)) == 1


def test_multiple_tokens_combine_scores(repo):
    matches = locate_source(repo, ".btn.nav-menu")
    assert _paths(matches) == [NAVBAR_TSX, NAVBAR_CSS, PRODUCT_TSX]


def test_matches_explain_themselves(repo):
    top = locate_source(repo, ".add-to-cart")[0]
    assert any("add-to-cart" in reason for reason in top.reasons)


def test_oversized_files_are_skipped(repo, monkeypatch):
    monkeypatch.setattr(localization, "MAX_FILE_BYTES", 10)
    assert locate_source(repo, ".add-to-cart") == []


def test_localize_finding_uses_selector_and_component(repo):
    finding = AIFinding(
        job_id="j1",
        defect_category=DefectCategory.MOBILE_BUTTON_CLIPPING,
        description="Button clipped",
        evidence_reference="a.png",
        confidence=0.9,
        target_selector=".add-to-cart",
        target_component="ProductCard.tsx",
    )
    assert localize_finding(finding, repo)[0].file_path == PRODUCT_TSX