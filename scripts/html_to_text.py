#!/usr/bin/env python3
"""Convert an HTML page into readable Markdown-ish text.

Only the Python standard library is used (no third-party packages anywhere in
this project). Used by scripts/fetch-docs.sh so that official documentation
pages that are only published as HTML get a greppable local copy.
"""

from __future__ import annotations

import html
import re
import sys
from html.parser import HTMLParser

SKIP_TAGS = {
    "script", "style", "noscript", "svg", "template", "iframe", "head",
    "nav", "form", "footer", "aside", "select", "button",
    # Google devsite chrome (breadcrumbs, announcement banner, table of contents)
    "devsite-banner", "devsite-breadcrumb", "devsite-toc", "devsite-content-footer",
}
HEADINGS = {f"h{i}": i for i in range(1, 7)}
VOID_TAGS = {"br", "hr", "img", "input", "meta", "link", "source", "col"}
BLOCK_TAGS = {
    "p", "div", "section", "article", "main", "header", "footer", "nav",
    "aside", "figure", "figcaption", "form", "blockquote", "dl", "dt", "dd",
    "table", "thead", "tbody", "tfoot", "tr", "ul", "ol", "pre", "details",
    "summary", "address", "fieldset", "hgroup",
}


class Converter(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0
        self.pre = 0
        self.link_stack: list[str] = []
        self.heading_level = 0
        self.li_depth = 0

    # -- helpers ---------------------------------------------------------
    def emit(self, text: str) -> None:
        if self.skip:
            return
        self.parts.append(text)

    def newline(self, count: int = 1) -> None:
        if self.skip or self.pre:
            return
        tail = "".join(self.parts[-3:])
        if tail.endswith("\n" * count):
            return
        self.parts.append("\n" * count)

    # -- parser callbacks ------------------------------------------------
    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag in SKIP_TAGS:
            self.skip += 1
            return
        if self.skip:
            return
        attrd = {k.lower(): (v or "") for k, v in attrs}

        if tag in HEADINGS:
            self.newline(2)
            self.heading_level = HEADINGS[tag]
            self.emit("#" * self.heading_level + " ")
        elif tag == "pre":
            self.newline(2)
            self.emit("```\n")
            self.pre += 1
        elif tag == "code" and not self.pre:
            self.emit("`")
        elif tag == "li":
            self.newline(1)
            self.emit("  " * self.li_depth + "- ")
        elif tag in {"ul", "ol"}:
            self.newline(1)
            self.li_depth += 1
        elif tag == "br":
            self.newline(1)
        elif tag == "hr":
            self.newline(2)
            self.emit("---")
            self.newline(2)
        elif tag == "a":
            self.link_stack.append(attrd.get("href", ""))
            self.emit("[")
        elif tag in {"td", "th"}:
            self.emit(" | ")
        elif tag == "img":
            alt = attrd.get("alt", "").strip()
            if alt:
                self.emit(f"[{alt}]")
        elif tag in BLOCK_TAGS:
            self.newline(2 if tag != "tr" else 1)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return

        if tag in HEADINGS:
            self.heading_level = 0
            self.newline(2)
        elif tag == "pre":
            self.pre = max(0, self.pre - 1)
            self.newline(1)
            self.emit("```")
            self.newline(2)
        elif tag == "code" and not self.pre:
            self.emit("`")
        elif tag in {"ul", "ol"}:
            self.li_depth = max(0, self.li_depth - 1)
            self.newline(1)
        elif tag == "a":
            href = self.link_stack.pop() if self.link_stack else ""
            if href.startswith(("http://", "https://", "/")):
                self.emit(f"]({href})")
            else:
                self.emit("]")
        elif tag in BLOCK_TAGS:
            self.newline(2 if tag != "tr" else 1)
        elif tag in VOID_TAGS:
            pass

    def handle_data(self, data: str) -> None:
        if self.skip or not data:
            return
        if self.pre:
            self.parts.append(data)
            return
        collapsed = re.sub(r"[ \t\r\f\v]+", " ", data)
        if collapsed.strip() == "" and not collapsed.strip(" "):
            # Keep a single space so inline words do not glue together.
            if self.parts and not self.parts[-1].endswith((" ", "\n")):
                self.parts.append(" ")
            return
        self.parts.append(collapsed)


def main_content(raw: str) -> str:
    """Keep only the document's main content region when the page marks one.

    Documentation sites wrap the article in <article> or <main> and surround it
    with navigation, language pickers and search boxes. Slicing to that element
    keeps the mirror readable and greppable.
    """
    lowered = raw.lower()
    for tag in ("article", "main"):
        start = lowered.find(f"<{tag}")
        end = lowered.rfind(f"</{tag}>")
        if start != -1 and end > start:
            return raw[start:end]
    body = lowered.find("<body")
    if body != -1:
        return raw[body:]
    return raw


def convert(raw: str) -> str:
    raw = main_content(raw)
    parser = Converter()
    parser.feed(raw)
    parser.close()
    text = "".join(parser.parts)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" +", " ", text)
    return text.strip() + "\n"


def main() -> int:
    raw = sys.stdin.read()
    sys.stdout.write(convert(raw))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
