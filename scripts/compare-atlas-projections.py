#!/usr/bin/env python3
"""Render a bounded, reproducible projection comparison from locked WGS84 data.

This is an evaluation artifact, not a runtime projection switch. All candidates
use the same countries, palette, frame, and 30-degree graticule. PROJ provides
the candidate formulas; the current Equal Earth formula is imported unchanged.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from xml.sax.saxutils import escape

from rasterio.warp import transform

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("atlas_geography", ROOT / "scripts/build-atlas-geography-pack.py")
geography = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geography)

PALETTE = ["#6fa7b1", "#ceaa72", "#8ea99b", "#c48979", "#9c9ac0", "#8dbaaa", "#b8ad85"]
CANDIDATES = [
    ("equal-earth", "Equal Earth · current projection", None, 90, "Equal-area · full globe · existing geometry, camera and raster alignment"),
    ("natural-earth", "Natural Earth I", "+proj=natearth +R=6371007.181 +units=m", 90, "Compromise projection · full globe · more vertical weight at mid-latitudes"),
    ("robinson", "Robinson", "+proj=robin +R=6371007.181 +units=m", 90, "Compromise projection · full globe · familiar rounded world outline"),
    ("web-mercator", "Web Mercator · familiar navigation view", "EPSG:3857", 85.05112878, "Conformal local shapes · poles omitted at ±85.05° · strong high-latitude area inflation"),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "output/atlas-phase25/projections")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    lock = json.loads((ROOT / "data/atlas/sources.lock.json").read_text("utf8"))
    source = next(item for item in lock["sources"] if item["id"] == "natural-earth-admin-0-50m-5.1.2")
    source_path = args.source_cache / source["target"]
    assert geography.sha256_file(source_path) == source["checksumSha256"]
    countries = json.loads(source_path.read_text("utf8"))["features"]
    metrics = []
    for identity, title, crs, max_latitude, subtitle in CANDIDATES:
        def raw(points):
            if crs is None:
                return [geography.equal_earth_raw(float(x), float(y)) for x, y, *_ in points]
            xs, ys = transform("EPSG:4326", crs, [p[0] for p in points], [max(-max_latitude, min(max_latitude, p[1])) for p in points])
            return list(zip(xs, [-y for y in ys]))

        outline_wgs84 = [(lon, -max_latitude) for lon in range(-180, 181)] + [(180, lat) for lat in range(-int(max_latitude), int(max_latitude) + 1)] + [(lon, max_latitude) for lon in range(180, -181, -1)] + [(-180, lat) for lat in range(int(max_latitude), -int(max_latitude) - 1, -1)]
        outline = raw(outline_wgs84)
        xmin, xmax = min(x for x, _ in outline), max(x for x, _ in outline)
        ymin, ymax = min(y for _, y in outline), max(y for _, y in outline)
        scale = min(1172 / (xmax - xmin), 590 / (ymax - ymin))
        tx, ty = 600 - (xmax + xmin) / 2 * scale, 385 - (ymax + ymin) / 2 * scale

        def project(points):
            return [(x * scale + tx, y * scale + ty) for x, y in raw(points)]

        def path(points, close=False):
            return "".join(f"{'M' if i == 0 else 'L'}{x:.2f},{y:.2f}" for i, (x, y) in enumerate(project(points))) + ("Z" if close else "")

        pieces = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1200 750"><rect width="1200" height="750" fill="#101a24"/><text x="34" y="38" fill="#e5c185" font-size="12" font-family="sans-serif" letter-spacing="3">JJ UNIVERSITY / ATLAS · PROJECTION STUDY</text><text x="34" y="69" fill="#f3f0e7" font-size="27" font-family="Georgia">{escape(title)}</text><path d="{path(outline_wgs84, True)}" fill="#172b3b" stroke="#557485" stroke-width=".6"/>']
        for longitude in range(-150, 180, 30):
            points = [(longitude, latitude) for latitude in range(-int(max_latitude), int(max_latitude) + 1, 2)]
            pieces.append(f'<path d="{path(points)}" fill="none" stroke="#8099a8" stroke-opacity=".18" stroke-width=".5"/>')
        for latitude in range(-60, 90, 30):
            pieces.append(f'<path d="{path([(longitude, latitude) for longitude in range(-180, 181, 2)])}" fill="none" stroke="#8099a8" stroke-opacity=".18" stroke-width=".5"/>')
        for feature in countries:
            polygons = feature["geometry"]["coordinates"] if feature["geometry"]["type"] == "MultiPolygon" else [feature["geometry"]["coordinates"]]
            geometry_path = "".join(path(ring, True) for polygon in polygons for ring in polygon)
            color = PALETTE[(int(feature["properties"].get("MAPCOLOR7") or 1) - 1) % len(PALETTE)]
            pieces.append(f'<path d="{geometry_path}" fill="{color}" stroke="#213341" stroke-width=".48" fill-rule="evenodd"/>')
        pieces.append(f'<text x="34" y="716" fill="#c0cbd0" font-size="13" font-family="sans-serif">{escape(subtitle)}</text><text x="34" y="738" fill="#8294a1" font-size="10" font-family="sans-serif">Same Natural Earth 1:50m v5.1.2 WGS84 source · same framing and palette · no political or population weighting</text></svg>')
        (args.output / f"{identity}.svg").write_text("".join(pieces), "utf8")
        europe = project([(-12, 35), (42, 35), (-12, 60), (42, 60)])
        metrics.append({"projection": identity, "worldBounds": [xmin, ymin, xmax, ymax], "source": source["id"], "europeFrameAreaPixels": round((max(x for x, _ in europe) - min(x for x, _ in europe)) * (max(y for _, y in europe) - min(y for _, y in europe))), "viewport": "1200 x 750; 1172 x 590 map slot"})
    (args.output / "comparison-metadata.json").write_text(json.dumps(metrics, indent=2) + "\n", "utf8")
    print(json.dumps({"output": str(args.output), "candidates": [candidate[0] for candidate in CANDIDATES], "metrics": metrics}, indent=2))


if __name__ == "__main__":
    main()
