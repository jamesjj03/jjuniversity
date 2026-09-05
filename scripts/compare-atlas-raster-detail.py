#!/usr/bin/env python3
"""Create review figures comparing overview magnification with genuine detail.

Both sides use the same generated palette and geographic extent. The right
side assembles only intersecting independently-source-warped country tiles.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
REGIONS = [
    ("Nile Valley and Delta", (662, 185, 80, 52)),
    ("Java and neighbouring islands", (925, 334, 70, 45.5)),
    ("Indo-Gangetic Plain", (786, 204, 117, 76.05)),
    ("Eastern China", (905, 162, 92, 59.8)),
]


def font(size):
    for candidate in [Path("C:/Windows/Fonts/segoeui.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")]:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def crop_level(level, extent):
    x, y, width, height = extent
    scale = level["width"] / 1200
    size = (round(width * scale), round(height * scale))
    canvas = Image.new("RGBA", size)
    for tile in level["tiles"]:
        tx, ty, tw, th = tile["viewBox"]
        if tx >= x + width or tx + tw <= x or ty >= y + height or ty + th <= y:
            continue
        with Image.open(ROOT / "public" / tile["href"].lstrip("/")) as image:
            canvas.paste(image, (round((tx - x) * scale), round((ty - y) * scale)))
    return canvas


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "output/atlas-phase25/raster-detail")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    pack = json.loads((ROOT / "lib/atlas-world/data/geography-pack.v1.json").read_text("utf8"))
    dataset = next(dataset for dataset in pack["datasets"] if dataset["id"] == "population-density-2025")
    level = dataset["assetPyramid"]["levels"][-1]
    overview = Image.open(ROOT / "public" / dataset["asset"]["href"].lstrip("/"))
    results = []
    for name, extent in REGIONS:
        x, y, width, height = extent
        overview_crop = overview.crop((round(x * 2), round(y * 2), round((x + width) * 2), round((y + height) * 2)))
        detail_crop = crop_level(level, extent)
        output = Image.new("RGB", (1440, 660), "#101a24")
        draw = ImageDraw.Draw(output)
        draw.text((30, 20), "JJ UNIVERSITY / ATLAS  ·  SOURCE DETAIL", font=font(15), fill="#e5c185")
        draw.text((30, 48), name, font=font(28), fill="#f3f0e7")
        rendered = []
        for i, (title, image) in enumerate([("World overview enlarged", overview_crop), ("New independently generated source detail", detail_crop)]):
            position = (30 + i * 710, 127)
            resized = image.resize((680, 442), Image.Resampling.BICUBIC)
            base = Image.new("RGBA", resized.size, "#1b323d")
            base.alpha_composite(resized)
            output.paste(base.convert("RGB"), position)
            rendered.append(np.asarray(base.convert("RGB"), dtype=np.int16))
            draw.text((position[0], 97), title, font=font(19), fill="#d6dfdd")
        difference = float(np.mean(np.abs(rendered[0] - rendered[1])))
        draw.text((30, 592), "Same location · same scale · same GHSL R2023A 2025 model · original 1 km source", font=font(17), fill="#c3cfce")
        draw.text((30, 625), "Zoom now reveals more source information. It still does not establish street-level population counts.", font=font(16), fill="#8fa3aa")
        output_path = args.output / (name.lower().replace(" ", "-") + ".png")
        output.save(output_path)
        results.append({"region": name, "viewBox": extent, "meanAbsoluteDisplayDifference": round(difference, 3), "image": str(output_path)})
    (args.output / "review-metadata.json").write_text(json.dumps(results, indent=2) + "\n", "utf8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
