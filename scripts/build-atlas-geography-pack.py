#!/usr/bin/env python3
"""Build the bounded Phase 2 physical/population geography pack.

The script consumes only sources named in data/atlas/sources.lock.json. It
keeps canonical feature geometry in WGS84 and emits Mercator derivatives
for the current SVG renderer. Dense rasters are warped once at build time;
they are never expanded into browser-side SVG cells.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import re
import shutil
import tempfile
import unicodedata
import zipfile
from pathlib import Path
from typing import Any, Iterable

try:
    import numpy as np
    import rasterio
    from PIL import Image, ImageDraw
    from rasterio.enums import Resampling
    from rasterio.transform import Affine
    from rasterio.vrt import WarpedVRT
    from rasterio.windows import Window
    from rasterio.warp import reproject, transform
except ModuleNotFoundError:
    # A vector-only refresh intentionally uses a tiny environment and preserves
    # the already-registered population and relief assets byte-for-byte.
    np = None
    rasterio = None
    Image = None
    ImageDraw = None
    Resampling = None
    Affine = None
    WarpedVRT = None
    Window = None
    reproject = None
    transform = None
import shapefile
from shapely.geometry import Point, mapping, shape
from shapely.ops import nearest_points, unary_union
from shapely.strtree import STRtree


SCHEMA_VERSION = "1.0.0"
SNAPSHOT_ID = "atlas-geography-2026-09-05-mercator"
GENERATED_AT = "2026-09-05T03:30:00Z"
VIEWBOX_WIDTH = 1200
VIEWBOX_HEIGHT = 650
PROJECTION_PADDING = 14
OUTPUT_WIDTH = 2400
OUTPUT_HEIGHT = 1300
# Spherical Mercator matches the authored SVG formula exactly. The radius
# controls raster metres, not the geometry's fitted screen coordinates.
EQUAL_EARTH_RADIUS = 6371007.180918475
RASTER_TARGET_CRS = f"+proj=merc +R={EQUAL_EARTH_RADIUS} +units=m +no_defs"
POPULATION_DETAIL_LEVELS = [
    {"id": "regional", "width": 19200, "height": 10400, "columns": 16, "rows": 8, "minimumZoom": 4},
    {"id": "country", "width": 38400, "height": 20800, "columns": 32, "rows": 16, "minimumZoom": 10},
    {"id": "close", "width": 76800, "height": 41600, "columns": 64, "rows": 32, "minimumZoom": 20},
]
RELIEF_DETAIL_LEVELS = [
    {"id": "source-detail", "width": 19200, "height": 10400, "columns": 24, "rows": 16, "minimumZoom": 8},
]
RELIEF_TRANSFORMATION_ID = "natural-earth-relief-to-mercator-raster-v2"
RELIEF_TRANSFORMATION_DESCRIPTION = "Bilinear-warp the original 10800 × 5400 public-domain grayscale relief from WGS84 independently into an overview and viewport-loaded 19200 × 10400 equivalent tiled Mercator level. Preserve the source grayscale without added contrast, sharpening, embossing or generated terrain. The detail level is approximately 4.02 km per projected pixel at the equator, not finer than the source's approximately 3.71 km equatorial pixel spacing."
RIVER_SELECTION_RULE = "50m rivers with min_zoom <= 3 below zoom 6; 10m River/Lake Centerline geometry with min_zoom <= 7 revealed progressively at zoom 6, 10, 16 (including source rank 6) and 20 (source rank 6.5–7)."

POP_SOURCE_ID = "ghsl-ghs-pop-2025-r2023a-1km"
RELIEF_SOURCE_ID = "natural-earth-manual-shaded-relief-50m-3.3.0"
RIVER_SOURCE_ID = "natural-earth-rivers-50m-5.1.2"
LAKE_SOURCE_ID = "natural-earth-lakes-50m-5.1.2"
CITY_SOURCE_ID = "natural-earth-populated-places-50m-5.1.2"
DETAIL_RIVER_SOURCE_ID = "natural-earth-rivers-10m-5.1.2"
DETAIL_LAKE_SOURCE_ID = "natural-earth-lakes-10m-5.1.2"
DETAIL_CITY_SOURCE_ID = "natural-earth-populated-places-10m-5.1.2"
ADMIN0_SOURCE_ID = "natural-earth-admin-0-50m-5.1.2"
WATER_SOURCE_ID = "natural-earth-marine-areas-10m-5.1.2"
BASIN_SOURCE_ID = "world-bank-major-river-basins-2019"
RIVER_FACT_SOURCE_ID = "wikidata-major-river-pilot-2026-09-05"
RIVER_LABEL_SOURCE_ID = "wikidata-major-river-linked-labels-2026-09-05"

WATER_CLASSES = {"ocean", "sea", "gulf", "bay", "strait", "channel"}
WATER_MAX_SCALE_RANK = 4
WATER_COASTLINE_TOLERANCE_DEGREES = 0.12

POP_ZIP_MEMBER = "GHS_POP_E2025_GLOBE_R2023A_54009_1000_V1_0.tif"
RELIEF_ZIP_MEMBER = "MSR_50M/MSR_50M.tif"

POPULATION_STOPS = [
    {"value": 1, "color": "#3c737d", "opacity": 0.26},
    {"value": 10, "color": "#49a3a1", "opacity": 0.48},
    {"value": 50, "color": "#95c49b", "opacity": 0.67},
    {"value": 250, "color": "#efd17b", "opacity": 0.82},
    {"value": 1000, "color": "#f49b52", "opacity": 0.92},
    {"value": 5000, "color": "#ed5e43", "opacity": 0.97},
    {"value": 20000, "color": "#fff0ca", "opacity": 1.0},
]

# A small, reviewed cross-scale identity bridge for river systems whose source
# records use several reach names and identifiers. Everything else remains
# conservatively source-part scoped rather than merging unrelated namesakes.
RIVER_SYSTEM_ALIASES = {
    "nile": {"nile", "white nile", "blue nile", "albert nile", "victoria nile", "mountain nile", "bahr el jebel", "el bahr el abyad", "el bahr el azraq", "abay"},
    "amazon": {"amazon", "amazonas"},
    "yangtze": {"yangtze", "chang jiang", "jinsha"},
    "danube": {"danube", "donau"},
    "congo": {"congo", "lualaba"},
    "mekong": {"mekong", "lancang"},
    "mississippi": {"mississippi"},
    "ganges": {"ganges", "ganga"},
    "ohio": {"ohio"},
    "missouri": {"missouri"},
    "allegheny": {"allegheny"},
    "monongahela": {"monongahela"},
}

BASIN_PILOT = {
    "Amazon": {"sourceIds": [205, 209], "riverPlaceId": "place:natural-earth:river:amazon"},
    "Danube": {"sourceIds": [47], "riverPlaceId": "place:natural-earth:river:danube"},
    "Mississippi": {"sourceIds": [50], "riverPlaceId": "place:natural-earth:river:mississippi"},
    "Nile": {"sourceIds": [116], "riverPlaceId": "place:natural-earth:river:nile"},
    "Yangtze": {"sourceIds": [105], "riverPlaceId": "place:natural-earth:river:yangtze"},
}

# A deliberately bounded authored selection over pinned Wikidata statements.
# Statement IDs are asserted during the build, so an accidental reinterpretation
# of the raw snapshot fails rather than silently changing an Atlas fact.
RIVER_FACT_SELECTIONS = {
    "place:natural-earth:river:nile": {
        "entityId": "Q3392",
        "length": ("P2043", "Q3392$2a0f0e27-4d98-2522-d7eb-5c3f64797e26"),
        "headwaters": [("P885", "Q3392$c04d7217-4163-ac13-27c7-83d75ad08f46")],
        "mouth": ("P403", "q3392$6F881C7F-7012-4139-8F7E-63D4B264E975"),
        "basin": ("P4614", "Q3392$7171BFC7-BAFD-49C3-A361-B4BC58F91BA0"),
        "basinArea": ("P2053", "Q3392$336A2F2C-9B35-498D-AB33-E27CC908CFB8"),
        "tributaries": [
            ("P974", "Q3392$e9de31be-467f-83d3-44ba-520657d495f5"),
            ("P974", "Q3392$5f259332-458c-8226-507f-5708f020eb21"),
        ],
        "notes": ["River-source definitions vary; Atlas presents the selected structured statement, not a claim that every naming convention agrees."],
    },
    "place:natural-earth:river:amazon": {
        "entityId": "Q3783",
        "length": ("P2043", "Q3783$868009a4-4217-7aa5-da1b-3b57856372dd"),
        "headwaters": [
            ("P885", "Q3783$1598b7a1-42ed-39b3-adb2-39d44d2f0bd9"),
            ("P885", "Q3783$f1ede7ec-49aa-7c73-9e0f-33280521ca58"),
        ],
        "mouth": ("P403", "q3783$9AB850F5-B049-441E-84B4-A7F9E26CEF2F"),
        "basin": ("P4614", "Q3783$E6337182-2C5B-419E-ACB1-199EEB7118FD"),
        "basinArea": ("P2053", "Q3783$63f11340-4e0f-6cdd-72dc-a07bb6730390"),
        "tributaries": [
            ("P974", "Q3783$A8A1010C-1C7D-4C22-A388-187097F17C84"),
            ("P974", "Q3783$28BFBC48-D7FC-418B-A026-0F6FFFA173BC"),
            ("P974", "Q3783$5353200F-DB08-4DF3-B8D8-E5441E15D76D"),
            ("P974", "Q3783$c27a9c11-4f93-10d9-eeff-4a9ec8049e3f"),
            ("P974", "Q3783$5903c768-4d19-cee7-9618-5e6e5ef312cd"),
        ],
        "notes": ["Published length estimates for the Amazon differ with the chosen headwater and measurement method; Atlas retains Wikidata's preferred snapshot statement and this caveat."],
    },
    "place:natural-earth:river:mississippi": {
        "entityId": "Q1497",
        "length": ("P2043", "Q1497$cad6e5b1-44fd-714b-4632-f4a7dd11e69c"),
        "headwaters": [("P885", "Q1497$2806eaed-4c89-5fa8-72a0-17aed3f222d6")],
        "mouth": ("P403", "q1497$53E1F598-EC18-4483-AFF0-873C634348F9"),
        "basin": ("P4614", "Q1497$148e4823-4238-1f95-8c0d-239fc784a04b"),
        "basinArea": ("P2053", "Q1497$D60F41BA-60AC-4988-BC92-E0AF47D13B64"),
        "tributaries": [
            ("P974", "Q1497$6d36cdaf-4c4e-b4a3-0474-1481b6fe77d3"),
            ("P974", "Q1497$f7b5ebb5-408e-f091-c643-902804aaee1c"),
            ("P974", "Q1497$78ea11b8-43fe-6396-cc0f-7e41fada8b9f"),
        ],
        "notes": [],
    },
    "place:natural-earth:river:danube": {
        "entityId": "Q1653",
        "length": ("P2043", "Q1653$f5550db9-4ad9-de77-6247-f3d99fab7497"),
        "headwaters": [
            ("P885", "Q1653$55285e79-406c-638e-0db2-51006133badf"),
            ("P885", "Q1653$8f3a6c31-40a4-e9fc-881c-b7561320a548"),
        ],
        "mouth": ("P403", "q1653$30df16f1-4f16-8305-6e15-ec66eb5c72d2"),
        "basin": ("P4614", "Q1653$46CCA059-4E10-4780-BF30-E902480A9D51"),
        "basinArea": ("P2053", "Q1653$d960d866-4b71-1603-720e-15d75c0d2511"),
        "tributaries": [
            ("P974", "Q1653$1204bcfc-4f2c-7f2a-33c3-7e7e1f20beb4"),
            ("P974", "Q1653$c838f0fc-421e-21b6-5668-71bcab899c42"),
            ("P974", "Q1653$8003a57e-4e0f-c882-4c0e-b5c28c1f6472"),
            ("P974", "Q1653$531328ce-4913-cd7f-4c56-081d56ce8d58"),
        ],
        "notes": [],
    },
    "place:natural-earth:river:yangtze": {
        "entityId": "Q5413",
        "length": ("P2043", "Q5413$042ef160-4b61-5e10-a9cb-bed5ab697d7b"),
        "headwaters": [
            ("P885", "Q5413$2DF8CEA8-6EC7-43E4-AAA1-830CAE231A38"),
            ("P885", "Q5413$853eeea0-4059-eec7-fac1-b801555f2db9"),
        ],
        "mouth": ("P403", "q5413$7D88E3AC-C445-4032-8D3B-A3C244E3AFEE"),
        "basin": ("P4614", "Q5413$ECC56F8F-AC9B-48A2-B8A7-955A939375A5"),
        "basinArea": ("P2053", "Q5413$08D422EA-FDB9-461B-90B9-54C680F7C20A"),
        "tributaries": [
            ("P974", "Q5413$f738acdc-4b4e-85ba-83b2-4cdd07953862"),
            ("P974", "Q5413$fcd8ccf8-484e-cce1-44da-c6d290649674"),
            ("P974", "Q5413$7108e706-4d07-c72d-797a-7933f5ba58da"),
        ],
        "notes": [],
    },
}

CITY_COUNTRY_CODE_OVERRIDES = {
    # Natural Earth populated places uses ISO-style SSD while its Admin-0
    # cartography retains the historical Natural Earth code SDS.
    "SSD": "SDS",
}


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def round_number(value: float, digits: int = 5) -> float:
    result = round(float(value), digits)
    return 0.0 if result == -0.0 else result


def number_or_default(value: Any, default: float) -> float:
    return default if value in (None, "") else float(value)


def equal_earth_raw(longitude: float, latitude: float) -> tuple[float, float]:
    a1 = 1.340264
    a2 = -0.081106
    a3 = 0.000893
    a4 = 0.003796
    m = math.sqrt(3) / 2
    longitude_radians = math.radians(longitude)
    latitude_radians = math.radians(max(-90, min(90, latitude)))
    theta = math.asin(m * math.sin(latitude_radians))
    theta2 = theta * theta
    theta6 = theta2 * theta2 * theta2
    denominator = m * (
        a1 + 3 * a2 * theta2 + theta6 * (7 * a3 + 9 * a4 * theta2)
    )
    return (
        longitude_radians * math.cos(theta) / denominator,
        -theta * (a1 + a2 * theta2 + theta6 * (a3 + a4 * theta2)),
    )


def sphere_coordinates(step: int = 1) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    points.extend((longitude, -90) for longitude in range(-180, 181, step))
    points.extend((180, latitude) for latitude in range(-90 + step, 91, step))
    points.extend((longitude, 90) for longitude in range(180 - step, -181, -step))
    points.extend((-180, latitude) for latitude in range(90 - step, -90, -step))
    return points


def projection_parameters() -> tuple[float, float, float]:
    outline = [mercator_raw(*point) for point in sphere_coordinates(2)]
    xs = [point[0] for point in outline]
    ys = [point[1] for point in outline]
    scale = min(
        (VIEWBOX_WIDTH - PROJECTION_PADDING * 2) / (max(xs) - min(xs)),
        (VIEWBOX_HEIGHT - PROJECTION_PADDING * 2) / (max(ys) - min(ys)),
    )
    translate_x = VIEWBOX_WIDTH / 2 - ((min(xs) + max(xs)) / 2) * scale
    translate_y = VIEWBOX_HEIGHT / 2 - ((min(ys) + max(ys)) / 2) * scale
    return scale, translate_x, translate_y


def mercator_raw(longitude: float, latitude: float) -> tuple[float, float]:
    limit = 85.0511287798066
    phi = math.radians(max(-limit, min(limit, latitude)))
    return math.radians(longitude), -math.log(math.tan(math.pi / 4 + phi / 2))


PROJECT_SCALE, PROJECT_TRANSLATE_X, PROJECT_TRANSLATE_Y = projection_parameters()


def project_point(coordinate: Iterable[float]) -> list[float]:
    longitude, latitude = coordinate
    x, y = mercator_raw(float(longitude), float(latitude))
    return [
        round_number(x * PROJECT_SCALE + PROJECT_TRANSLATE_X, 2),
        round_number(y * PROJECT_SCALE + PROJECT_TRANSLATE_Y, 2),
    ]


def target_transform(width: int, height: int) -> Affine:
    if width / height != OUTPUT_WIDTH / OUTPUT_HEIGHT:
        raise ValueError("Mercator raster output must preserve the 1200:650 viewBox ratio")
    epsg_x, _ = transform("EPSG:4326", RASTER_TARGET_CRS, [180.0], [0.0])
    raw_x, _ = mercator_raw(180.0, 0.0)
    equal_earth_radius = epsg_x[0] / raw_x
    viewbox_pixels_per_metre = PROJECT_SCALE / equal_earth_radius
    output_multiplier = width / VIEWBOX_WIDTH
    output_pixels_per_metre = viewbox_pixels_per_metre * output_multiplier
    metre_per_pixel = 1 / output_pixels_per_metre
    return Affine(
        metre_per_pixel,
        0,
        -PROJECT_TRANSLATE_X / viewbox_pixels_per_metre,
        0,
        -metre_per_pixel,
        PROJECT_TRANSLATE_Y / viewbox_pixels_per_metre,
    )


def sphere_mask(width: int, height: int) -> np.ndarray:
    multiplier = width / VIEWBOX_WIDTH
    outline = [
        (round(x * multiplier), round(y * multiplier))
        for x, y in (project_point(point) for point in sphere_coordinates())
    ]
    image = Image.new("L", (width, height), color=0)
    ImageDraw.Draw(image).polygon(outline, fill=255)
    return np.asarray(image, dtype=np.uint8)


def sphere_window_mask(width: int, height: int, window: Window) -> np.ndarray:
    """Clip a tile without allocating a full high-resolution global mask."""
    multiplier = width / VIEWBOX_WIDTH
    outline = [
        (round(x * multiplier - window.col_off), round(y * multiplier - window.row_off))
        for x, y in (project_point(point) for point in sphere_coordinates())
    ]
    image = Image.new("L", (int(window.width), int(window.height)), color=0)
    ImageDraw.Draw(image).polygon(outline, fill=255)
    return np.asarray(image, dtype=np.uint8)


def extract_member(zip_path: Path, member: str, destination: Path) -> Path:
    with zipfile.ZipFile(zip_path) as archive:
        info = archive.getinfo(member)
        target = destination / Path(member).name
        with archive.open(info) as source, target.open("wb") as output:
            shutil.copyfileobj(source, output, length=1024 * 1024)
    return target


def parse_color(value: str) -> np.ndarray:
    return np.array([int(value[index : index + 2], 16) for index in (1, 3, 5)], dtype=np.float32)


def render_population(values: np.ndarray, valid_mask: np.ndarray) -> np.ndarray:
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    valid = valid_mask & np.isfinite(values) & (values > 0)
    if not np.any(valid):
        return rgba

    stop_values = np.array([math.log1p(stop["value"]) for stop in POPULATION_STOPS])
    stop_colors = np.array([parse_color(stop["color"]) for stop in POPULATION_STOPS])
    stop_alpha = np.array([round(stop["opacity"] * 255) for stop in POPULATION_STOPS])
    mapped = np.clip(np.log1p(np.maximum(values, 0)), stop_values[0], stop_values[-1])
    indexes = np.searchsorted(stop_values, mapped, side="right") - 1
    indexes = np.clip(indexes, 0, len(stop_values) - 2)
    left = stop_values[indexes]
    right = stop_values[indexes + 1]
    fraction = np.divide(mapped - left, right - left, out=np.zeros_like(mapped), where=right != left)

    colors = stop_colors[indexes] + (stop_colors[indexes + 1] - stop_colors[indexes]) * fraction[..., None]
    alpha = stop_alpha[indexes] + (stop_alpha[indexes + 1] - stop_alpha[indexes]) * fraction
    rgba[..., :3][valid] = np.clip(colors[valid], 0, 255).astype(np.uint8)
    rgba[..., 3][valid] = np.clip(alpha[valid], 0, 255).astype(np.uint8)
    return rgba


def warp_population(source_path: Path, width: int, height: int) -> tuple[np.ndarray, dict[str, Any]]:
    destination = np.full((height, width), np.nan, dtype=np.float32)
    with rasterio.open(source_path) as source:
        reproject(
            source=rasterio.band(source, 1),
            destination=destination,
            src_transform=source.transform,
            src_crs=source.crs,
            src_nodata=source.nodata,
            dst_transform=target_transform(width, height),
            dst_crs=RASTER_TARGET_CRS,
            dst_nodata=np.nan,
            resampling=Resampling.average,
            init_dest_nodata=True,
            num_threads=max(1, min(8, os.cpu_count() or 1)),
        )
    mask = (sphere_mask(width, height) > 0) & np.isfinite(destination) & (destination >= 0)
    observed = destination[mask & (destination > 0)]
    statistics = {
        "positiveOutputPixels": int(observed.size),
        "percentilesPeoplePerSquareKilometre": {
            str(percentile): round_number(np.percentile(observed, percentile), 2)
            for percentile in (25, 50, 75, 90, 95, 99, 99.9)
        },
        "maximumPeoplePerSquareKilometre": round_number(np.max(observed), 2),
    }
    return render_population(destination, mask), statistics


def warp_relief(source_path: Path, width: int, height: int) -> np.ndarray:
    destination = np.zeros((height, width), dtype=np.uint8)
    with rasterio.open(source_path) as source:
        reproject(
            source=rasterio.band(source, 1),
            destination=destination,
            src_transform=source.transform,
            src_crs=source.crs,
            dst_transform=target_transform(width, height),
            dst_crs=RASTER_TARGET_CRS,
            dst_nodata=0,
            resampling=Resampling.bilinear,
            init_dest_nodata=True,
            num_threads=max(1, min(8, os.cpu_count() or 1)),
        )
    mask = sphere_mask(width, height)
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    # Source-authored shading only: display opacity belongs to the layer.
    # Do not turn broad overview shading into faux terrain with extra contrast.
    rgba[..., 0] = destination
    rgba[..., 1] = destination
    rgba[..., 2] = destination
    rgba[..., 3] = mask
    return rgba


def write_webp(rgba: np.ndarray, output_path: Path, *, lossless: bool) -> None:
    Image.fromarray(rgba, mode="RGBA").save(
        output_path,
        format="WEBP",
        lossless=lossless,
        quality=92,
        method=6,
        exact=True,
    )


def verify_raster_registration() -> list[dict[str, Any]]:
    """Check geographically dispersed landmarks against the exact SVG formula."""
    landmarks = {"Nile delta": [31, 30], "Himalayan foothills": [77, 29], "Java": [107, -7], "Central Europe": [6, 50]}
    affine = target_transform(OUTPUT_WIDTH, OUTPUT_HEIGHT)
    results = []
    for name, coordinate in landmarks.items():
        x, y = transform("EPSG:4326", RASTER_TARGET_CRS, [coordinate[0]], [coordinate[1]])
        pixel_x, pixel_y = ~affine * (x[0], y[0])
        raster_point = [pixel_x / 2, pixel_y / 2]
        svg_point = project_point(coordinate)
        error = math.hypot(raster_point[0] - svg_point[0], raster_point[1] - svg_point[1])
        if error > 0.008:
            raise ValueError(f"Raster/SVG registration failed at {name}: {error} viewBox units")
        results.append({"name": name, "wgs84": coordinate, "maximumErrorViewBoxUnits": round_number(error, 6)})
    return results


def build_population_pyramid(source_path: Path, asset_output: Path) -> dict[str, Any]:
    """Warp each detail tile directly from the original one-kilometre source.

    Never upscale the overview. GDAL reads the source windows needed by each
    tile, so no 200-million-pixel display image is allocated by the build or
    decoded by a browser. Entirely empty tiles are absent from the manifest.
    """
    levels = []
    with rasterio.Env(GDAL_CACHEMAX=128 * 1024 * 1024), rasterio.open(source_path) as source:
        for level in POPULATION_DETAIL_LEVELS:
            width, height = level["width"], level["height"]
            tile_width, tile_height = width // level["columns"], height // level["rows"]
            folder = asset_output / "population-density-2025-mercator" / level["id"]
            folder.mkdir(parents=True, exist_ok=True)
            tiles = []
            with WarpedVRT(
                source,
                crs=RASTER_TARGET_CRS,
                transform=target_transform(width, height),
                width=width,
                height=height,
                nodata=np.nan,
                dtype="float32",
                resampling=Resampling.average,
                warp_mem_limit=64,
            ) as warped:
                for row in range(level["rows"]):
                    for column in range(level["columns"]):
                        window = Window(column * tile_width, row * tile_height, tile_width, tile_height)
                        values = warped.read(1, window=window)
                        mask = (sphere_window_mask(width, height, window) > 0) & np.isfinite(values) & (values > 0)
                        if not np.any(mask):
                            continue
                        rgba = render_population(values, mask)
                        asset = folder / f"{column}-{row}.webp"
                        write_webp(rgba, asset, lossless=True)
                        tiles.append({
                            "id": f"{level['id']}:{column}:{row}",
                            "href": f"/atlas-world/layers/population-density-2025-mercator/{level['id']}/{column}-{row}.webp",
                            "mediaType": "image/webp",
                            "width": tile_width,
                            "height": tile_height,
                            "viewBox": [round_number(window.col_off * VIEWBOX_WIDTH / width), round_number(window.row_off * VIEWBOX_HEIGHT / height), round_number(tile_width * VIEWBOX_WIDTH / width), round_number(tile_height * VIEWBOX_HEIGHT / height)],
                            "checksumSha256": sha256_file(asset),
                            "bytes": asset.stat().st_size,
                        })
                    print(f"Population {level['id']}: row {row + 1}/{level['rows']}", flush=True)
            levels.append({
                "id": level["id"],
                "minimumZoom": level["minimumZoom"],
                "width": width,
                "height": height,
                "displayMetresPerPixel": round_number(target_transform(width, height).a, 2),
                "tiles": tiles,
                "bytes": sum(tile["bytes"] for tile in tiles),
            })
    return {
        "projectionId": "mercator",
        "sourceResolutionMetres": 1000,
        "sourceCrs": "ESRI:54009",
        "resampling": "average",
        "maximumDecodedTileBytes": 1200 * 1300 * 4,
        "compositing": "replace-overview-inside-loaded-tile; never alpha-stack density resolutions",
        "emptyTileBehavior": "transparent; no population estimate rendered",
        "levels": levels,
    }


def build_relief_pyramid(source_path: Path, asset_output: Path) -> dict[str, Any]:
    """Keep native-ish source detail without decoding a whole global raster.

    The 800 × 650 tiles reuse the existing viewport/masked-fallback renderer.
    One directly source-derived level starts at zoom 8; later zoom enlarges it
    honestly rather than manufacturing local terrain detail.
    """
    levels = []
    with rasterio.Env(GDAL_CACHEMAX=64 * 1024 * 1024), rasterio.open(source_path) as source:
        source_resolution_metres = 2 * math.pi * EQUAL_EARTH_RADIUS / 360 * abs(source.transform.a)
        source_pixel_degrees = [abs(source.transform.a), abs(source.transform.e)]
        source_dimensions = [source.width, source.height]
        for level in RELIEF_DETAIL_LEVELS:
            width, height = level["width"], level["height"]
            tile_width, tile_height = width // level["columns"], height // level["rows"]
            folder = asset_output / "physical-relief-mercator" / level["id"]
            folder.mkdir(parents=True, exist_ok=True)
            tiles = []
            with WarpedVRT(source, crs=RASTER_TARGET_CRS, transform=target_transform(width, height),
                           width=width, height=height, nodata=0, dtype="uint8",
                           resampling=Resampling.bilinear, warp_mem_limit=32) as warped:
                for row in range(level["rows"]):
                    for column in range(level["columns"]):
                        window = Window(column * tile_width, row * tile_height, tile_width, tile_height)
                        mask = sphere_window_mask(width, height, window)
                        if not np.any(mask):
                            continue
                        values = warped.read(1, window=window)
                        rgba = np.zeros((tile_height, tile_width, 4), dtype=np.uint8)
                        rgba[..., :3] = values[..., None]
                        rgba[..., 3] = mask
                        asset = folder / f"{column}-{row}.webp"
                        write_webp(rgba, asset, lossless=True)
                        tiles.append({
                            "id": f"relief:{level['id']}:{column}:{row}",
                            "href": f"/atlas-world/layers/physical-relief-mercator/{level['id']}/{column}-{row}.webp",
                            "mediaType": "image/webp", "width": tile_width, "height": tile_height,
                            "viewBox": [round_number(window.col_off * VIEWBOX_WIDTH / width), round_number(window.row_off * VIEWBOX_HEIGHT / height), round_number(tile_width * VIEWBOX_WIDTH / width), round_number(tile_height * VIEWBOX_HEIGHT / height)],
                            "checksumSha256": sha256_file(asset), "bytes": asset.stat().st_size,
                        })
                    print(f"Relief {level['id']}: row {row + 1}/{level['rows']}", flush=True)
            levels.append({"id": level["id"], "minimumZoom": level["minimumZoom"], "width": width, "height": height,
                           "displayMetresPerPixel": round_number(target_transform(width, height).a, 2),
                           "tiles": tiles, "bytes": sum(tile["bytes"] for tile in tiles)})
    total_bytes = sum(level["bytes"] for level in levels)
    if total_bytes > 35_000_000:
        raise ValueError(f"Relief payload exceeds the reviewed global 35 MB budget: {total_bytes}")
    return {
        "projectionId": "mercator", "sourceResolutionMetres": round_number(source_resolution_metres, 2),
        "sourcePixelDegrees": source_pixel_degrees, "nativeSourceDimensions": source_dimensions,
        "sourceCrs": "EPSG:4326", "resampling": "bilinear", "maximumDecodedTileBytes": 800 * 650 * 4,
        "compositing": "replace-overview-inside-loaded-tile; never stack relief resolutions",
        "emptyTileBehavior": "transparent outside the projected sphere",
        "levels": levels,
    }


def refresh_relief_dataset(pack: dict[str, Any], source_path: Path, asset_output: Path, width: int, height: int) -> None:
    asset = asset_output / "physical-relief.mercator.webp"
    write_webp(warp_relief(source_path, width, height), asset, lossless=True)
    relief = next(dataset for dataset in pack["datasets"] if dataset["id"] == "physical-relief")
    relief["asset"] = {"href": "/atlas-world/layers/physical-relief.mercator.webp", "mediaType": "image/webp",
                       "width": width, "height": height, "viewBox": [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
                       "checksumSha256": sha256_file(asset), "bytes": asset.stat().st_size}
    relief["assetPyramid"] = build_relief_pyramid(source_path, asset_output)
    relief["transformationId"] = RELIEF_TRANSFORMATION_ID
    relief["geographicResolution"] = "1:50m cartographic source; 1/30 degree source pixels (~3.71 km at equator), ~4.02 km projected detail pixels"
    relief["visualization"] = {"recommendedOpacity": 0.34, "recommendedBlendMode": "multiply", "shadowContrast": 1.0}
    relief["caveats"] = [
        "This is generalized manually authored cartographic relief, not a measured elevation surface or a DEM.",
        "Source pixel spacing is 1/30 degree (~3.71 km at the equator), not a claim of spatial accuracy. Display pixel ground scale changes with latitude.",
        "The overview and detail tiles are independently resampled from the same original source. Further zoom does not add topographic information.",
        "Grayscale remains source-authored: no sharpening, embossed borders, generated hills, or synthetic texture is added.",
    ]
    transformation = next(item for item in pack["transformations"] if item["id"].startswith("natural-earth-relief-to-mercator-raster-"))
    transformation.update({"id": RELIEF_TRANSFORMATION_ID, "description": RELIEF_TRANSFORMATION_DESCRIPTION})


def geometry_coordinates(geometry: dict[str, Any]) -> list[list[float]]:
    coordinates: list[list[float]] = []

    def visit(value: Any) -> None:
        if (
            isinstance(value, list)
            and len(value) >= 2
            and isinstance(value[0], (int, float))
            and isinstance(value[1], (int, float))
        ):
            coordinates.append([float(value[0]), float(value[1])])
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(geometry["coordinates"])
    return coordinates


def canonical_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
    def rounded(value: Any) -> Any:
        if isinstance(value, (int, float)):
            return round_number(value)
        if isinstance(value, (list, tuple)):
            return [rounded(child) for child in value]
        return value

    return {"type": geometry["type"], "coordinates": rounded(geometry["coordinates"])}


def line_path(coordinates: list[list[float]], close: bool = False) -> str:
    commands = []
    for index, (x, y) in enumerate([project_point(coordinate) for coordinate in coordinates]):
        commands.append(f"{'M' if index == 0 else 'L'}{x:g},{y:g}")
    return "".join(commands) + ("Z" if close else "")


def projected_path(geometry: dict[str, Any]) -> str:
    geometry_type = geometry["type"]
    coordinates = geometry["coordinates"]
    if geometry_type == "LineString":
        return line_path(coordinates)
    if geometry_type == "MultiLineString":
        return "".join(line_path(line) for line in coordinates)
    if geometry_type == "Polygon":
        return "".join(line_path(ring, True) for ring in coordinates)
    if geometry_type == "MultiPolygon":
        return "".join(line_path(ring, True) for polygon in coordinates for ring in polygon)
    raise ValueError(f"Unsupported vector geometry type: {geometry_type}")


def geometry_bounds(geometry: dict[str, Any]) -> list[list[float]]:
    coordinates = geometry_coordinates(geometry)
    xs = [coordinate[0] for coordinate in coordinates]
    ys = [coordinate[1] for coordinate in coordinates]
    return [
        [round_number(min(xs)), round_number(min(ys))],
        [round_number(max(xs)), round_number(max(ys))],
    ]


def projected_bounds(geometry: dict[str, Any]) -> list[list[float]]:
    points = [project_point(coordinate) for coordinate in geometry_coordinates(geometry)]
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return [
        [round_number(min(xs), 2), round_number(min(ys), 2)],
        [round_number(max(xs), 2), round_number(max(ys), 2)],
    ]


def feature_hash(name: str, geometry: dict[str, Any]) -> str:
    payload = json.dumps([name, canonical_geometry(geometry)], separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf8")).hexdigest()[:16]


def normalized_name(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_value = "".join(character for character in decomposed if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]+", " ", ascii_value.casefold()).strip()


def feature_aliases(properties: dict[str, Any], display_name: str) -> list[str]:
    aliases: list[str] = []
    seen = {normalized_name(display_name)}
    for key in ("label", "name", "name_en", "name_alt", "name_abb", "LABEL", "NAME", "NAME_EN", "NAMEALT", "NAMEASCII"):
        value = properties.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        name = value.strip()
        normalized = normalized_name(name)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        aliases.append(name)
    return aliases


def logical_physical_place_id(
    properties: dict[str, Any],
    kind: str,
    source_id: str,
    identity: str,
    names: list[str],
) -> str:
    if kind == "lake":
        natural_earth_id = properties.get("ne_id")
        if natural_earth_id not in (None, ""):
            return f"place:natural-earth:lake:{natural_earth_id}"
    if kind == "river":
        normalized_names = {normalized_name(name) for name in names}
        for system_name, aliases in RIVER_SYSTEM_ALIASES.items():
            if normalized_names.intersection(aliases):
                return f"place:natural-earth:river:{system_name}"
        river_number = properties.get("rivernum")
        if source_id == DETAIL_RIVER_SOURCE_ID and river_number not in (None, "", 0, -99):
            return f"place:natural-earth:river:10m-{river_number}"
    source_scale = "10m" if "10m" in source_id else "50m"
    return f"place:natural-earth:{kind}:{source_scale}-{identity}"


def temporal_extent(observed_at: str | None = None, precision: str = "source_snapshot") -> dict[str, Any]:
    return {
        "observedAt": observed_at,
        "validFrom": None,
        "validTo": None,
        "precision": precision,
    }


def vector_feature(
    feature: dict[str, Any],
    *,
    kind: str,
    source_id: str,
    source_identity: str | int | None,
    feature_identity: str | None = None,
) -> dict[str, Any]:
    properties = feature["properties"]
    name = (
        (properties.get("label") or properties.get("name") or properties.get("name_en"))
        if kind == "lake"
        else (properties.get("name_en") or properties.get("name") or properties.get("label"))
    ) or "Unnamed feature"
    raw_source_identity = str(source_identity) if source_identity not in (None, "") else None
    identity = feature_identity or raw_source_identity or feature_hash(name, feature["geometry"])
    feature_id = f"feature:natural-earth:{kind}:{identity}"
    geometry = canonical_geometry(feature["geometry"])
    source_min_zoom = properties.get("min_zoom")
    aliases = feature_aliases(properties, name)
    return {
        "featureId": feature_id,
        "placeId": logical_physical_place_id(properties, kind, source_id, identity, [name, *aliases]),
        "kind": kind,
        "name": name,
        "alternateName": properties.get("name_alt"),
        "aliases": aliases,
        "entityIds": [],
        "entityRelation": {
            "kind": "intersects_mapped_admin0_geometry",
            "method": "natural-earth-admin0-intersection-v1",
        },
        "sourceIds": [source_id],
        "sourceFeatureId": raw_source_identity or identity,
        "sourceScaleRank": properties.get("scalerank"),
        "sourceMinZoom": source_min_zoom,
        "displayLod": "world" if number_or_default(source_min_zoom, 99) <= 2 else "regional",
        "temporal": temporal_extent(),
        "geometry": {
            "geometryId": f"geometry:{feature_id}:wgs84",
            "geometrySetId": "natural-earth-physical-50m-5.1.2",
            "geometryType": geometry["type"].lower(),
            "crs": "EPSG:4326",
            "canonicalWgs84": geometry,
            "boundsWgs84": geometry_bounds(geometry),
            "derived": {
                "projectionId": "mercator",
                "viewBox": [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
                "path": projected_path(geometry),
                "bounds": projected_bounds(geometry),
                "transformationId": "wgs84-to-mercator-svg-v1",
            },
        },
    }


def attach_admin0_relations(
    features: list[dict[str, Any]],
    source_cache: Path,
    lock_by_id: dict[str, Any],
    countries: dict[str, Any],
) -> None:
    admin0_payload = json.loads((source_cache / lock_by_id[ADMIN0_SOURCE_ID]["target"]).read_text("utf8"))
    entity_by_code = {
        country["codes"]["naturalEarthAdm0A3"]: country["id"]
        for country in countries["countries"]
    }
    indexed: list[tuple[str, Any]] = []
    for raw_feature in admin0_payload["features"]:
        properties = raw_feature.get("properties") or {}
        entity_id = entity_by_code.get(properties.get("ADM0_A3"))
        if not entity_id or not raw_feature.get("geometry"):
            continue
        geometry = shape(raw_feature["geometry"])
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        indexed.append((entity_id, geometry))
    geometries = [entry[1] for entry in indexed]
    tree = STRtree(geometries)
    for feature in features:
        feature_geometry = shape(feature["geometry"]["canonicalWgs84"])
        intersecting = tree.query(feature_geometry, predicate="intersects")
        feature["entityIds"] = sorted({indexed[int(index)][0] for index in intersecting})


def admin0_spatial_index(
    source_cache: Path,
    lock_by_id: dict[str, Any],
    countries: dict[str, Any],
) -> tuple[list[tuple[str, Any]], STRtree]:
    payload = json.loads((source_cache / lock_by_id[ADMIN0_SOURCE_ID]["target"]).read_text("utf8"))
    entity_by_code = {
        country["codes"]["naturalEarthAdm0A3"]: country["id"]
        for country in countries["countries"]
    }
    indexed: list[tuple[str, Any]] = []
    for raw_feature in payload["features"]:
        properties = raw_feature.get("properties") or {}
        entity_id = entity_by_code.get(properties.get("ADM0_A3"))
        if not entity_id or not raw_feature.get("geometry"):
            continue
        geometry = shape(raw_feature["geometry"])
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        indexed.append((entity_id, geometry))
    return indexed, STRtree([entry[1] for entry in indexed])


def geometry_record(feature_id: str, geometry: dict[str, Any], geometry_set_id: str) -> dict[str, Any]:
    canonical = canonical_geometry(geometry)
    return {
        "geometryId": f"geometry:{feature_id}:wgs84",
        "geometrySetId": geometry_set_id,
        "geometryType": canonical["type"].lower(),
        "crs": "EPSG:4326",
        "canonicalWgs84": canonical,
        "boundsWgs84": geometry_bounds(canonical),
        "derived": {
            "projectionId": "mercator",
            "viewBox": [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
            "path": projected_path(canonical),
            "bounds": projected_bounds(canonical),
            "transformationId": "wgs84-to-mercator-svg-v1",
        },
    }


def load_water_bodies(
    source_cache: Path,
    lock_by_id: dict[str, Any],
    countries: dict[str, Any],
) -> list[dict[str, Any]]:
    payload = json.loads((source_cache / lock_by_id[WATER_SOURCE_ID]["target"]).read_text("utf8"))
    indexed_admin0, tree = admin0_spatial_index(source_cache, lock_by_id, countries)
    candidates = []
    source_id_counts: dict[str, int] = {}
    for raw_feature in payload["features"]:
        properties = raw_feature.get("properties") or {}
        water_kind = str(properties.get("featurecla") or "").casefold()
        name = properties.get("name_en") or properties.get("name") or properties.get("label")
        rank = int(properties.get("scalerank") if properties.get("scalerank") is not None else 99)
        if water_kind not in WATER_CLASSES or rank > WATER_MAX_SCALE_RANK or not name or not raw_feature.get("geometry"):
            continue
        candidates.append(raw_feature)
        source_identity = str(properties.get("ne_id") or "")
        source_id_counts[source_identity] = source_id_counts.get(source_identity, 0) + 1

    features = []
    for raw_feature in candidates:
        properties = raw_feature["properties"]
        water_kind = str(properties["featurecla"]).casefold()
        name = str(properties.get("name_en") or properties.get("name") or properties.get("label")).strip()
        source_identity = str(properties.get("ne_id") or feature_hash(name, raw_feature["geometry"]))
        feature_identity = source_identity
        if source_id_counts.get(str(properties.get("ne_id") or ""), 0) > 1:
            feature_identity = f"{source_identity}:{feature_hash(name, raw_feature['geometry'])}"
        feature_id = f"feature:natural-earth:water:{feature_identity}"
        wikidata_id = str(properties.get("wikidataid") or "").strip() or None
        place_identity = wikidata_id.casefold() if wikidata_id else source_identity
        source_shape = shape(raw_feature["geometry"])
        if not source_shape.is_valid:
            source_shape = source_shape.buffer(0)
        representative = source_shape.representative_point()
        coastline_probe = source_shape.boundary.buffer(WATER_COASTLINE_TOLERANCE_DEGREES)
        adjacent = tree.query(coastline_probe, predicate="intersects")
        adjacent_ids = sorted({indexed_admin0[int(index)][0] for index in adjacent})
        rank = int(properties.get("scalerank") or 0)
        minimum_zoom = {0: 1, 1: 1, 2: 2, 3: 4, 4: 7}[rank]
        maximum_source_zoom = properties.get("max_label")
        label_anchor_wgs84 = [round_number(representative.x), round_number(representative.y)]
        features.append({
            "featureId": feature_id,
            "placeId": f"place:natural-earth:water:{place_identity}",
            "kind": "water",
            "waterKind": water_kind,
            "name": name,
            "aliases": feature_aliases(properties, name),
            "wikidataId": wikidata_id,
            "adjacentEntityIds": adjacent_ids,
            "entityRelation": {
                "kind": "coastline_adjacent_to_mapped_admin0_geometry",
                "method": "natural-earth-marine-admin0-coastline-proximity-v1",
                "toleranceDegrees": WATER_COASTLINE_TOLERANCE_DEGREES,
                "caveat": "Adjacency is derived from generalized Natural Earth coastline proximity. It is not ownership, jurisdiction, or a maritime-boundary claim.",
            },
            "label": {
                "anchorWgs84": label_anchor_wgs84,
                "anchorProjected": project_point(label_anchor_wgs84),
                "priority": max(1, 10 - rank * 2),
                "minimumZoom": minimum_zoom,
                "maximumZoom": None,
                "sourceMinimumLabelScale": properties.get("min_label"),
                "sourceMaximumLabelScale": maximum_source_zoom,
                "method": "representative-point-within-source-polygon",
            },
            "sourceIds": [WATER_SOURCE_ID],
            "sourceFeatureId": source_identity,
            "sourceScaleRank": rank,
            "sourceMinZoom": properties.get("min_label"),
            "displayLod": "world" if rank <= 1 else ("regional" if rank <= 3 else "country"),
            "displayMinimumZoom": minimum_zoom,
            "temporal": temporal_extent(),
            "geometry": geometry_record(feature_id, raw_feature["geometry"], "natural-earth-marine-10m-5.1.2"),
        })
    return sorted(features, key=lambda feature: (feature["sourceScaleRank"], feature["name"], feature["featureId"]))


def shapefile_from_zip(zip_path: Path) -> shapefile.Reader:
    with zipfile.ZipFile(zip_path) as archive:
        members = {Path(name).suffix.casefold(): name for name in archive.namelist()}
        return shapefile.Reader(
            shp=io.BytesIO(archive.read(members[".shp"])),
            shx=io.BytesIO(archive.read(members[".shx"])),
            dbf=io.BytesIO(archive.read(members[".dbf"])),
            encoding="latin1",
        )


def load_watershed_pilot(
    source_cache: Path,
    lock_by_id: dict[str, Any],
    countries: dict[str, Any],
) -> list[dict[str, Any]]:
    reader = shapefile_from_zip(source_cache / lock_by_id[BASIN_SOURCE_ID]["target"])
    geometries_by_name: dict[str, list[tuple[int, Any]]] = {name: [] for name in BASIN_PILOT}
    for shape_record in reader.iterShapeRecords():
        record = shape_record.record.as_dict()
        name = str(record.get("NAME") or "")
        if name not in BASIN_PILOT:
            continue
        source_id = int(record["BASWC4_ID"])
        if source_id not in BASIN_PILOT[name]["sourceIds"]:
            continue
        geometry = shape(shape_record.shape.__geo_interface__)
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        geometries_by_name[name].append((source_id, geometry))

    indexed_admin0, tree = admin0_spatial_index(source_cache, lock_by_id, countries)
    features = []
    for name, definition in BASIN_PILOT.items():
        source_parts = geometries_by_name[name]
        actual_ids = sorted(source_id for source_id, _ in source_parts)
        if actual_ids != sorted(definition["sourceIds"]):
            raise ValueError(f"World Bank basin pilot source IDs changed for {name}: {actual_ids}")
        unioned = unary_union([geometry for _, geometry in source_parts])
        if not unioned.is_valid:
            unioned = unioned.buffer(0)
        raw_geometry = mapping(unioned)
        slug = normalized_name(name).replace(" ", "-")
        feature_id = f"feature:world-bank:watershed:{slug}"
        place_id = f"place:world-bank:watershed:{slug}"
        representative = unioned.representative_point()
        intersecting = tree.query(unioned, predicate="intersects")
        entity_ids = sorted({indexed_admin0[int(index)][0] for index in intersecting})
        anchor_wgs84 = [round_number(representative.x), round_number(representative.y)]
        features.append({
            "featureId": feature_id,
            "placeId": place_id,
            "kind": "watershed",
            "name": f"{name} drainage basin",
            "aliases": [f"{name} basin", f"{name} watershed"],
            "linkedRiverPlaceId": definition["riverPlaceId"],
            "sourceIds": [BASIN_SOURCE_ID],
            "sourceFeatureIds": [f"BASWC4_ID:{source_id}" for source_id in actual_ids],
            "intersectingEntityIds": entity_ids,
            "entityRelation": {
                "kind": "intersects_mapped_admin0_geometry",
                "method": "world-bank-basin-admin0-intersection-v1",
                "caveat": "Country relations are geometric intersections with a generalized drainage basin. They do not imply ownership or control of shared water.",
            },
            "label": {
                "anchorWgs84": anchor_wgs84,
                "anchorProjected": project_point(anchor_wgs84),
                "priority": 8,
                "minimumZoom": 3,
                "method": "representative-point-within-derived-union",
            },
            "temporal": temporal_extent("2019-06-25", "day"),
            "geometry": geometry_record(feature_id, raw_geometry, "world-bank-major-river-basins-2019-pilot"),
        })
    return sorted(features, key=lambda feature: feature["name"])


def find_statement(entity: dict[str, Any], property_id: str, statement_id: str) -> dict[str, Any]:
    matches = [statement for statement in entity.get("claims", {}).get(property_id, []) if statement.get("id") == statement_id]
    if len(matches) != 1:
        raise ValueError(f"Pinned Wikidata statement missing or ambiguous: {statement_id}")
    statement = matches[0]
    if statement.get("rank") == "deprecated" or statement.get("mainsnak", {}).get("snaktype") != "value":
        raise ValueError(f"Pinned Wikidata statement is not an active value: {statement_id}")
    return statement


def statement_value(statement: dict[str, Any]) -> Any:
    return statement["mainsnak"]["datavalue"]["value"]


def item_id(statement: dict[str, Any]) -> str:
    value = statement_value(statement)
    if not isinstance(value, dict) or not value.get("id"):
        raise ValueError(f"Expected an item-valued Wikidata statement: {statement.get('id')}")
    return str(value["id"])


def attach_river_pilot_facts(
    rivers: list[dict[str, Any]],
    source_cache: Path,
    lock_by_id: dict[str, Any],
) -> None:
    entities = json.loads((source_cache / lock_by_id[RIVER_FACT_SOURCE_ID]["target"]).read_text("utf8"))["entities"]
    linked = json.loads((source_cache / lock_by_id[RIVER_LABEL_SOURCE_ID]["target"]).read_text("utf8"))["entities"]
    labels = {entity_id: entity.get("labels", {}).get("en", {}).get("value") for entity_id, entity in linked.items()}

    def label_for(entity_id: str) -> str:
        label = labels.get(entity_id)
        if not label:
            raise ValueError(f"Pinned Wikidata linked-label snapshot is missing {entity_id}")
        return str(label)

    for place_id, selection in RIVER_FACT_SELECTIONS.items():
        entity = entities.get(selection["entityId"])
        if not entity:
            raise ValueError(f"Pinned Wikidata river snapshot is missing {selection['entityId']}")
        length_statement = find_statement(entity, *selection["length"])
        length_value = statement_value(length_statement)
        if not isinstance(length_value, dict) or not str(length_value.get("unit", "")).endswith("/Q828224"):
            raise ValueError(f"River length unit changed for {place_id}")
        headwater_statements = [find_statement(entity, *statement) for statement in selection["headwaters"]]
        mouth_statement = find_statement(entity, *selection["mouth"])
        basin_statement = find_statement(entity, *selection["basin"])
        area_statement = find_statement(entity, *selection["basinArea"])
        area_value = statement_value(area_statement)
        if not isinstance(area_value, dict) or not str(area_value.get("unit", "")).endswith("/Q712226"):
            raise ValueError(f"River basin-area unit changed for {place_id}")
        tributary_statements = [find_statement(entity, *statement) for statement in selection["tributaries"]]
        headwater_names = [label_for(item_id(statement)) for statement in headwater_statements]
        common_notes = [
            "Bounded River V2 pilot sourced from pinned Wikidata structured statements; it is not a live hydrology service.",
            *selection["notes"],
        ]
        text_sources = [RIVER_FACT_SOURCE_ID, RIVER_LABEL_SOURCE_ID]
        facts = {
            "lengthKm": {
                "value": round_number(float(length_value["amount"]), 2),
                "status": "estimated",
                "unit": "kilometres",
                "observedAt": "2026-09-05",
                "sourceIds": [RIVER_FACT_SOURCE_ID],
                "sourceStatementIds": [length_statement["id"]],
                "notes": common_notes,
            },
            "sourcePlace": ({
                "value": headwater_names[0],
                "status": "observed",
                "unit": None,
                "observedAt": "2026-09-05",
                "sourceIds": text_sources,
                "sourceStatementIds": [headwater_statements[0]["id"]],
                "notes": common_notes,
            } if len(headwater_names) == 1 else None),
            "headwaters": {
                "value": headwater_names,
                "status": "observed",
                "unit": None,
                "observedAt": "2026-09-05",
                "sourceIds": text_sources,
                "sourceStatementIds": [statement["id"] for statement in headwater_statements],
                "notes": [*common_notes, "Headwater naming and the definition of a river's source can vary."],
            },
            "mouthPlace": {
                "value": label_for(item_id(mouth_statement)),
                "status": "observed",
                "unit": None,
                "observedAt": "2026-09-05",
                "sourceIds": text_sources,
                "sourceStatementIds": [mouth_statement["id"]],
                "notes": common_notes,
            },
            "basinName": {
                "value": label_for(item_id(basin_statement)),
                "status": "observed",
                "unit": None,
                "observedAt": "2026-09-05",
                "sourceIds": text_sources,
                "sourceStatementIds": [basin_statement["id"]],
                "notes": common_notes,
            },
            "basinAreaKm2": {
                "value": round_number(float(area_value["amount"]), 2),
                "status": "estimated",
                "unit": "square kilometres",
                "observedAt": "2026-09-05",
                "sourceIds": [RIVER_FACT_SOURCE_ID],
                "sourceStatementIds": [area_statement["id"]],
                "notes": [*common_notes, "Basin-area estimates can vary with watershed delineation and source method."],
            },
            "majorTributaries": {
                "value": [label_for(item_id(statement)) for statement in tributary_statements],
                "status": "observed",
                "unit": None,
                "observedAt": "2026-09-05",
                "sourceIds": text_sources,
                "sourceStatementIds": [statement["id"] for statement in tributary_statements],
                "notes": [*common_notes, "This is an authored, non-exhaustive selection from structured tributary statements."],
            },
        }
        matching = [feature for feature in rivers if feature["placeId"] == place_id]
        if not matching:
            raise ValueError(f"River V2 pilot could not find mapped geometry for {place_id}")
        anchor = sorted(matching, key=lambda feature: (0 if RIVER_SOURCE_ID in feature["sourceIds"] else 1, feature["featureId"]))[0]
        anchor["facts"] = facts
        anchor["sourceIds"] = sorted(set([*anchor["sourceIds"], RIVER_FACT_SOURCE_ID, RIVER_LABEL_SOURCE_ID]))


def haversine_km(left: Any, right: Any) -> float:
    left_lon, left_lat, right_lon, right_lat = map(math.radians, [left.x, left.y, right.x, right.y])
    delta_lon = right_lon - left_lon
    delta_lat = right_lat - left_lat
    amount = math.sin(delta_lat / 2) ** 2 + math.cos(left_lat) * math.cos(right_lat) * math.sin(delta_lon / 2) ** 2
    return 6371.0088 * 2 * math.asin(min(1, math.sqrt(amount)))


def build_city_relationship_pilot(
    rivers: list[dict[str, Any]],
    cities: list[dict[str, Any]],
    water_bodies: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    definitions = [
        ("cairo-nile", "city:natural-earth:1159151603", "place:natural-earth:river:nile", 35, "Cairo is near the mapped Nile centerline."),
        ("pittsburgh-allegheny", "city:natural-earth:1159150531", "place:natural-earth:river:allegheny", 35, "Pittsburgh is near the mapped Allegheny centerline."),
        ("pittsburgh-monongahela", "city:natural-earth:1159150531", "place:natural-earth:river:monongahela", 35, "Pittsburgh is near the mapped Monongahela centerline."),
        ("pittsburgh-ohio", "city:natural-earth:1159150531", "place:natural-earth:river:ohio", 35, "Pittsburgh is near the mapped Ohio centerline."),
        ("new-orleans-mississippi", "city:natural-earth:1159151233", "place:natural-earth:river:mississippi", 40, "New Orleans is near the mapped Mississippi centerline."),
        ("new-orleans-gulf", "city:natural-earth:1159151233", "place:natural-earth:water:q12630", 220, "New Orleans is near the mapped Gulf of Mexico marine area."),
    ]
    city_by_id = {city["entity"]["entityId"]: city for city in cities}
    targets: dict[str, list[dict[str, Any]]] = {}
    for feature in [*rivers, *water_bodies]:
        targets.setdefault(feature["placeId"], []).append(feature)
    relationships = []
    for key, city_id, target_id, threshold_km, wording in definitions:
        city = city_by_id.get(city_id)
        target_features = targets.get(target_id)
        if not city or not target_features:
            raise ValueError(f"City relationship pilot target missing: {key}")
        city_point = shape(city["geometry"]["canonicalWgs84"])
        target_shape = unary_union([shape(feature["geometry"]["canonicalWgs84"]) for feature in target_features])
        nearest_city, nearest_target = nearest_points(city_point, target_shape)
        distance_km = round_number(haversine_km(nearest_city, nearest_target), 2)
        if distance_km > threshold_km:
            raise ValueError(f"City relationship {key} is {distance_km} km from mapped geometry (threshold {threshold_km})")
        relationships.append({
            "id": f"relationship:city-geography:{key}",
            "fromPlaceId": city_id,
            "toPlaceId": target_id,
            "kind": "near_mapped_geometry",
            "wording": wording,
            "distanceKm": distance_km,
            "sourceIds": sorted(set([*city["sourceIds"], *[source_id for feature in target_features for source_id in feature["sourceIds"]]])),
            "evidence": {
                "method": "nearest-wgs84-source-geometry-v1",
                "thresholdKm": threshold_km,
                "caveat": "This is a proximity relation derived from generalized source geometry. It does not by itself assert hydrological topology, a legal boundary, or causation.",
            },
            "review": {"status": "derived-reviewed", "reviewedAt": "2026-09-05"},
        })
    return relationships


def load_vectors(source_cache: Path, lock_by_id: dict[str, Any], repository_root: Path | None = None) -> tuple[list[Any], list[Any], list[Any]]:
    river_payload = json.loads((source_cache / lock_by_id[RIVER_SOURCE_ID]["target"]).read_text("utf8"))
    lake_payload = json.loads((source_cache / lock_by_id[LAKE_SOURCE_ID]["target"]).read_text("utf8"))
    city_payload = json.loads((source_cache / lock_by_id[DETAIL_CITY_SOURCE_ID]["target"]).read_text("utf8"))

    rivers = [
        vector_feature(
            feature,
            kind="river",
            source_id=RIVER_SOURCE_ID,
            source_identity=None,
        )
        for feature in river_payload["features"]
        if feature["properties"].get("featurecla") == "River"
        and number_or_default(feature["properties"].get("min_zoom"), 99) <= 3
    ]
    lake_candidates = [
        feature
        for feature in lake_payload["features"]
        if number_or_default(feature["properties"].get("min_zoom"), 99) <= 3
    ]
    selected_lakes = []
    seen_lake_parts: set[tuple[str, str]] = set()
    for feature in lake_candidates:
        properties = feature["properties"]
        name = properties.get("name_en") or properties.get("name") or properties.get("label") or "Unnamed feature"
        part_key = (str(properties.get("ne_id") or ""), feature_hash(name, feature["geometry"]))
        if part_key in seen_lake_parts:
            # Natural Earth 5.1.2 contains one exact duplicate Lake Zaysan
            # feature. It has no independent cartographic or entity meaning.
            continue
        seen_lake_parts.add(part_key)
        selected_lakes.append(feature)
    lake_source_id_counts: dict[str, int] = {}
    for feature in selected_lakes:
        source_identity = str(feature["properties"].get("ne_id") or "")
        lake_source_id_counts[source_identity] = lake_source_id_counts.get(source_identity, 0) + 1
    lakes = []
    for feature in selected_lakes:
        properties = feature["properties"]
        name = properties.get("name_en") or properties.get("name") or properties.get("label") or "Unnamed feature"
        source_identity = str(properties.get("ne_id") or "")
        feature_identity = source_identity or feature_hash(name, feature["geometry"])
        if lake_source_id_counts.get(source_identity, 0) > 1:
            # Natural Earth occasionally represents one named lake as more than one
            # source feature with the same NE_ID. Keep that raw ID for provenance but
            # append a geometry digest so each renderable feature remains addressable.
            feature_identity = f"{source_identity}:{feature_hash(name, feature['geometry'])}"
        lakes.append(
            vector_feature(
                feature,
                kind="lake",
                source_id=LAKE_SOURCE_ID,
                source_identity=source_identity,
                feature_identity=feature_identity,
            )
        )

    countries = json.loads(
        ((repository_root or Path(__file__).resolve().parents[1]) / "lib" / "atlas-world" / "data" / "countries.v1.json").read_text("utf8")
    )
    country_ids = {country["id"] for country in countries["countries"]}
    cities = []
    for feature in city_payload["features"]:
        properties = feature["properties"]
        source_rank = properties.get("SCALERANK")
        rank = int(source_rank) if source_rank is not None else 99
        if not (rank <= 4 or int(properties.get("ADM0CAP") or 0) == 1):
            continue
        natural_earth_id = str(properties["NE_ID"])
        feature_id = f"feature:natural-earth:city:{natural_earth_id}"
        entity_id = f"city:natural-earth:{natural_earth_id}"
        location = [
            round_number(feature["geometry"]["coordinates"][0]),
            round_number(feature["geometry"]["coordinates"][1]),
        ]
        projected = project_point(location)
        city_country_code = str(properties.get("ADM0_A3") or "")
        city_country_code = CITY_COUNTRY_CODE_OVERRIDES.get(city_country_code, city_country_code)
        country_entity_id = f"country:{city_country_code}"
        if country_entity_id not in country_ids:
            country_entity_id = None
        is_capital = int(properties.get("ADM0CAP") or 0) == 1
        display_lod = "world" if rank <= 1 else ("regional" if rank <= 2 else "country")
        # Natural Earth stores the UN urban-agglomeration POP* series in thousands.
        # Convert to people at the dataset boundary so downstream consumers do not
        # silently interpret Paris as a city of 10,031 people.
        population_2025_thousands = properties.get("POP2025")
        cities.append(
            {
                "featureId": feature_id,
                "kind": "city",
                "name": properties.get("NAME_EN") or properties.get("NAME"),
                "aliases": feature_aliases(properties, properties.get("NAME_EN") or properties.get("NAME") or "Unnamed city"),
                "entity": {
                    "entityId": entity_id,
                    "kind": "city",
                    "parentId": country_entity_id,
                    "sovereignId": country_entity_id,
                    "countryId": country_entity_id,
                    "adminLevel": None,
                    "codes": [
                        {"scheme": "natural-earth-ne-id", "value": natural_earth_id},
                        *(
                            [{"scheme": "wikidata", "value": properties["WIKIDATAID"]}]
                            if properties.get("WIKIDATAID")
                            else []
                        ),
                        *(
                            [{"scheme": "geonames", "value": str(properties["GEONAMESID"])}]
                            if properties.get("GEONAMESID")
                            else []
                        ),
                    ],
                    "temporal": {"validFrom": None, "validTo": None},
                },
                "administrativeRegion": properties.get("ADM1NAME"),
                "isNationalCapital": is_capital,
                "isWorldCity": int(properties.get("WORLDCITY") or 0) == 1,
                "sourceScaleRank": rank,
                "sourceMinZoom": properties.get("MIN_ZOOM"),
                "displayLod": display_lod,
                "displayMinimumZoom": 1 if rank <= 1 else (4 if rank <= 2 else (8 if rank <= 3 else 14)),
                "population": (
                    {
                        "value": int(round(float(population_2025_thousands) * 1_000)),
                        "status": "estimated",
                        "unit": "people",
                        "temporal": temporal_extent("2025", "year"),
                        "sourceIds": [DETAIL_CITY_SOURCE_ID],
                        "sourceField": "POP2025 (thousands; converted to people)",
                        "notes": [
                            "Natural Earth's UN urban-agglomeration POP2025 field is stored in thousands and converted here to people.",
                            "The estimate is suitable for cartographic ranking, not a harmonized city-demography series."
                        ],
                    }
                    if population_2025_thousands and float(population_2025_thousands) > 0
                    else None
                ),
                "sourceIds": [DETAIL_CITY_SOURCE_ID],
                "temporal": temporal_extent(),
                "geometry": {
                    "geometryId": f"geometry:{feature_id}:wgs84",
                    "geometrySetId": "natural-earth-populated-places-10m-5.1.2",
                    "geometryType": "point",
                    "crs": "EPSG:4326",
                    "canonicalWgs84": {"type": "Point", "coordinates": location},
                    "boundsWgs84": [location, location],
                    "derived": {
                        "projectionId": "mercator",
                        "viewBox": [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
                        "point": projected,
                        "bounds": [projected, projected],
                        "transformationId": "wgs84-to-mercator-svg-v1",
                    },
                },
            }
        )
    # Keep the original coarse feature identities (including note references),
    # then replace their display at close zoom with separately addressable 10m
    # source features. Matching names is not assumed to identify the same reach.
    for feature in [*rivers, *lakes]:
        feature["displayMaximumZoom"] = 6
    for kind, source_id, collection in [("river", DETAIL_RIVER_SOURCE_ID, rivers), ("lake", DETAIL_LAKE_SOURCE_ID, lakes)]:
        payload = json.loads((source_cache / lock_by_id[source_id]["target"]).read_text("utf8"))
        seen = set()
        for raw_feature in payload["features"]:
            properties = raw_feature["properties"]
            if not raw_feature.get("geometry") or not geometry_coordinates(raw_feature["geometry"]):
                # Some 10m source records have an empty geometry. They cannot
                # represent a selectable/drawable place and are excluded.
                continue
            minimum = number_or_default(properties.get("min_zoom"), 99)
            if minimum > (7 if kind == "river" else 5) or (kind == "river" and properties.get("featurecla") not in ("River", "Lake Centerline")):
                continue
            name = properties.get("name_en") or properties.get("name") or properties.get("label") or "Unnamed feature"
            identity = f"10m:{feature_hash(name, raw_feature['geometry'])}"
            if identity in seen:
                continue
            seen.add(identity)
            feature = vector_feature(raw_feature, kind=kind, source_id=source_id, source_identity=properties.get("ne_id"), feature_identity=identity)
            feature["displayLod"] = "country"
            feature["displayMinimumZoom"] = 6 if minimum <= 3 else (10 if minimum <= 4 else (16 if minimum <= 6 else 20))
            feature["geometry"]["geometrySetId"] = "natural-earth-physical-10m-5.1.2"
            collection.append(feature)
    attach_admin0_relations([*rivers, *lakes], source_cache, lock_by_id, countries)
    return rivers, lakes, cities


def source_record(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": source["id"],
        "title": source["title"],
        "publisher": source["publisher"],
        "version": source["version"],
        "url": source["url"],
        "retrievedAt": source["retrievedAt"],
        "license": source["license"],
        "checksumSha256": source["checksumSha256"],
    }


def write_physical_geometry_sprites(pack: dict[str, Any], destination: Path) -> None:
    """Cache geometry separately from SSR and delay close geography until needed.

    Source vertices are kept intact. Feature identity is shared with the country,
    source and annotation records; only a safe SVG fragment identifier is derived.
    """
    assets = {}
    features = [*pack["featureCollections"]["majorRivers"]["features"], *pack["featureCollections"]["majorLakes"]["features"]]
    for level in ["overview", "detail"]:
        selected = [feature for feature in features if (feature.get("displayMaximumZoom") is not None) == (level == "overview")]
        filename = f"physical-mercator-{level}.v1.svg"
        sprite_path = destination / filename
        fragments = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 650"><defs>']
        for feature in selected:
            identity = re.sub(r"[^A-Za-z0-9_-]", "-", feature["featureId"])
            fragments.append(f'<path id="{identity}" d="{feature["geometry"]["derived"]["path"]}" vector-effect="non-scaling-stroke"/>')
        fragments.append('</defs></svg>')
        sprite_path.write_text(''.join(fragments) + '\n', 'utf8')
        assets[level] = {"href": f"/atlas-world/{filename}", "mediaType": "image/svg+xml", "bytes": sprite_path.stat().st_size, "checksumSha256": sha256_file(sprite_path), "featureCount": len(selected)}
    pack["physicalGeometryAssets"] = assets


def write_vector_sprite(
    features: list[dict[str, Any]],
    destination: Path,
    filename: str,
) -> dict[str, Any]:
    sprite_path = destination / filename
    fragments = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 650"><defs>']
    for feature in features:
        identity = re.sub(r"[^A-Za-z0-9_-]", "-", feature["featureId"])
        fragments.append(f'<path id="{identity}" d="{feature["geometry"]["derived"]["path"]}" vector-effect="non-scaling-stroke"/>')
    fragments.append('</defs></svg>')
    sprite_path.write_text(''.join(fragments) + '\n', 'utf8')
    return {
        "href": f"/atlas-world/{filename}",
        "mediaType": "image/svg+xml",
        "bytes": sprite_path.stat().st_size,
        "checksumSha256": sha256_file(sprite_path),
        "featureCount": len(features),
    }


def write_phase4_geometry_assets(pack: dict[str, Any], destination: Path) -> None:
    pack["waterGeometryAsset"] = write_vector_sprite(
        pack["featureCollections"]["majorWaterBodies"]["features"],
        destination,
        "water-mercator.v1.svg",
    )
    pack["watershedGeometryAsset"] = write_vector_sprite(
        pack["featureCollections"]["watershedPilot"]["features"],
        destination,
        "watersheds-mercator.v1.svg",
    )


def write_globe_context_asset(pack: dict[str, Any], destination: Path) -> None:
    rivers = [
        {
            "featureId": feature["featureId"],
            "placeId": feature["placeId"],
            "name": feature["name"],
            "sourceScaleRank": feature.get("sourceScaleRank"),
            "geometry": feature["geometry"]["canonicalWgs84"],
        }
        for feature in pack["featureCollections"]["majorRivers"]["features"]
        if feature.get("displayLod") == "world" and RIVER_SOURCE_ID in feature.get("sourceIds", [])
    ]
    cities = [
        {
            "featureId": feature["featureId"],
            "placeId": feature["entity"]["entityId"],
            "name": feature["name"],
            "countryId": feature["entity"].get("countryId"),
            "isNationalCapital": feature["isNationalCapital"],
            "sourceScaleRank": feature["sourceScaleRank"],
            "coordinates": feature["geometry"]["canonicalWgs84"]["coordinates"],
        }
        for feature in pack["featureCollections"]["majorCities"]["features"]
        if feature["sourceScaleRank"] <= 1 or feature["isNationalCapital"]
    ]
    labels_by_place = {}
    for feature in pack["featureCollections"]["majorWaterBodies"]["features"]:
        if feature["sourceScaleRank"] > 2:
            continue
        candidate = {
            "placeId": feature["placeId"],
            "name": feature["name"],
            "waterKind": feature["waterKind"],
            "priority": feature["label"]["priority"],
            "minimumZoom": feature["label"]["minimumZoom"],
            "coordinates": feature["label"]["anchorWgs84"],
        }
        current = labels_by_place.get(feature["placeId"])
        if current is None or (candidate["priority"], candidate["name"]) > (current["priority"], current["name"]):
            labels_by_place[feature["placeId"]] = candidate
    asset_payload = {
        "schemaVersion": "1.0.0",
        "snapshotId": f"{pack['snapshotId']}-globe-context-v1",
        "generatedAt": GENERATED_AT,
        "canonicalCrs": "EPSG:4326",
        "sourceLockId": pack["sourceLockId"],
        "sourceIds": [RIVER_SOURCE_ID, DETAIL_CITY_SOURCE_ID, WATER_SOURCE_ID],
        "rivers": sorted(rivers, key=lambda feature: feature["featureId"]),
        "cities": sorted(cities, key=lambda feature: feature["featureId"]),
        "waterLabels": sorted(labels_by_place.values(), key=lambda label: (-label["priority"], label["name"])),
    }
    asset_path = destination / "globe-context.v1.json"
    asset_path.write_text(json.dumps(asset_payload, ensure_ascii=False, separators=(",", ":")) + "\n", "utf8")
    pack["globeContextAsset"] = {
        "href": "/atlas-world/globe-context.v1.json",
        "mediaType": "application/json",
        "bytes": asset_path.stat().st_size,
        "checksumSha256": sha256_file(asset_path),
        "riverCount": len(rivers),
        "cityCount": len(cities),
        "waterLabelCount": len(labels_by_place),
    }


def phase4_datasets(water_bodies: list[dict[str, Any]], watersheds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": "major-water-bodies",
            "name": "Major water bodies",
            "dataType": "water",
            "measure": "generalized named marine-area polygon and cartographic label anchor",
            "unit": None,
            "geographicResolution": "1:10m Natural Earth marine geography polygons",
            "conceptualResolution": "named oceans, major seas, gulfs, bays, straits, and channels at source scale rank 4 or better",
            "sourceIds": [WATER_SOURCE_ID],
            "transformationId": "wgs84-to-mercator-svg-v1",
            "geometrySetId": "natural-earth-marine-10m-5.1.2",
            "featureCount": len(water_bodies),
            "selectionRule": "Named ocean, sea, gulf, bay, strait, and channel features with Natural Earth SCALERANK <= 4; multipart features share a logical Wikidata place identity when available.",
            "temporal": {"support": "static", "observedAt": None, "validFrom": None, "validTo": None, "precision": "unknown", "selectionPolicy": "timeless"},
            "caveats": [
                "Marine polygons are generalized cartographic areas, not legal maritime boundaries.",
                "Country relationships describe coastline adjacency to mapped geometry only; they never imply ownership or jurisdiction.",
                "Label anchors are derived representative points inside source polygons, not official named-place coordinates.",
            ],
        },
        {
            "id": "watershed-pilot",
            "name": "Major drainage basins pilot",
            "dataType": "watershed",
            "measure": "generalized drainage-basin polygon geometry",
            "unit": None,
            "geographicResolution": "World Bank global major-river-basin polygons; five authored logical basins",
            "conceptualResolution": "Amazon, Danube, Mississippi, Nile, and Yangtze drainage basins",
            "sourceIds": [BASIN_SOURCE_ID],
            "transformationId": "wgs84-to-mercator-svg-v1",
            "geometrySetId": "world-bank-major-river-basins-2019-pilot",
            "featureCount": len(watersheds),
            "selectionRule": "Exact World Bank BASWC4_ID records for five named basin systems; Amazon source parts 205 and 209 are unioned as one logical basin.",
            "temporal": {"support": "snapshot", "observedAt": "2019-06-25", "validFrom": None, "validTo": None, "precision": "day", "selectionPolicy": "exact"},
            "caveats": [
                "These are generalized basin boundaries suitable for world/regional learning, not engineering, legal, or local watershed work.",
                "A basin crossing a country is shared physical geography and does not imply ownership or control.",
                "Source area attributes are intentionally not published because one pilot record contains an unusable zero and the attributes are not consistently documented for comparison.",
            ],
        },
    ]


def install_phase4_vector_data(
    pack: dict[str, Any],
    rivers: list[dict[str, Any]],
    lakes: list[dict[str, Any]],
    cities: list[dict[str, Any]],
    water_bodies: list[dict[str, Any]],
    watersheds: list[dict[str, Any]],
    relationships: list[dict[str, Any]],
    lock_by_id: dict[str, Any],
    required_source_ids: list[str],
    public_asset_root: Path,
) -> None:
    pack["sources"] = [source_record(lock_by_id[source_id]) for source_id in required_source_ids]
    pack["featureCollections"] = {
        "majorRivers": {"datasetId": "major-rivers", "features": rivers},
        "majorLakes": {"datasetId": "major-lakes", "features": lakes},
        "majorCities": {"datasetId": "major-cities", "features": cities},
        "majorWaterBodies": {"datasetId": "major-water-bodies", "features": water_bodies},
        "watershedPilot": {"datasetId": "watershed-pilot", "features": watersheds},
    }
    pack["placeRelationships"] = relationships
    for dataset_id, features in [("major-rivers", rivers), ("major-lakes", lakes), ("major-cities", cities)]:
        dataset = next(item for item in pack["datasets"] if item["id"] == dataset_id)
        dataset["featureCount"] = len(features)
    river_dataset = next(item for item in pack["datasets"] if item["id"] == "major-rivers")
    river_dataset["sourceIds"] = [RIVER_SOURCE_ID, DETAIL_RIVER_SOURCE_ID, RIVER_FACT_SOURCE_ID, RIVER_LABEL_SOURCE_ID]
    river_dataset["selectionRule"] = RIVER_SELECTION_RULE
    river_dataset["factPilot"] = {
        "placeIds": sorted(RIVER_FACT_SELECTIONS),
        "omittedMeasures": ["discharge"],
        "omissionReason": "Available statements use different measurement locations, periods, and qualifiers; Atlas does not present them as a comparable global value.",
    }
    phase4_ids = {"major-water-bodies", "watershed-pilot"}
    pack["datasets"] = [dataset for dataset in pack["datasets"] if dataset["id"] not in phase4_ids]
    pack["datasets"].extend(phase4_datasets(water_bodies, watersheds))
    write_physical_geometry_sprites(pack, public_asset_root)
    write_phase4_geometry_assets(pack, public_asset_root)
    write_globe_context_asset(pack, public_asset_root)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--width", type=int, default=OUTPUT_WIDTH)
    parser.add_argument("--height", type=int, default=OUTPUT_HEIGHT)
    parser.add_argument("--source-cache", type=Path)
    parser.add_argument("--data-output", type=Path)
    parser.add_argument("--asset-output", type=Path)
    parser.add_argument("--repository-root", type=Path, help="Read source authority from this repository while writing only to explicitly supplied outputs.")
    parser.add_argument("--overview-only", action="store_true", help="Development review: publish current-projection overview/vector derivatives without advertising unfinished detail levels.")
    parser.add_argument("--vectors-only", action="store_true", help="Rebuild physical vectors against checked source locks while retaining unchanged registered raster assets.")
    parser.add_argument("--relief-only", action="store_true", help="Rebuild source-derived relief overview/detail and physical vectors while retaining population assets and observations unchanged.")
    arguments = parser.parse_args()

    repository_root = (arguments.repository_root or Path(__file__).resolve().parents[1]).resolve()
    lock_path = repository_root / "data" / "atlas" / "sources.lock.json"
    lock = json.loads(lock_path.read_text("utf8"))
    lock_by_id = {source["id"]: source for source in lock["sources"]}
    source_cache = arguments.source_cache or repository_root / lock["cacheDirectory"]
    data_output = arguments.data_output or repository_root / "lib" / "atlas-world" / "data"
    asset_output = arguments.asset_output or repository_root / "public" / "atlas-world" / "layers"
    data_output.mkdir(parents=True, exist_ok=True)
    asset_output.mkdir(parents=True, exist_ok=True)
    if not arguments.vectors_only:
        if any(module is None for module in (np, rasterio, Image, ImageDraw, transform)):
            raise RuntimeError(
                "Full and relief-only geography builds require the locked raster environment. "
                "Run this script through scripts/run-atlas-geography-build.mjs with Python 3.11."
            )
        registration_checks = verify_raster_registration()
    else:
        registration_checks = None

    required_source_ids = [
        POP_SOURCE_ID,
        RELIEF_SOURCE_ID,
        RIVER_SOURCE_ID,
        LAKE_SOURCE_ID,
        DETAIL_RIVER_SOURCE_ID,
        DETAIL_LAKE_SOURCE_ID,
        DETAIL_CITY_SOURCE_ID,
        ADMIN0_SOURCE_ID,
        WATER_SOURCE_ID,
        BASIN_SOURCE_ID,
        RIVER_FACT_SOURCE_ID,
        RIVER_LABEL_SOURCE_ID,
    ]
    for source_id in required_source_ids:
        source = lock_by_id[source_id]
        source_path = source_cache / source["target"]
        if not source_path.exists():
            raise FileNotFoundError(f"Missing locked Atlas source: {source_path}")
        actual_hash = sha256_file(source_path)
        if actual_hash != source["checksumSha256"]:
            raise ValueError(f"Source checksum mismatch for {source_id}: {actual_hash}")

    if arguments.vectors_only or arguments.relief_only:
        output_path = data_output / "geography-pack.v1.json"
        pack = json.loads(output_path.read_text("utf8"))
        if pack["projection"]["crs"] != RASTER_TARGET_CRS or pack["sourceLockId"] != lock["lockId"]:
            raise ValueError("Vector-only refresh requires an existing matching projection/source-lock pack.")
        if arguments.relief_only:
            with tempfile.TemporaryDirectory(prefix="jju-atlas-relief-") as temporary_directory:
                relief_source = extract_member(source_cache / lock_by_id[RELIEF_SOURCE_ID]["target"], RELIEF_ZIP_MEMBER, Path(temporary_directory))
                refresh_relief_dataset(pack, relief_source, asset_output, arguments.width, arguments.height)
            pack["derivedRevision"] = "2026-09-05-source-relief-and-river-detail"
        rivers, lakes, cities = load_vectors(source_cache, lock_by_id, repository_root)
        attach_river_pilot_facts(rivers, source_cache, lock_by_id)
        countries = json.loads((repository_root / "lib" / "atlas-world" / "data" / "countries.v1.json").read_text("utf8"))
        water_bodies = load_water_bodies(source_cache, lock_by_id, countries)
        watersheds = load_watershed_pilot(source_cache, lock_by_id, countries)
        relationships = build_city_relationship_pilot(rivers, cities, water_bodies)
        # Activation thresholds are authored rendering choices, not source or
        # raster-pixel changes. Refresh them without an expensive resampling run.
        population = next(dataset for dataset in pack["datasets"] if dataset["id"] == "population-density-2025")
        for level in population.get("assetPyramid", {}).get("levels", []):
            definition = next(item for item in POPULATION_DETAIL_LEVELS if item["id"] == level["id"])
            if (level["width"], level["height"]) != (definition["width"], definition["height"]):
                raise ValueError("Raster dimensions changed; a complete raster rebuild is required.")
            level["minimumZoom"] = definition["minimumZoom"]
        pack["projection"].pop("displayPathSimplificationTolerance", None)
        install_phase4_vector_data(
            pack,
            rivers,
            lakes,
            cities,
            water_bodies,
            watersheds,
            relationships,
            lock_by_id,
            required_source_ids,
            asset_output.parent,
        )
        output_path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", "utf8")
        print("Refreshed source-checked physical geography; population raster manifests and observations retained unchanged.")
        return

    population_asset = asset_output / "population-density-2025.mercator.webp"
    relief_asset = asset_output / "physical-relief.mercator.webp"
    if arguments.overview_only and population_asset.exists() and relief_asset.exists():
        for asset in [population_asset, relief_asset]:
            with Image.open(asset) as image:
                if image.size != (arguments.width, arguments.height):
                    raise ValueError("Existing overview dimensions do not match this development review request.")
        population_statistics = {}
        population_pyramid = None
        relief_pyramid = None
    else:
        with tempfile.TemporaryDirectory(prefix="jju-atlas-geography-") as temporary_directory:
            temporary_path = Path(temporary_directory)
            population_source = extract_member(
                source_cache / lock_by_id[POP_SOURCE_ID]["target"], POP_ZIP_MEMBER, temporary_path
            )
            relief_source = extract_member(
                source_cache / lock_by_id[RELIEF_SOURCE_ID]["target"], RELIEF_ZIP_MEMBER, temporary_path
            )
            population_rgba, population_statistics = warp_population(
                population_source, arguments.width, arguments.height
            )
            relief_rgba = warp_relief(relief_source, arguments.width, arguments.height)
            write_webp(population_rgba, population_asset, lossless=True)
            write_webp(relief_rgba, relief_asset, lossless=True)
            population_pyramid = None if arguments.overview_only else build_population_pyramid(population_source, asset_output)
            relief_pyramid = None if arguments.overview_only else build_relief_pyramid(relief_source, asset_output)

    rivers, lakes, cities = load_vectors(source_cache, lock_by_id, repository_root)
    attach_river_pilot_facts(rivers, source_cache, lock_by_id)
    countries = json.loads((repository_root / "lib" / "atlas-world" / "data" / "countries.v1.json").read_text("utf8"))
    water_bodies = load_water_bodies(source_cache, lock_by_id, countries)
    watersheds = load_watershed_pilot(source_cache, lock_by_id, countries)
    relationships = build_city_relationship_pilot(rivers, cities, water_bodies)
    sources = [source_record(lock_by_id[source_id]) for source_id in required_source_ids]
    output_assets = {
        "populationDensity": {
            "href": "/atlas-world/layers/population-density-2025.mercator.webp",
            "mediaType": "image/webp",
            "width": arguments.width,
            "height": arguments.height,
            "viewBox": [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
            "checksumSha256": sha256_file(population_asset),
            "bytes": population_asset.stat().st_size,
        },
        "physicalRelief": {
            "href": "/atlas-world/layers/physical-relief.mercator.webp",
            "mediaType": "image/webp",
            "width": arguments.width,
            "height": arguments.height,
            "viewBox": [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
            "checksumSha256": sha256_file(relief_asset),
            "bytes": relief_asset.stat().st_size,
        },
    }

    pack = {
        "schemaVersion": SCHEMA_VERSION,
        "snapshotId": SNAPSHOT_ID,
        "generatedAt": GENERATED_AT,
        "derivedRevision": "2026-09-05-source-relief-and-river-detail",
        "sourceLockId": lock["lockId"],
        "projection": {
            "id": "mercator",
            "crs": RASTER_TARGET_CRS,
            "projectionMethod": "Spherical Mercator; latitude clipped at ±85.05112878 degrees; high-latitude areas inflated",
            "viewBox": [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
            "canonicalCrs": "EPSG:4326",
            "canonicalGeometryCrs": "EPSG:4326",
            "transformationId": "wgs84-to-mercator-svg-v1",
            "registrationChecks": registration_checks,
        },
        "sources": sources,
        "transformations": [
            {
                "id": "ghsl-mollweide-to-mercator-raster-v1",
                "description": "Area-resample the original 1 km World Mollweide population-count grid independently into a 2400 × 1300 overview and 19200 × 10400 / 38400 × 20800 / 76800 × 41600 equivalent tiled Mercator levels; apply one explicit log1p color/opacity scale. Detail is never upscaled from the overview. Projected display scale varies from ground scale by latitude.",
                "inputCrs": "ESRI:54009",
                "outputCrs": RASTER_TARGET_CRS,
                "resampling": "average",
                "code": "scripts/build-atlas-geography-pack.py",
            },
            {
                "id": RELIEF_TRANSFORMATION_ID,
                "description": RELIEF_TRANSFORMATION_DESCRIPTION,
                "inputCrs": "EPSG:4326",
                "outputCrs": RASTER_TARGET_CRS,
                "resampling": "bilinear",
                "code": "scripts/build-atlas-geography-pack.py",
            },
            {
                "id": "wgs84-to-mercator-svg-v1",
                "description": "Project canonical WGS84 coordinates with the same fitted Mercator formula and 1200 × 650 viewBox used by Atlas country geometry.",
                "inputCrs": "EPSG:4326",
                "outputCrs": RASTER_TARGET_CRS,
                "resampling": None,
                "code": "scripts/build-atlas-geography-pack.py",
            },
        ],
        "datasets": [
            {
                "id": "population-density-2025",
                "name": "Where people live",
                "dataType": "raster-field",
                "measure": "estimated population per one-square-kilometre source cell",
                "unit": "people per square kilometre (approximately after display resampling)",
                "geographicResolution": "1 km equal-area source grid; display raster is area-resampled",
                "conceptualResolution": "population density",
                "temporal": {
                    "support": "snapshot",
                    "observedAt": "2025",
                    "validFrom": None,
                    "validTo": None,
                    "precision": "year",
                    "selectionPolicy": "exact",
                },
                "sourceIds": [POP_SOURCE_ID],
                "transformationId": "ghsl-mollweide-to-mercator-raster-v1",
                "asset": output_assets["populationDensity"],
                "assetPyramid": population_pyramid,
                "visualization": {
                    "scale": "log1p",
                    "clamp": True,
                    "stops": POPULATION_STOPS,
                    "zeroBehavior": "transparent",
                    "missingDataBehavior": "transparent",
                },
                "statistics": population_statistics,
                "caveats": [
                    "This is a modelled spatial distribution, not a census count observed independently in every grid cell.",
                    "The 2025 epoch is a projection within a five-year GHSL series; accuracy varies with the age and resolution of upstream census inputs.",
                    "A browser display pixel averages many 1 km source cells at world scale, so it must not be interpreted as the exact value of a single source cell.",
                    "Three detail levels are generated independently from the original source. The finest is approximately 1 km per projected display pixel at the equator. Ground scale varies by latitude; zoom never creates finer source information. This is not a street-level population map.",
                ],
            },
            {
                "id": "physical-relief",
                "name": "Physical relief",
                "dataType": "raster-field",
                "measure": "cartographic grayscale terrain relief",
                "unit": None,
                "geographicResolution": "1:50m cartographic source; 1/30 degree source pixels (~3.71 km at equator), ~4.02 km projected detail pixels",
                "conceptualResolution": "terrain relief",
                "temporal": {"support": "static", "observedAt": None, "validFrom": None, "validTo": None, "precision": "unknown", "selectionPolicy": "timeless"},
                "sourceIds": [RELIEF_SOURCE_ID],
                "transformationId": RELIEF_TRANSFORMATION_ID,
                "asset": output_assets["physicalRelief"],
                "assetPyramid": relief_pyramid,
                "visualization": {"recommendedOpacity": 0.34, "recommendedBlendMode": "multiply", "shadowContrast": 1.0},
                "caveats": [
                    "This is generalized manually authored cartographic relief, not a measured elevation surface or a DEM.",
                    "Source pixel spacing is 1/30 degree (~3.71 km at the equator), not a claim of spatial accuracy. Display pixel ground scale changes with latitude.",
                    "The overview and detail tiles are independently resampled from the same original source. Further zoom does not add topographic information.",
                    "Grayscale remains source-authored: no sharpening, embossed borders, generated hills, or synthetic texture is added.",
                ],
            },
            {
                "id": "major-rivers",
                "name": "Major rivers",
                "dataType": "line",
                "measure": "generalized river centerline geometry",
                "unit": None,
                "geographicResolution": "1:50m world/regional and 1:10m close-scale cartographic vectors",
                "conceptualResolution": "major named river segments visible by regional zoom",
                "sourceIds": [RIVER_SOURCE_ID, DETAIL_RIVER_SOURCE_ID],
                "transformationId": "wgs84-to-mercator-svg-v1",
                "geometrySetId": "natural-earth-physical-50m-5.1.2",
                "featureCount": len(rivers),
                "selectionRule": RIVER_SELECTION_RULE,
                "temporal": {"support": "static", "observedAt": None, "validFrom": None, "validTo": None, "precision": "unknown", "selectionPolicy": "timeless"},
                "caveats": [
                    "This is a generalized cartographic selection, not a connected hydrological network.",
                    "A rendered centerline does not encode discharge, width, navigability, or seasonal variation.",
                ],
            },
            {
                "id": "major-lakes",
                "name": "Major lakes",
                "dataType": "polygon",
                "measure": "generalized lake polygon geometry",
                "unit": None,
                "geographicResolution": "1:50m world/regional and 1:10m close-scale cartographic vectors",
                "conceptualResolution": "major lakes visible by regional zoom",
                "sourceIds": [LAKE_SOURCE_ID, DETAIL_LAKE_SOURCE_ID],
                "transformationId": "wgs84-to-mercator-svg-v1",
                "geometrySetId": "natural-earth-physical-50m-5.1.2",
                "featureCount": len(lakes),
                "selectionRule": "50m lakes with min_zoom <= 3 below zoom 6; 10m lakes with min_zoom <= 5 revealed at zoom 6, 10 and 16, with exact duplicate source geometries removed.",
                "temporal": {"support": "static", "observedAt": None, "validFrom": None, "validTo": None, "precision": "unknown", "selectionPolicy": "timeless"},
                "caveats": [
                    "This is a generalized cartographic selection, not a comprehensive inland-water inventory.",
                    "Shorelines and seasonal lake extents should not be measured from this display geometry.",
                ],
            },
            {
                "id": "major-cities",
                "name": "Major cities",
                "dataType": "point",
                "measure": "cartographic populated-place point",
                "unit": None,
                "geographicResolution": "1:10m populated-place point selection",
                "conceptualResolution": "national capitals and high-rank world/regional cities",
                "sourceIds": [DETAIL_CITY_SOURCE_ID],
                "transformationId": "wgs84-to-mercator-svg-v1",
                "geometrySetId": "natural-earth-populated-places-10m-5.1.2",
                "featureCount": len(cities),
                "selectionRule": "All Natural Earth national capitals plus populated places with SCALERANK <= 4, revealed progressively; stable NE_ID entity identities retained.",
                "temporal": {"support": "snapshot", "observedAt": "2025", "validFrom": None, "validTo": None, "precision": "year", "selectionPolicy": "exact"},
                "caveats": [
                    "Natural Earth is a cartographic selection, not a complete city gazetteer.",
                    "POP2025 is an estimated UN urban-agglomeration series stored in thousands; Atlas converts it to people and retains it only as a future/audit hint, not as a harmonized metropolitan-population statistic. Current marker size uses cartographic rank and capital status.",
                ],
            },
        ],
        "featureCollections": {
            "majorRivers": {"datasetId": "major-rivers", "features": rivers},
            "majorLakes": {"datasetId": "major-lakes", "features": lakes},
            "majorCities": {"datasetId": "major-cities", "features": cities},
        },
    }
    output_path = data_output / "geography-pack.v1.json"
    install_phase4_vector_data(
        pack,
        rivers,
        lakes,
        cities,
        water_bodies,
        watersheds,
        relationships,
        lock_by_id,
        required_source_ids,
        asset_output.parent,
    )
    if population_pyramid is None:
        pack["buildStatus"] = "development-overview-only"
        del pack["datasets"][0]["assetPyramid"]
    output_path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", "utf8")
    print(
        json.dumps(
            {
                "output": str(output_path),
                "rasters": output_assets,
                "counts": {"rivers": len(rivers), "lakes": len(lakes), "cities": len(cities)},
                "populationStatistics": population_statistics,
                "populationPyramid": [{"id": level["id"], "tiles": len(level["tiles"]), "bytes": level["bytes"], "metresPerPixel": level["displayMetresPerPixel"]} for level in (population_pyramid["levels"] if population_pyramid else [])],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
