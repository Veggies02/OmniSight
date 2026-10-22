"""Unit tests for DOM filtering (dom_utils.py)."""
import pytest

from dom_utils import filter_dom, prepare_dom_context


def test_keeps_visible_button_and_drops_plain_text():
    dom = '<div><p>Intro text</p><button id="buy" class="btn">Buy now</button></div>'
    assert filter_dom(dom) == '<button id="buy" class="btn">Buy now</button>'


def test_hidden_attribute_is_dropped():
    dom = '<button hidden>Secret</button><button>Shown</button>'
    assert filter_dom(dom) == '<button>Shown</button>'


def test_aria_hidden_is_dropped():
    dom = '<button aria-hidden="true">Secret</button><button>Shown</button>'
    assert filter_dom(dom) == '<button>Shown</button>'


@pytest.mark.parametrize("style", ["display:none", "visibility: hidden"])
def test_inline_hidden_styles_are_dropped(style):
    dom = f'<button style="{style}">Secret</button><button>Shown</button>'
    assert filter_dom(dom) == '<button>Shown</button>'


def test_children_of_hidden_parent_are_dropped():
    dom = '<div style="display:none"><button>Inner</button></div><a href="/x">Link</a>'
    assert filter_dom(dom) == '<a href="/x">Link</a>'


def test_hidden_input_is_dropped():
    dom = '<input type="hidden" name="csrf" value="abc"><input type="text" name="q">'
    assert filter_dom(dom) == '<input type="text" name="q">'


def test_anchor_without_href_is_not_interactive():
    dom = '<a>No href</a><a href="/cart">Cart</a>'
    assert filter_dom(dom) == '<a href="/cart">Cart</a>'


def test_role_based_controls_are_kept():
    assert filter_dom('<div role="button">Menu</div>') == '<div role="button">Menu</div>'


def test_script_and_style_content_is_ignored():
    dom = '<script>var x=1</script><style>.a{}</style><button>Ok</button>'
    assert filter_dom(dom) == '<button>Ok</button>'


def test_javascript_href_is_removed():
    assert filter_dom('<a href="javascript:alert(1)">Go</a>') == '<a>Go</a>'


def test_event_handlers_are_not_output():
    assert filter_dom('<button onclick="steal()">Click</button>') == '<button>Click</button>'


def test_long_text_is_truncated():
    dom = "<button>" + "x" * 300 + "</button>"
    assert filter_dom(dom, max_text_chars=20) == "<button>" + "x" * 20 + "...</button>"


def test_duplicates_are_collapsed_with_count():
    dom = '<button class="add">Add to Cart</button>' * 3
    assert filter_dom(dom) == '<button class="add">Add to Cart</button> (x3)'


def test_node_cap_reports_omitted():
    dom = "".join(f'<button id="b{i}">B{i}</button>' for i in range(5))
    out = filter_dom(dom, max_nodes=2)
    assert out.count("<button") == 2
    assert "3 more" in out


@pytest.mark.parametrize("dom", ["", "<p>only text</p>"])
def test_no_interactive_elements_gives_empty_string(dom):
    assert filter_dom(dom) == ""


def test_malformed_html_does_not_crash():
    out = filter_dom('<div><button>Unclosed <p>text<button id="b">B')
    assert isinstance(out, str)
    assert out.count("<button") == 2
    assert "Unclosed" in out


def test_nested_text_is_collected():
    dom = "<button><span>Add</span> <b>to cart</b></button>"
    assert filter_dom(dom) == "<button>Add to cart</button>"


@pytest.mark.parametrize("dom", [None, "", "   "])
def test_prepare_returns_none_for_empty(dom):
    assert prepare_dom_context(dom) is None


def test_prepare_returns_filtered_dom():
    assert prepare_dom_context("<p>Hi</p><button>Buy</button>") == "<button>Buy</button>"


def test_prepare_falls_back_to_original_when_nothing_interactive():
    assert prepare_dom_context("<p>Only text</p>") == "<p>Only text</p>"