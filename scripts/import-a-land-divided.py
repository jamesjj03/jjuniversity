#!/usr/bin/env python3
"""Build the canonical JJ University Reader document for A Land Divided.

The original PDF is read only. The importer accepts exactly the reviewed
September 23, 2025 Calibre export, rebuilds paragraphs from its indentation,
retains the PDF's italic and bold runs, and allows only the text changes listed
in OPENING_CASE_CHANGES and AUTHOR_NOTE_AFTER.

Run without --write to verify that the checked-in outputs still match the
reviewed source. Run with --write to refresh the local catalog, content
manifest, canonical book JSON, and source receipt. This script never connects
to Supabase and never deploys anything.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import pdfplumber
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path(r"C:\Users\james\Documents\PDFs\A Land Divided.pdf")
EXPECTED_SOURCE_SHA256 = "7a4d20fdd116824485ddf1455904b78702b7c9036ade9db1155db04db16cbbde"
EXPECTED_SOURCE_BYTES = 238_056
EXPECTED_PAGE_COUNT = 40
SOURCE_CREATED_AT = "2025-09-23T21:32:44.000Z"

BOOK_ID = "isrpal"
BOOK_SLUG = "a-land-divided"
BOOK_TITLE = "A Land Divided"
BOOK_SUBTITLE = "How Israel and Palestine Became a Forever War"
BOOK_CREATOR = "James Johnson"
BOOK_DESCRIPTION = (
    "A short history of Israel and Palestine, covering Ottoman rule, Zionism, partition, "
    "occupation, intifada, and the long failure to make peace."
)

CATALOG_PATH = ROOT / "private" / "catalog" / "books.json"
MANIFEST_PATH = ROOT / "private" / "book-content" / "manifest.json"
CONTENT_PATH = ROOT / "private" / "book-content" / f"{BOOK_ID}.json"
RECEIPT_PATH = ROOT / "private" / "source-receipts" / f"{BOOK_ID}.json"
COVER_PATH = ROOT / "public" / "covers-webp" / "IsrPal.webp"

EXPECTED_OUTLINE = [
    "A Land Divided",
    "Dedication",
    "Prologue",
    "Chapter One - Before the Borders",
    "Chapter Two - The Zionist Dream",
    "Chapter Three - The British Mandate",
    "Chapter Four - Partition and War",
    "Chapter Five - The Shifting Lines",
    "Chapter Six - Resistance and Terror",
    "Chapter Seven - Intifada",
    "Chapter Eight - A Nation Divided",
    "Chapter Nine - The Modern War",
    "Chapter Ten - Life on the Ground",
    "Chapter Eleven - Blame and Belief",
    "Chapter Twelve - What Comes Next?",
    "Acknowledgments",
    "About the Author",
    "Copyright",
]

OPENING_CASE_CHANGES = {
    "Prologue": ("THERE ARE FEW", "There are few"),
    "Chapter One - Before the Borders": ("BEFORE THE WARS", "Before the wars"),
    "Chapter Two - The Zionist Dream": ("ZIONISM DIDN’T START", "Zionism didn’t start"),
    "Chapter Three - The British Mandate": ("WORLD WAR I", "World War I"),
    "Chapter Four - Partition and War": ("BY THE END", "By the end"),
    "Chapter Five - The Shifting Lines": ("BY THE 1960S", "By the 1960s"),
    "Chapter Six - Resistance and Terror": ("BY THE 1970S", "By the 1970s"),
    "Chapter Seven - Intifada": ("BY THE LATE 1980s", "By the late 1980s"),
    "Chapter Eight - A Nation Divided": ("IT WAS SUPPOSED", "It was supposed"),
    "Chapter Nine - The Modern War": ("WAR DOESN’T COME", "War doesn’t come"),
    "Chapter Ten - Life on the Ground": ("ASK AN OUTSIDER", "Ask an outsider"),
    "Chapter Eleven - Blame and Belief": ("THE EASIEST THING", "The easiest thing"),
    "Chapter Twelve - What Comes Next?": ("THERE’S A PHRASE", "There’s a phrase"),
}

AUTHOR_NOTE_BEFORE = (
    "JJ IS THE author of over 190 books across history, politics, culture, and human conflict. "
    "His work focuses on the systems we build, the stories we tell, and the people caught in between. "
    "He writes to understand — and to help others do the same. "
    "For more books, visit: jjarchives.com"
)
AUTHOR_NOTE_AFTER = (
    "James Johnson writes about history, power, culture, belief, science, and everyday life. "
    "JJ University is home to more than 300 of his books. "
    "Read the library at jjuniversity.com."
)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def compact_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def word_count(value: str) -> int:
    return len(compact_text(value).split()) if compact_text(value) else 0


def plain_text(value: str) -> str:
    with_block_spaces = re.sub(r"</?(?:p|h[1-6]|div|br)\b[^>]*>", " ", value, flags=re.IGNORECASE)
    without_tags = re.sub(r"<[^>]+>", "", with_block_spaces)
    return compact_text(html.unescape(without_tags))


def flatten_outline(items: Iterable[Any]) -> list[Any]:
    result: list[Any] = []
    for item in items:
        if isinstance(item, list):
            result.extend(flatten_outline(item))
        else:
            result.append(item)
    return result


def style_for_char(character: dict[str, Any]) -> str:
    font = str(character.get("fontname") or "").lower()
    bold = "bold" in font
    italic = "italic" in font or "oblique" in font
    if bold and italic:
        return "bold-italic"
    if bold:
        return "bold"
    if italic:
        return "italic"
    return "normal"


def wrap_style(value: str, style: str) -> str:
    escaped = html.escape(value, quote=False)
    if style == "bold-italic":
        return f"<strong><em>{escaped}</em></strong>"
    if style == "bold":
        return f"<strong>{escaped}</strong>"
    if style == "italic":
        return f"<em>{escaped}</em>"
    return escaped


def styled_line_html(line: dict[str, Any], replacement_text: str | None = None) -> str:
    source_text = str(line["text"])
    target_text = replacement_text if replacement_text is not None else source_text
    if len(source_text) != len(target_text):
        raise RuntimeError(f"A styled line replacement changed its length: {source_text!r}")

    characters = list(line.get("chars") or [])
    char_index = 0
    styles: list[str | None] = []
    for source_character in source_text:
        if source_character.isspace():
            styles.append(None)
            continue
        if char_index >= len(characters):
            raise RuntimeError(f"PDF style data ended early for line: {source_text!r}")
        extracted = str(characters[char_index].get("text") or "")
        if extracted != source_character:
            raise RuntimeError(
                f"PDF text/style alignment failed for {source_text!r}: "
                f"expected {source_character!r}, found {extracted!r}"
            )
        styles.append(style_for_char(characters[char_index]))
        char_index += 1
    if char_index != len(characters):
        raise RuntimeError(f"Unused PDF style data remained for line: {source_text!r}")

    for index, style in enumerate(styles):
        if style is not None:
            continue
        left = next((styles[position] for position in range(index - 1, -1, -1) if styles[position] is not None), "normal")
        right = next((styles[position] for position in range(index + 1, len(styles)) if styles[position] is not None), "normal")
        styles[index] = left if left == right else "normal"

    output: list[str] = []
    start = 0
    while start < len(target_text):
        style = str(styles[start] or "normal")
        end = start + 1
        while end < len(target_text) and str(styles[end] or "normal") == style:
            end += 1
        output.append(wrap_style(target_text[start:end], style))
        start = end
    return "".join(output)


def join_text_lines(lines: list[dict[str, Any]]) -> str:
    output = ""
    for line in lines:
        value = str(line["text"]).strip()
        if not output:
            output = value
        elif output.endswith("-") and value and value[0].isalpha():
            output += value
        else:
            output += f" {value}"
    return compact_text(output)


def join_html_lines(lines: list[dict[str, Any]]) -> str:
    output = ""
    for line in lines:
        value = str(line["renderedHtml"])
        if not output:
            output = value
        elif str(line["previousText"]).endswith("-") and str(line["text"])[:1].isalpha():
            output += value
        else:
            output += f" {value}"
    return output.strip()


def paragraph_lines(lines: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    paragraphs: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for line in lines:
        starts_paragraph = float(line.get("x0") or 0) >= 90.0
        if current and starts_paragraph:
            paragraphs.append(current)
            current = []
        current.append(line)
    if current:
        paragraphs.append(current)
    return paragraphs


def body_html(lines: list[dict[str, Any]]) -> str:
    rendered: list[str] = []
    for paragraph in paragraph_lines(lines):
        previous = ""
        prepared: list[dict[str, Any]] = []
        for line in paragraph:
            prepared.append({
                **line,
                "previousText": previous,
                "renderedHtml": styled_line_html(line, str(line.get("renderedText") or line["text"])),
            })
            previous = str(line["text"])
        rendered.append(f"<p>{join_html_lines(prepared)}</p>")
    return "\n".join(rendered)


def source_heading_lines(title: str) -> tuple[int, str, str]:
    if title.startswith("Chapter "):
        label, subtitle = title.split(" - ", 1)
        return 2, label, subtitle
    if title in {"Prologue", "Acknowledgments", "About the Author", "Copyright"}:
        return 1, title, ""
    return 0, "", ""


def source_section_text(title: str, heading: str, subtitle: str, lines: list[dict[str, Any]]) -> str:
    parts = [heading, subtitle, join_text_lines(lines)]
    return compact_text(" ".join(part for part in parts if part))


def section_kind(title: str) -> str:
    if title == BOOK_TITLE:
        return "title"
    if title == "Dedication":
        return "dedication"
    if title == "Prologue":
        return "prologue"
    if title.startswith("Chapter "):
        return "chapter"
    if title == "Acknowledgments":
        return "acknowledgments"
    if title == "About the Author":
        return "about-author"
    if title == "Copyright":
        return "copyright"
    return "section"


def heading_html(heading: str, subtitle: str) -> str:
    if heading.startswith("Chapter "):
        return (
            '<div class="chapter-title">\n'
            f'<h2 class="bordered-title"><span style="text-transform:uppercase;">{html.escape(heading.upper())}</span></h2>\n'
            f'<h3 class="subtitle"><em>{html.escape(subtitle)}</em></h3>\n'
            '<p class="separator"><br></p>'
        )
    return f'<h2 class="page-title">{html.escape(heading.upper())}</h2>'


def build_pdf_sections(source: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    reader = PdfReader(str(source))
    if len(reader.pages) != EXPECTED_PAGE_COUNT:
        raise RuntimeError(f"Expected {EXPECTED_PAGE_COUNT} PDF pages, found {len(reader.pages)}.")
    outline = flatten_outline(reader.outline)
    titles = [str(item.title) for item in outline]
    if titles != EXPECTED_OUTLINE:
        raise RuntimeError(f"The PDF outline changed. Expected {EXPECTED_OUTLINE!r}, found {titles!r}.")

    destinations = [(str(item.title), reader.get_destination_page_number(item)) for item in outline]
    extracted: list[dict[str, Any]] = []
    source_records: list[dict[str, Any]] = []
    with pdfplumber.open(str(source)) as document:
        for outline_index, (title, start_page) in enumerate(destinations):
            end_page = destinations[outline_index + 1][1] if outline_index + 1 < len(destinations) else len(document.pages)
            lines: list[dict[str, Any]] = []
            for page_index in range(start_page, end_page):
                page_lines = document.pages[page_index].extract_text_lines(
                    layout=False,
                    strip=True,
                    return_chars=True,
                )
                lines.extend({**line, "pageIndex": page_index} for line in page_lines)

            remove_count, heading, subtitle = source_heading_lines(title)
            if remove_count:
                source_heading = heading.upper()
                expected_headings = [source_heading] + ([subtitle] if subtitle else [])
                observed = [str(line["text"]) for line in lines[:remove_count]]
                if observed != expected_headings:
                    raise RuntimeError(f"Unexpected heading lines for {title}: {observed!r}")
                lines = lines[remove_count:]
            else:
                source_heading = heading

            original_text = source_section_text(title, source_heading, subtitle, lines)
            source_records.append({
                "title": title,
                "pageStart": start_page + 1,
                "pageEnd": end_page,
                "text": original_text,
            })

            if title == BOOK_TITLE:
                observed = [str(line["text"]) for line in lines]
                expected = [BOOK_TITLE, BOOK_SUBTITLE, f"by {BOOK_CREATOR}"]
                if observed != expected:
                    raise RuntimeError(f"Unexpected title page: {observed!r}")
                section_html = (
                    f'<p><strong>{BOOK_TITLE}</strong><br><em>{BOOK_SUBTITLE}</em></p>\n'
                    f'<p>by <strong>{BOOK_CREATOR}</strong></p>'
                )
            elif title == "Dedication":
                section_html = f"<p>{'<br>'.join(html.escape(str(line['text']), quote=False) for line in lines)}</p>"
            elif title == "About the Author":
                if compact_text(original_text.replace("ABOUT THE AUTHOR ", "", 1)) != AUTHOR_NOTE_BEFORE:
                    raise RuntimeError("The source author note changed; review it before updating the approved replacement.")
                section_html = (
                    '<h2 class="page-title">ABOUT THE AUTHOR</h2>\n'
                    f"<p>{html.escape(AUTHOR_NOTE_AFTER, quote=False)}</p>"
                )
            else:
                case_change = OPENING_CASE_CHANGES.get(title)
                if case_change:
                    before, after = case_change
                    first_text = str(lines[0]["text"])
                    if not first_text.startswith(before):
                        raise RuntimeError(f"Expected opening {before!r} in {title}, found {first_text!r}.")
                    lines[0] = {**lines[0], "renderedText": after + first_text[len(before):]}
                section_html = f"{heading_html(heading, subtitle)}\n{body_html(lines)}"
                if heading.startswith("Chapter "):
                    section_html += "\n</div>"

            section_text = plain_text(section_html)
            expected_text = original_text
            if title in OPENING_CASE_CHANGES:
                before, after = OPENING_CASE_CHANGES[title]
                expected_text = expected_text.replace(before, after, 1)
            elif title == "About the Author":
                expected_text = f"ABOUT THE AUTHOR {AUTHOR_NOTE_AFTER}"
            if section_text != compact_text(expected_text):
                raise RuntimeError(
                    f"Rendered text drifted in {title}.\nExpected: {compact_text(expected_text)!r}\nObserved: {section_text!r}"
                )

            extracted.append({
                "id": f"section-{outline_index + 2:03d}",
                "index": outline_index + 1,
                "title": title,
                "kind": section_kind(title),
                "html": section_html,
                "text": section_text,
                "wordCount": word_count(section_text),
            })
    return extracted, source_records


def toc_section(sections: list[dict[str, Any]]) -> dict[str, Any]:
    items = "\n".join(
        f'  <li><a href="#{html.escape(str(section["id"]))}">{html.escape(str(section["title"]))}</a></li>'
        for section in sections
    )
    toc_html = f'<nav epub:type="toc" id="toc">\n<h2 class="page-title">Contents</h2>\n<ol>\n{items}\n</ol>\n</nav>'
    toc_text = plain_text(toc_html)
    return {
        "id": "section-001",
        "index": 0,
        "title": "Contents",
        "kind": "toc",
        "html": toc_html,
        "text": toc_text,
        "wordCount": word_count(toc_text),
    }


def build_content(source: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    source_bytes = source.read_bytes()
    source_hash = sha256_bytes(source_bytes)
    if source_hash != EXPECTED_SOURCE_SHA256:
        raise RuntimeError(
            f"Refusing an unreviewed source. Expected SHA-256 {EXPECTED_SOURCE_SHA256}, found {source_hash}."
        )
    if len(source_bytes) != EXPECTED_SOURCE_BYTES:
        raise RuntimeError(f"Expected {EXPECTED_SOURCE_BYTES} source bytes, found {len(source_bytes)}.")

    body_sections, source_records = build_pdf_sections(source)
    sections = [toc_section(body_sections), *body_sections]
    for index, section in enumerate(sections):
        if section["index"] != index or section["id"] != f"section-{index + 1:03d}":
            raise RuntimeError("The generated section sequence is not contiguous.")

    total_words = sum(int(section["wordCount"]) for section in sections)
    content = {
        "id": BOOK_ID,
        "slug": BOOK_SLUG,
        "sourceFile": source.name,
        "title": BOOK_TITLE,
        "creator": BOOK_CREATOR,
        "description": BOOK_DESCRIPTION,
        "language": "en",
        "publisher": "JJ University",
        "generatedAt": SOURCE_CREATED_AT,
        "sectionCount": len(sections),
        "wordCount": total_words,
        "sections": sections,
    }

    source_text = "\n\n".join(record["text"] for record in source_records)
    canonical_text = "\n\n".join(section["text"] for section in sections[1:])
    copyright_source = next(record["text"] for record in source_records if record["title"] == "Copyright")
    copyright_output = next(section["text"] for section in sections if section["title"] == "Copyright")
    if copyright_source != copyright_output:
        raise RuntimeError("The 2025 copyright section changed unexpectedly.")

    existing_receipt: dict[str, Any] = {}
    if RECEIPT_PATH.exists():
        try:
            existing_receipt = json.loads(RECEIPT_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing_receipt = {}
    recorded_at = (
        str(existing_receipt.get("recordedAt"))
        if existing_receipt.get("source", {}).get("sha256") == source_hash
        else datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )
    cover_bytes = COVER_PATH.read_bytes()
    receipt = {
        "schemaVersion": 1,
        "bookId": BOOK_ID,
        "recordedAt": recorded_at,
        "importer": "scripts/import-a-land-divided.py",
        "remoteWrites": False,
        "source": {
            "fileName": source.name,
            "sha256": source_hash,
            "bytes": len(source_bytes),
            "pages": EXPECTED_PAGE_COUNT,
            "creator": "calibre 8.4.0",
            "createdAt": SOURCE_CREATED_AT,
            "originalPreserved": True,
        },
        "cover": {
            "path": "public/covers-webp/IsrPal.webp",
            "sha256": sha256_bytes(cover_bytes),
            "bytes": len(cover_bytes),
        },
        "output": {
            "path": "private/book-content/isrpal.json",
            "sha256": sha256_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n"),
            "sectionCount": len(sections),
            "wordCount": total_words,
            "sourceTextSha256": sha256_text(source_text),
            "canonicalTextSha256": sha256_text(canonical_text),
        },
        "validation": {
            "unintendedTextDeltaCount": 0,
            "copyrightPreservedExactly": True,
            "replacementCharacters": canonical_text.count("\ufffd"),
            "nullCharacters": canonical_text.count("\x00"),
            "contiguousSectionIndexes": True,
        },
        "intentionalTextDeltas": [
            *[
                {"section": title, "kind": "opening-small-caps", "before": before, "after": after}
                for title, (before, after) in OPENING_CASE_CHANGES.items()
            ],
            {
                "section": "About the Author",
                "kind": "stale-author-note",
                "before": AUTHOR_NOTE_BEFORE,
                "after": AUTHOR_NOTE_AFTER,
            },
        ],
        "structuralNormalization": [
            "Rejoined visual PDF line wraps inside paragraphs.",
            "Restored paragraph boundaries from first-line indentation.",
            "Preserved italic and bold font runs as semantic HTML.",
            "Generated a Reader Contents section from the reviewed PDF outline.",
        ],
        "sections": [
            {
                "title": record["title"],
                "pageStart": record["pageStart"],
                "pageEnd": record["pageEnd"],
                "sourceTextSha256": sha256_text(record["text"]),
                "canonicalTextSha256": sha256_text(next(section["text"] for section in sections if section["title"] == record["title"])),
            }
            for record in source_records
        ],
    }
    if receipt["validation"]["replacementCharacters"] or receipt["validation"]["nullCharacters"]:
        raise RuntimeError("The canonical text contains an invalid replacement or null character.")
    return content, receipt


def build_catalog(current: list[dict[str, Any]], content: dict[str, Any]) -> list[dict[str, Any]]:
    matches = [book for book in current if str(book.get("id") or "").strip().lower() == BOOK_ID]
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one {BOOK_ID} catalog row, found {len(matches)}.")
    minutes = max(1, (int(content["wordCount"]) + 179) // 180)
    updated: list[dict[str, Any]] = []
    for book in current:
        if str(book.get("id") or "").strip().lower() != BOOK_ID:
            updated.append(book)
            continue
        updated.append({
            **book,
            "title": BOOK_TITLE,
            "coverFile": "IsrPal.jpg",
            "bookFile": f"{BOOK_ID}.json",
            "status": "ready",
            "description": BOOK_DESCRIPTION,
            "wordCount": int(content["wordCount"]),
            "readingMinutes": minutes,
            "readingLabel": f"{minutes} min read",
            "chapterCount": int(content["sectionCount"]),
            "visibility": "main",
            "archive": False,
            "subtitle": BOOK_SUBTITLE,
            "creator": BOOK_CREATOR,
            "author": BOOK_CREATOR,
        })
    return updated


def build_manifest(current: dict[str, Any], content: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(current.get("books"), list):
        raise RuntimeError("The book-content manifest has no books array.")
    entry = {
        "id": BOOK_ID,
        "slug": BOOK_SLUG,
        "title": BOOK_TITLE,
        "sourceFile": Path(str(content["sourceFile"])).name,
        "sectionCount": int(content["sectionCount"]),
        "wordCount": int(content["wordCount"]),
        "path": f"book-content/{BOOK_ID}.json",
    }
    books = [item for item in current["books"] if str(item.get("id") or "").strip().lower() != BOOK_ID]
    books.append(entry)
    books.sort(key=lambda item: str(item.get("id") or "").casefold())
    result = {**current, "count": len(books), "books": books}
    return result


def encoded(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def atomic_write(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(value, encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--write", action="store_true", help="Write the reviewed local outputs.")
    args = parser.parse_args()

    source = args.source.resolve()
    if not source.is_file():
        raise RuntimeError(f"Source PDF not found: {source}")
    content, receipt = build_content(source)
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    expected_catalog = build_catalog(catalog, content)
    expected_manifest = build_manifest(manifest, content)

    expected = {
        CONTENT_PATH: encoded(content),
        RECEIPT_PATH: encoded(receipt),
        CATALOG_PATH: encoded(expected_catalog),
        MANIFEST_PATH: encoded(expected_manifest),
    }

    if args.write:
        for path, value in expected.items():
            if not path.exists() or path.read_text(encoding="utf-8") != value:
                atomic_write(path, value)
                print(f"wrote {path.relative_to(ROOT)}")
        print(
            f"Imported {BOOK_TITLE}: {content['sectionCount']} sections, "
            f"{content['wordCount']} words, source {EXPECTED_SOURCE_SHA256[:12]}."
        )
        return 0

    mismatches = []
    for path, value in expected.items():
        if not path.exists():
            mismatches.append(f"missing {path.relative_to(ROOT)}")
        elif path.read_text(encoding="utf-8") != value:
            mismatches.append(f"out of date {path.relative_to(ROOT)}")
    if mismatches:
        for mismatch in mismatches:
            print(mismatch, file=sys.stderr)
        print("Run with --write to refresh the local import.", file=sys.stderr)
        return 1
    print(
        f"Verified {BOOK_TITLE}: {content['sectionCount']} sections, "
        f"{content['wordCount']} words, zero unintended text deltas."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"A Land Divided import failed: {error}", file=sys.stderr)
        raise SystemExit(1)
