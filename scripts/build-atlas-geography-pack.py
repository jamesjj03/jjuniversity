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
import json
import math
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window
from rasterio.warp import reproject, transform


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

POP_SOURCE_ID = "ghsl-ghs-pop-2025-r2023a-1km"
RELIEF_SOURCE_ID = "natural-earth-manual-shaded-relief-50m-3.3.0"
RIVER_SOURCE_ID = "natural-earth-rivers-50m-5.1.2"
LAKE_SOURCE_ID = "natural-earth-lakes-50m-5.1.2"
CITY_SOURCE_ID = "natural-earth-populated-places-50m-5.1.2"
DETAIL_RIVER_SOURCE_ID = "natural-earth-rivers-10m-5.1.2"
DETAIL_LAKE_SOURCE_ID = "natural-earth-lakes-10m-5.1.2"
DETAIL_CITY_SOURCE_ID = "natural-earth-populated-places-10m-5.1.2"

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
    # Increase cartographic shadow separation without inventing elevation.
    # The same global linear transfer is applied everywhere and recorded below.
    shade = np.clip(255 - (255 - destination.astype(np.float32)) * 1.45, 0, 255).astype(np.uint8)
    rgba[..., 0] = shade
    rgba[..., 1] = shade
    rgba[..., 2] = shade
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
        if isinstance(value, list):
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
    name = properties.get("name_en") or properties.get("name") or properties.get("label") or "Unnamed feature"
    raw_source_identity = str(source_identity) if source_identity not in (None, "") else None
    identity = feature_identity or raw_source_identity or feature_hash(name, feature["geometry"])
    feature_id = f"feature:natural-earth:{kind}:{identity}"
    geometry = canonical_geometry(feature["geometry"])
    source_min_zoom = properties.get("min_zoom")
    return {
        "featureId": feature_id,
        "kind": kind,
        "name": name,
        "alternateName": properties.get("name_alt"),
        "entityIds": [],
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


def load_vectors(source_cache: Path, lock_by_id: dict[str, Any]) -> tuple[list[Any], list[Any], list[Any]]:
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
        (Path(__file__).resolve().parents[1] / "lib" / "atlas-world" / "data" / "countries.v1.json").read_text("utf8")
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
        country_entity_id = f"country:{properties.get('ADM0_A3')}"
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
            if minimum > 5 or (kind == "river" and properties.get("featurecla") not in ("River", "Lake Centerline")):
                continue
            name = properties.get("name_en") or properties.get("name") or properties.get("label") or "Unnamed feature"
            identity = f"10m:{feature_hash(name, raw_feature['geometry'])}"
            if identity in seen:
                continue
            seen.add(identity)
            feature = vector_feature(raw_feature, kind=kind, source_id=source_id, source_identity=properties.get("ne_id"), feature_identity=identity)
            feature["displayLod"] = "country"
            feature["displayMinimumZoom"] = 6 if minimum <= 3 else (10 if minimum <= 4 else 16)
            feature["geometry"]["geometrySetId"] = "natural-earth-physical-10m-5.1.2"
            collection.append(feature)
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--width", type=int, default=OUTPUT_WIDTH)
    parser.add_argument("--height", type=int, default=OUTPUT_HEIGHT)
    parser.add_argument("--source-cache", type=Path)
    parser.add_argument("--data-output", type=Path)
    parser.add_argument("--asset-output", type=Path)
    parser.add_argument("--overview-only", action="store_true", help="Development review: publish current-projection overview/vector derivatives without advertising unfinished detail levels.")
    parser.add_argument("--vectors-only", action="store_true", help="Rebuild physical vectors against checked source locks while retaining unchanged registered raster assets.")
    arguments = parser.parse_args()

    repository_root = Path(__file__).resolve().parents[1]
    lock_path = repository_root / "data" / "atlas" / "sources.lock.json"
    lock = json.loads(lock_path.read_text("utf8"))
    lock_by_id = {source["id"]: source for source in lock["sources"]}
    source_cache = arguments.source_cache or repository_root / lock["cacheDirectory"]
    data_output = arguments.data_output or repository_root / "lib" / "atlas-world" / "data"
    asset_output = arguments.asset_output or repository_root / "public" / "atlas-world" / "layers"
    data_output.mkdir(parents=True, exist_ok=True)
    asset_output.mkdir(parents=True, exist_ok=True)
    registration_checks = verify_raster_registration()

    required_source_ids = [POP_SOURCE_ID, RELIEF_SOURCE_ID, RIVER_SOURCE_ID, LAKE_SOURCE_ID, DETAIL_RIVER_SOURCE_ID, DETAIL_LAKE_SOURCE_ID, DETAIL_CITY_SOURCE_ID]
    for source_id in required_source_ids:
        source = lock_by_id[source_id]
        source_path = source_cache / source["target"]
        if not source_path.exists():
            raise FileNotFoundError(f"Missing locked Atlas source: {source_path}")
        actual_hash = sha256_file(source_path)
        if actual_hash != source["checksumSha256"]:
            raise ValueError(f"Source checksum mismatch for {source_id}: {actual_hash}")

    if arguments.vectors_only:
        output_path = data_output / "geography-pack.v1.json"
        pack = json.loads(output_path.read_text("utf8"))
        if pack["projection"]["crs"] != RASTER_TARGET_CRS or pack["sourceLockId"] != lock["lockId"]:
            raise ValueError("Vector-only refresh requires an existing matching projection/source-lock pack.")
        for collection_name, dataset_id, features in zip(["majorRivers", "majorLakes", "majorCities"], ["major-rivers", "major-lakes", "major-cities"], load_vectors(source_cache, lock_by_id)):
            pack["featureCollections"][collection_name] = {"datasetId": dataset_id, "features": features}
            next(dataset for dataset in pack["datasets"] if dataset["id"] == dataset_id)["featureCount"] = len(features)
        # Activation thresholds are authored rendering choices, not source or
        # raster-pixel changes. Refresh them without an expensive resampling run.
        population = next(dataset for dataset in pack["datasets"] if dataset["id"] == "population-density-2025")
        for level in population.get("assetPyramid", {}).get("levels", []):
            definition = next(item for item in POPULATION_DETAIL_LEVELS if item["id"] == level["id"])
            if (level["width"], level["height"]) != (definition["width"], definition["height"]):
                raise ValueError("Raster dimensions changed; a complete raster rebuild is required.")
            level["minimumZoom"] = definition["minimumZoom"]
        pack["projection"].pop("displayPathSimplificationTolerance", None)
        write_physical_geometry_sprites(pack, asset_output.parent)
        output_path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", "utf8")
        print("Refreshed source-checked physical vectors; retained registered raster manifests unchanged.")
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
            write_webp(relief_rgba, relief_asset, lossless=False)
            population_pyramid = None if arguments.overview_only else build_population_pyramid(population_source, asset_output)

    rivers, lakes, cities = load_vectors(source_cache, lock_by_id)
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
                "id": "natural-earth-relief-to-mercator-raster-v1",
                "description": "Bilinear-warp the public-domain grayscale relief from WGS84 into Mercator and clip to the projected sphere. Apply global cartographic shadow contrast clamp(255 − (255 − gray) × 1.45). Styling opacity remains layer-owned.",
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
                "geographicResolution": "1:50m cartographic raster",
                "conceptualResolution": "terrain relief",
                "temporal": {"support": "static", "observedAt": None, "validFrom": None, "validTo": None, "precision": "unknown", "selectionPolicy": "timeless"},
                "sourceIds": [RELIEF_SOURCE_ID],
                "transformationId": "natural-earth-relief-to-mercator-raster-v1",
                "asset": output_assets["physicalRelief"],
                "visualization": {"recommendedOpacity": 0.42, "recommendedBlendMode": "multiply", "shadowContrast": 1.45},
                "caveats": [
                    "This is generalized cartographic relief, not an elevation measurement surface.",
                    "It should remain subtle beneath analytical layers and must not be used to read elevations.",
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
                "selectionRule": "50m rivers with min_zoom <= 3 below zoom 6; 10m River/Lake Centerline geometry with min_zoom <= 5 revealed progressively at zoom 6, 10 and 16.",
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
    write_physical_geometry_sprites(pack, asset_output.parent)
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
