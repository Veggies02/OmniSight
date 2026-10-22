"""DOM filtering for context window optimisation.

Raw page HTML can be huge and mostly irrelevant to visual defects. This
module keeps only the visible, interactive elements (buttons, links, inputs
and similar) in a compact form, so the model gets a short, useful excerpt
instead of the whole page.

Limits: this works on the HTML text only. It cannot see hiding done through
CSS classes, off-screen positioning or overlap. Those cases are what the
screenshot is for.
"""
import html
import re
from html.parser import HTMLParser
from typing import Optional

DEFAULT_MAX_NODES = 30
DEFAULT_MAX_TEXT_CHARS = 80
MAX_ATTR_CHARS = 100

_VOID_TAGS = frozenset({
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
})
_IGNORED_TAGS = frozenset({"script", "style", "template", "noscript", "head", "title"})
_INTERACTIVE_TAGS = frozenset({"button", "select", "textarea", "summary"})
_INTERACTIVE_ROLES = frozenset({
    "button", "link", "tab", "menuitem", "checkbox", "radio", "switch",
    "combobox", "textbox", "searchbox", "option", "slider",
})
_KEPT_ATTRS = frozenset({
    "id", "class", "type", "name", "role", "aria-label", "aria-expanded",
    "href", "placeholder", "title", "disabled",
})
_BLOCKED_HREF_SCHEMES = ("javascript:", "data:", "vbscript:")
_HIDDEN_STYLE = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden", re.IGNORECASE)


class _Node:
    """An interactive element found in the page, with its collected text."""

    __slots__ = ("tag", "attr_list", "parts")

    def __init__(self, tag, attr_list):
        self.tag = tag
        self.attr_list = attr_list
        self.parts = []


class _InteractiveExtractor(HTMLParser):
    """Walks the HTML and records visible interactive elements in order."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []        # open elements: [tag, is_hidden, node_or_None]
        self.hidden_open = 0   # how many hidden elements are currently open
        self.nodes = []

    @staticmethod
    def _is_hidden(tag, attrs):
        if tag in _IGNORED_TAGS:
            return True
        if "hidden" in attrs:
            return True
        if attrs.get("aria-hidden", "").strip().lower() == "true":
            return True
        if tag == "input" and attrs.get("type", "").strip().lower() == "hidden":
            return True
        return bool(_HIDDEN_STYLE.search(attrs.get("style", "")))

    @staticmethod
    def _is_interactive(tag, attrs):
        if tag in _INTERACTIVE_TAGS or tag == "input":
            return True
        if tag == "a":
            return "href" in attrs
        if attrs.get("role", "").strip().lower() in _INTERACTIVE_ROLES:
            return True
        return "onclick" in attrs

    def handle_starttag(self, tag, attr_list):
        attrs = {name: (value or "") for name, value in attr_list}
        hidden = self._is_hidden(tag, attrs)
        visible = self.hidden_open == 0 and not hidden

        node = None
        if visible and self._is_interactive(tag, attrs):
            node = _Node(tag, attr_list)
            self.nodes.append(node)

        if tag in _VOID_TAGS:
            return  # no end tag, so nothing to track
        self.stack.append([tag, hidden, node])
        if hidden:
            self.hidden_open += 1

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                for entry in self.stack[i:]:
                    if entry[1]:
                        self.hidden_open -= 1
                del self.stack[i:]
                return
        # A stray end tag with no matching open element is ignored.

    def handle_data(self, data):
        if self.hidden_open:
            return
        for entry in self.stack:
            if entry[2] is not None:
                entry[2].parts.append(data)


def _render_node(node: _Node, max_text_chars: int) -> str:
    """Render one interactive element as a compact HTML tag."""
    attrs = []
    for name, raw_value in node.attr_list:
        if name not in _KEPT_ATTRS:
            continue
        value = (raw_value or "").strip()
        if not value:
            if name == "disabled":
                attrs.append(" disabled")
            continue
        if name == "href":
            compact = re.sub(r"[\x00-\x20]+", "", value).lower()
            if compact.startswith(_BLOCKED_HREF_SCHEMES):
                continue
        if len(value) > MAX_ATTR_CHARS:
            value = value[:MAX_ATTR_CHARS] + "..."
        attrs.append(f' {name}="{html.escape(value, quote=True)}"')

    open_tag = f"<{node.tag}{''.join(attrs)}>"
    if node.tag in _VOID_TAGS:
        return open_tag

    text = " ".join("".join(node.parts).split())
    if len(text) > max_text_chars:
        text = text[:max_text_chars].rstrip() + "..."
    return f"{open_tag}{html.escape(text, quote=False)}</{node.tag}>"


def filter_dom(
    dom: str,
    max_nodes: int = DEFAULT_MAX_NODES,
    max_text_chars: int = DEFAULT_MAX_TEXT_CHARS,
) -> str:
    """Reduce page HTML to a compact list of visible, interactive elements.

    One element per line, in document order. Identical elements are collapsed
    into one line with a count, and at most max_nodes lines are returned.
    Returns an empty string when the input has no visible interactive elements.
    """
    if not dom or not isinstance(dom, str) or not dom.strip():
        return ""

    parser = _InteractiveExtractor()
    try:
        parser.feed(dom)
        parser.close()
    except Exception:
        # Badly broken markup: keep whatever was found before the problem.
        pass

    counts = {}
    for node in parser.nodes:
        line = _render_node(node, max_text_chars)
        counts[line] = counts.get(line, 0) + 1
    if not counts:
        return ""

    items = list(counts.items())
    lines = [
        f"{line} (x{count})" if count > 1 else line
        for line, count in items[:max_nodes]
    ]
    omitted = len(items) - max_nodes
    if omitted > 0:
        lines.append(f"... [{omitted} more interactive elements omitted]")
    return "\n".join(lines)


def prepare_dom_context(dom: Optional[str]) -> Optional[str]:
    """Prepare a DOM snippet for the prompt.

    Returns the filtered excerpt, or the original snippet when it contains no
    interactive elements (so text-only context is not lost), or None when
    there is no snippet at all.
    """
    if not dom or not dom.strip():
        return None
    return filter_dom(dom) or dom