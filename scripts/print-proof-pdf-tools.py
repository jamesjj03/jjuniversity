#!/usr/bin/env python3
"""Deterministic PDF finishing and proof-cover generation for JJ University."""

from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import math
import os
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, ByteStringObject, NameObject
from reportlab.lib.pagesizes import landscape
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate


INCH = 72.0
RASTER_PPI = 300
FONT_DIR = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
FONT_REGULAR = FONT_DIR / "arial.ttf"
FONT_BOLD = FONT_DIR / "arialbd.ttf"
FONT_BLACK = FONT_DIR / "ariblk.ttf"
FONT_SERIF = FONT_DIR / "times.ttf"
FONT_SERIF_BOLD = FONT_DIR / "timesbd.ttf"
FONT_SERIF_ITALIC = FONT_DIR / "timesi.ttf"
pdfmetrics.registerFont(TTFont("JJUArial", str(FONT_REGULAR)))
pdfmetrics.registerFont(TTFont("JJUArialBold", str(FONT_BOLD)))
pdfmetrics.registerFont(TTFont("JJUTimes", str(FONT_SERIF)))
pdfmetrics.registerFont(TTFont("JJUTimesBold", str(FONT_SERIF_BOLD)))
pdfmetrics.registerFont(TTFont("JJUTimesItalic", str(FONT_SERIF_ITALIC)))
pdfmetrics.registerFontFamily("JJUTimes", normal="JJUTimes", bold="JJUTimesBold", italic="JJUTimesItalic", boldItalic="JJUTimesBold")


def font(path: Path, size_px: int) -> ImageFont.FreeTypeFont:
    selected = path if path.exists() else FONT_BOLD
    return ImageFont.truetype(str(selected), size_px)


def read_markers(pdf_path: Path) -> dict[str, object]:
    reader = PdfReader(str(pdf_path))
    books: dict[str, int] = {}
    clean_pages: list[int] = []
    for number, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        book_ids = re.findall(r"BOOKSTART:([a-z0-9-]+)", text)
        for book_id in book_ids:
            books[book_id] = number
        visible = re.sub(r"PAGETYPE:CLEAN|BOOKSTART:[a-z0-9-]+", "", text).strip()
        if number <= 3 or book_ids or not visible:
            clean_pages.append(number)
    return {"pageCount": len(reader.pages), "books": books, "cleanPages": clean_pages}


def audit_pages(pdf_path: Path) -> dict[str, object]:
    reader = PdfReader(str(pdf_path))
    pages: list[dict[str, object]] = []
    for number, page in enumerate(reader.pages, 1):
        raw = page.extract_text() or ""
        visible = re.sub(r"PAGETYPE:CLEAN|BOOKSTART:[a-z0-9-]+", "", raw)
        visible = re.sub(rf"(?:^|\s){number}(?:\s|$)", " ", visible)
        visible = re.sub(r"\s+", " ", visible).strip()
        clean = number <= 3 or "BOOKSTART:" in raw or not visible
        pages.append({"page": number, "clean": clean, "characters": len(visible), "sample": visible[:120]})
    return {
        "pageCount": len(pages),
        "intentionalBlankPages": [item["page"] for item in pages if item["characters"] == 0],
        "emptyUnmarkedPages": [item["page"] for item in pages if not item["clean"] and item["characters"] == 0],
        "sparseNarrativePages": [item for item in pages if not item["clean"] and 0 < item["characters"] < 180],
        "pages": pages,
    }


def generate_legal_proof(spec_path: Path) -> None:
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    output = Path(spec["output"])
    output.parent.mkdir(parents=True, exist_ok=True)

    body_color = HexColor("#403b34")
    heading_color = HexColor("#171511")
    muted_color = HexColor("#655f56")
    heading_style = ParagraphStyle(
        "LegalHeading",
        fontName="JJUArialBold",
        fontSize=19,
        leading=19,
        textColor=heading_color,
        spaceAfter=0.12 * INCH,
    )
    title_style = ParagraphStyle(
        "LegalTitle",
        fontName="JJUTimes",
        fontSize=8.45,
        leading=10.985,
        textColor=body_color,
        spaceAfter=0.09 * INCH,
    )
    body_style = ParagraphStyle(
        "LegalBody",
        fontName="JJUTimes",
        fontSize=8.15,
        leading=10.269,
        textColor=body_color,
        spaceAfter=0.055 * INCH,
    )
    notice_style = ParagraphStyle(
        "LegalNotice",
        parent=body_style,
        fontName="JJUTimesItalic",
        textColor=muted_color,
        spaceBefore=0.035 * INCH,
        spaceAfter=0.065 * INCH,
    )

    subject = html.escape(str(spec["subject"]))
    volume = html.escape(str(spec["volume"]))
    series = html.escape(str(spec["series"]))
    year = int(spec["copyrightYear"])
    story = [
        Paragraph("Copyright and Disclaimer", heading_style),
        Paragraph(f"<b>{subject}</b><br/>{volume} of {series}<br/>James Johnson", title_style),
        Paragraph(f"Copyright © {year} James Johnson. All rights reserved.<br/>Published by JJ University. JJUniversity.com", body_style),
        Paragraph("No part of this publication may be reproduced, distributed, or transmitted without prior written permission, except for brief quotations and other uses permitted by law.", body_style),
        Paragraph("JJ University books use a human-directed process that can include AI-assisted research and early drafting. James Johnson selects the subjects, directs the structure and scope, and substantially revises and edits the work.", body_style),
        Paragraph(f"First JJ University print proof, {year}. Not for sale.", body_style),
        Paragraph("The following notes apply where relevant to portions of this volume.", notice_style),
    ]
    for block in spec.get("blocks", []):
        heading = html.escape(str(block.get("heading", "")).rstrip("."))
        text = html.escape(" ".join(str(item).strip() for item in block.get("paragraphs", []) if str(item).strip()))
        story.append(KeepTogether([Paragraph(f'<font name="JJUArialBold" size="8">{heading}.</font> {text}', body_style)]))

    document = SimpleDocTemplate(
        str(output),
        pagesize=(6 * INCH, 9 * INCH),
        leftMargin=0.62 * INCH,
        rightMargin=0.95 * INCH,
        topMargin=0.70 * INCH,
        bottomMargin=0.72 * INCH,
        title=str(spec["title"]),
        author="James Johnson",
        subject="One-page copyright and disclaimer proof; not for sale",
        pageCompression=1,
    )
    document.build(story)


def deterministic_id(seed: bytes) -> ArrayObject:
    digest = hashlib.sha256(seed).digest()
    return ArrayObject([ByteStringObject(digest[:16]), ByteStringObject(digest[16:32])])


def folio_overlay_document(page_specs: list[tuple[int, float, float, bool]]) -> PdfReader:
    stream = io.BytesIO()
    overlay = canvas.Canvas(stream, pagesize=(page_specs[0][1], page_specs[0][2]), pageCompression=1, invariant=1, initialFontName="JJUArial")
    for page_number, width, height, skip in page_specs:
        overlay.setPageSize((width, height))
        if not skip:
            overlay.setFillColorRGB(0.20, 0.18, 0.15)
            overlay.setFont("JJUArial", 8)
            y = 0.38 * INCH
            if page_number % 2 == 0:
                overlay.drawString(0.62 * INCH, y, str(page_number))
            else:
                overlay.drawRightString(width - 0.62 * INCH, y, str(page_number))
        overlay.showPage()
    overlay.save()
    stream.seek(0)
    return PdfReader(stream)


def normalize_with_folios(source: Path, output: Path, title: str) -> None:
    source_reader = PdfReader(str(source))
    writer = PdfWriter()
    page_specs: list[tuple[int, float, float, bool]] = []
    for number, page in enumerate(source_reader.pages, 1):
        extracted = page.extract_text() or ""
        visible = re.sub(r"PAGETYPE:CLEAN|BOOKSTART:[a-z0-9-]+", "", extracted)
        skip = number <= 3 or "BOOKSTART:" in extracted or not visible.strip()
        page_specs.append((number, float(page.mediabox.width), float(page.mediabox.height), skip))
    overlay_reader = folio_overlay_document(page_specs)

    for number, source_page in enumerate(source_reader.pages, 1):
        page = source_page
        if not page_specs[number - 1][3]:
            page.merge_page(overlay_reader.pages[number - 1], over=True)
        writer.add_page(page)

    writer.add_metadata({
        "/Title": title,
        "/Author": "James Johnson",
        "/Subject": "JJ University 101 print proof",
        "/Creator": "JJ University deterministic proof factory",
        "/Producer": "JJ University deterministic proof factory",
        "/CreationDate": "D:20260819000000-04'00'",
        "/ModDate": "D:20260819000000-04'00'",
    })
    writer._ID = deterministic_id(title.encode("utf-8"))
    writer.root_object.pop(NameObject("/Metadata"), None)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as handle:
        writer.write(handle)


def px(value_in: float) -> int:
    return int(round(value_in * RASTER_PPI))


def fit_font(draw: ImageDraw.ImageDraw, text: str, max_width: int, start: int, path: Path) -> ImageFont.FreeTypeFont:
    size = start
    while size > 18:
        candidate = font(path, size)
        if draw.textbbox((0, 0), text, font=candidate)[2] <= max_width:
            return candidate
        size -= 2
    return font(path, size)


def wrap_text(draw: ImageDraw.ImageDraw, text: str, selected_font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or draw.textbbox((0, 0), candidate, font=selected_font)[2] <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_lines(draw: ImageDraw.ImageDraw, lines: list[str], x: int, y: int, selected_font: ImageFont.FreeTypeFont,
               fill: str, spacing: float = 1.18, anchor: str = "la") -> int:
    bbox = draw.textbbox((0, 0), "Ag", font=selected_font)
    step = int((bbox[3] - bbox[1]) * spacing)
    for line in lines:
        draw.text((x, y), line, font=selected_font, fill=fill, anchor=anchor)
        y += step
    return y


def front_geometry(draw: ImageDraw.ImageDraw, bounds: tuple[int, int, int, int], volume: str, style: str) -> None:
    x0, y0, x1, y1 = bounds
    gold = "#d4a24c"
    ink = "#0d1117"
    cream = "#f7f5f1"
    w = x1 - x0
    h = y1 - y0
    if style == "system":
        draw.rectangle((x0, y0, x1, y1), fill=ink)
        center = (x0 + int(w * 0.78), y0 + int(h * 0.25))
        for radius, line_width in ((int(w * .20), 4), (int(w * .14), 3), (int(w * .08), 3)):
            draw.ellipse((center[0]-radius, center[1]-radius, center[0]+radius, center[1]+radius), outline=gold, width=line_width)
        draw.line((center[0], y0 + int(h*.08), center[0], y0 + int(h*.42)), fill="#56606c", width=2)
        draw.line((x0 + int(w*.60), center[1], x0 + int(w*.96), center[1]), fill="#56606c", width=2)
    elif style == "index":
        draw.rectangle((x0, y0, x1, y1), fill=cream)
        draw.rectangle((x0, y0, x0 + int(w*.055), y1), fill=gold)
        outline = "#c8c2b8"
        number_font = font(FONT_BLACK, int(h*.31))
        draw.text((x0 + int(w*.10), y0 + int(h*.57)), "101", font=number_font, fill=outline)
    else:
        midpoint = x0 + int(w*.55)
        draw.rectangle((x0, y0, midpoint, y1), fill=ink)
        draw.rectangle((midpoint, y0, x1, y1), fill=cream)
        draw.rectangle((midpoint-2, y0, midpoint+2, y1), fill=gold)
        step = int(w*.045)
        for i in range(3):
            offset = i * step
            draw.rectangle((x0 + int(w*.67)+offset, y0 + int(h*.15)+offset, x1-int(w*.10)-offset, y0+int(h*.37)-offset), outline=gold, width=3)


def draw_cover_face(img: Image.Image, face: tuple[float, float, float, float], spec: dict, style: str, front: bool) -> None:
    draw = ImageDraw.Draw(img)
    x0, y0, x1, y1 = (px(v) for v in face)
    w, h = x1 - x0, y1 - y0
    gold = "#d4a24c"
    cream = "#f7f5f1"
    ink = "#0d1117"
    muted = "#a8b0b9"
    if style == "system":
        draw.rectangle((x0, y0, x1, y1), fill=ink)
    if front:
        front_geometry(draw, (x0, y0, x1, y1), spec["volume"], style)
    dark_text = style == "index" or (style == "split" and not front)
    primary = ink if dark_text else cream
    secondary = "#3b4149" if dark_text else muted
    safe = px(spec.get("safety", 0.42))
    left = x0 + safe
    right = x1 - safe

    if front:
        brand_font = font(FONT_BOLD, px(.13))
        draw.text((left, y0 + safe), "JJ UNIVERSITY 101", font=brand_font, fill=gold)
        y = y0 + int(h * .47)
        title_font = fit_font(draw, spec["subject"].upper(), right-left, px(.52), FONT_BLACK)
        title_lines = spec["subject"].upper().split(" ")
        if len(title_lines) == 2:
            y = draw_lines(draw, title_lines, left, y, title_font, primary, spacing=.94)
        else:
            y = draw_lines(draw, wrap_text(draw, spec["subject"].upper(), title_font, right-left), left, y, title_font, primary, spacing=.94)
        rule_y = y + px(.10)
        draw.rectangle((left, rule_y, left + px(.82), rule_y + px(.025)), fill=gold)
        meta_font = font(FONT_BOLD, px(.15))
        draw.text((left, rule_y + px(.13)), spec["volume"].upper(), font=meta_font, fill=gold)
        author_font = font(FONT_BOLD, px(.145))
        draw.text((left, y1 - safe), "JAMES JOHNSON", font=author_font, fill=primary, anchor="ls")
    else:
        y = y0 + safe
        draw.text((left, y), "JJ UNIVERSITY 101", font=font(FONT_BOLD, px(.12)), fill=gold)
        y += px(.42)
        headline = spec["backHeadline"]
        headline_font = font(FONT_BOLD, px(.23))
        y = draw_lines(draw, wrap_text(draw, headline, headline_font, right-left), left, y, headline_font, primary, spacing=1.05)
        y += px(.16)
        body_font = font(FONT_REGULAR, px(.125))
        y = draw_lines(draw, wrap_text(draw, spec["backDescription"], body_font, right-left), left, y, body_font, secondary, spacing=1.28)
        y += px(.22)
        list_font = font(FONT_BOLD, px(.115))
        for index, title in enumerate(spec["books"], 1):
            draw.text((left, y), f"{index:02d}  {title}", font=list_font, fill=primary)
            y += px(.22)
        draw.text((left, y1-safe), "Read every book free at JJUniversity.com", font=font(FONT_BOLD, px(.11)), fill=gold, anchor="ls")
        barcode_w, barcode_h = px(2.0), px(1.2)
        bx1, by1 = x1-safe, y1-safe
        draw.rectangle((bx1-barcode_w, by1-barcode_h, bx1, by1), fill="#ffffff")


def generate_cover(spec: dict, output: Path) -> None:
    width = float(spec["widthIn"])
    height = float(spec["heightIn"])
    binding = spec["binding"]
    image = Image.new("RGB", (px(width), px(height)), "#0d1117")
    draw = ImageDraw.Draw(image)
    if binding == "paperback":
        outer = .125
        spine = width - (2 * 6 + 2 * outer)
        back = (outer, outer, outer + 6, outer + 9)
        front = (outer + 6 + spine, outer, outer + 12 + spine, outer + 9)
        safety = .42
    else:
        outer = (height - 9) / 2
        spine = width - (2 * 6 + 2 * outer)
        back = (outer, outer, outer + 6, outer + 9)
        front = (outer + 6 + spine, outer, outer + 12 + spine, outer + 9)
        safety = .75
    local_spec = {**spec, "safety": safety}
    draw_cover_face(image, back, local_spec, "system", False)
    draw_cover_face(image, front, local_spec, "system", True)

    sx0 = px(outer + 6)
    sx1 = px(outer + 6 + spine)
    draw.rectangle((sx0, 0, sx1, px(height)), fill="#111820")
    spine_font = fit_font(draw, f"{spec['subject'].upper()} | {spec['volume'].upper()} | JAMES JOHNSON", px(height - 2*outer - 1.0), px(.14), FONT_BOLD)
    spine_layer = Image.new("RGBA", (px(height), max(1, sx1-sx0)), (0, 0, 0, 0))
    spine_draw = ImageDraw.Draw(spine_layer)
    spine_text = f"{spec['subject'].upper()} | {spec['volume'].upper()} | JAMES JOHNSON"
    spine_draw.text((px(.48), (sx1-sx0)//2), spine_text, font=spine_font, fill="#f7f5f1", anchor="lm")
    spine_layer = spine_layer.rotate(90, expand=True)
    crop_x = max(0, (spine_layer.width - (sx1-sx0)) // 2)
    crop_y = max(0, (spine_layer.height - px(height)) // 2)
    spine_layer = spine_layer.crop((crop_x, crop_y, crop_x+(sx1-sx0), crop_y+px(height)))
    image.paste(spine_layer, (sx0, 0), spine_layer)

    stream = io.BytesIO()
    image.save(stream, format="PNG", optimize=True)
    stream.seek(0)
    output.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output), pagesize=(width*INCH, height*INCH), pageCompression=1, invariant=1, initialFontName="JJUArial")
    pdf.setTitle(f"{spec['subject']} {spec['volume']} {binding} cover proof")
    pdf.setAuthor("James Johnson")
    pdf.drawImage(ImageReader(stream), 0, 0, width=width*INCH, height=height*INCH, mask=None)
    pdf.showPage()
    pdf.save()


def miniature(draw: ImageDraw.ImageDraw, bounds: tuple[int, int, int, int], spec: dict, style: str) -> None:
    x0, y0, x1, y1 = bounds
    front_geometry(draw, bounds, spec["volume"], style)
    ink = "#0d1117"
    cream = "#f7f5f1"
    gold = "#d4a24c"
    primary = ink if style == "index" else cream
    pad = int((x1-x0)*.08)
    draw.text((x0+pad, y0+pad), "JJ UNIVERSITY 101", font=font(FONT_BOLD, 24), fill=gold)
    title_width = int((x1-x0)*.43) if style == "split" else x1-x0-2*pad
    title_font = fit_font(draw, spec["subject"].upper(), title_width, 62, FONT_BLACK)
    lines = spec["subject"].upper().split(" ")
    y = y0 + int((y1-y0)*.52)
    draw_lines(draw, lines, x0+pad, y, title_font, primary, spacing=.94)
    if style == "split":
        band_top = y1 - int((y1-y0)*.10)
        draw.rectangle((x0, band_top, x1, y1), fill=gold)
        draw.text((x0+pad, y1-pad//2), f"{spec['volume'].upper()}  |  JAMES JOHNSON", font=font(FONT_BOLD, 20), fill=ink, anchor="ls")
    else:
        draw.text((x0+pad, y1-pad), f"{spec['volume'].upper()}  |  JAMES JOHNSON", font=font(FONT_BOLD, 22), fill=gold, anchor="ls")


def generate_concepts(specs: list[dict], output: Path) -> None:
    page_w, page_h = 16, 9
    styles = [
        ("SYSTEM", "Dark field, gold rule, subject geometry", "The most direct continuation of the website brand."),
        ("INDEX", "Cream field, serial tab, oversized type", "More academic and tactile without looking institutional."),
        ("SPLIT", "Two-tone field, mirrored volume system", "Makes the two-volume set read as one designed object."),
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output), pagesize=landscape((page_h*INCH, page_w*INCH)), pageCompression=1, invariant=1, initialFontName="JJUArial")
    pdf.setTitle("JJ University 101 cover directions")
    pdf.setAuthor("JJ University")
    for style, subtitle, note in styles:
        canvas_img = Image.new("RGB", (2400, 1350), "#ece9e2")
        draw = ImageDraw.Draw(canvas_img)
        draw.text((110, 90), f"DIRECTION {styles.index((style, subtitle, note))+1}: {style}", font=font(FONT_BLACK, 54), fill="#0d1117")
        draw.text((112, 165), subtitle, font=font(FONT_REGULAR, 28), fill="#3e444b")
        mini_h = 960
        mini_w = int(mini_h * (2/3))
        miniature(draw, (180, 280, 180+mini_w, 280+mini_h), specs[0], style.lower())
        miniature(draw, (1580, 280, 1580+mini_w, 280+mini_h), specs[1], style.lower())
        center_x = 1200
        note_font = font(FONT_REGULAR, 25)
        note_y = 650
        for line in wrap_text(draw, note, note_font, 620):
            draw.text((center_x, note_y), line, font=note_font, fill="#3e444b", anchor="mm")
            note_y += 38
        tradeoff = "Tradeoff: the split system uses a deliberately smaller title." if style == "SPLIT" else "Typography and geometry only. No generated illustration."
        trade_font = font(FONT_BOLD, 21)
        for line in wrap_text(draw, tradeoff, trade_font, 620):
            draw.text((center_x, note_y + 26), line, font=trade_font, fill="#b27e27", anchor="mm")
            note_y += 34
        stream = io.BytesIO()
        canvas_img.save(stream, format="PNG", optimize=True)
        stream.seek(0)
        pdf.drawImage(ImageReader(stream), 0, 0, width=16*INCH, height=9*INCH)
        pdf.showPage()
    pdf.save()


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    marker_parser = sub.add_parser("markers")
    marker_parser.add_argument("pdf")
    audit_parser = sub.add_parser("audit")
    audit_parser.add_argument("pdf")
    legal_parser = sub.add_parser("legal-proof")
    legal_parser.add_argument("spec")
    normalize_parser = sub.add_parser("normalize")
    normalize_parser.add_argument("source")
    normalize_parser.add_argument("output")
    normalize_parser.add_argument("--title", required=True)
    cover_parser = sub.add_parser("covers")
    cover_parser.add_argument("spec")
    concept_parser = sub.add_parser("concepts")
    concept_parser.add_argument("spec")
    concept_parser.add_argument("output")
    args = parser.parse_args()

    if args.command == "markers":
        print(json.dumps(read_markers(Path(args.pdf))))
    elif args.command == "audit":
        print(json.dumps(audit_pages(Path(args.pdf))))
    elif args.command == "legal-proof":
        generate_legal_proof(Path(args.spec))
    elif args.command == "normalize":
        normalize_with_folios(Path(args.source), Path(args.output), args.title)
    elif args.command == "covers":
        payload = json.loads(Path(args.spec).read_text(encoding="utf-8"))
        for item in payload["covers"]:
            generate_cover(item, Path(item["output"]))
    elif args.command == "concepts":
        payload = json.loads(Path(args.spec).read_text(encoding="utf-8"))
        generate_concepts(payload["volumes"], Path(args.output))


if __name__ == "__main__":
    main()
