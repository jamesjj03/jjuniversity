#!/usr/bin/env python3
"""Build the bounded Phase 2 physical/population geography pack.

The script consumes only sources named in data/atlas/sources.lock.json. It
keeps canonical feature geometry in WGS84 and emits Equal Earth derivatives
for the current SVG renderer. Dense rasters are warped once at build time;
they are never expanded into browser-side SVG cells.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
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
from rasterio.warp import reproject, transform


SCHEMA_VERSION = "1.0.0"
SNAPSHOT_ID = "atlas-geography-2026-09-04"
GENERATED_AT = "2026-09-04T18:00:00Z"
VIEWBOX_WIDTH = 1200
VIEWBOX_HEIGHT = 650
PROJECTION_PADDING = 14
OUTPUT_WIDTH = 2400
OUTPUT_HEIGHT = 1300

POP_SOURCE_ID = "ghsl-ghs-pop-2025-r2023a-1km"
RELIEF_SOURCE_ID = "natural-earth-manual-shaded-relief-50m-3.3.0"
RIVER_SOURCE_ID = "natural-earth-rivers-50m-5.1.2"
LAKE_SOURCE_ID = "natural-earth-lakes-50m-5.1.2"
CITY_SOURCE_ID = "natural-earth-populated-places-50m-5.1.2"

POP_ZIP_MEMBER = "GHS_POP_E2025_GLOBE_R2023A_54009_1000_V1_0.tif"
RELIEF_ZIP_MEMBER = "MSR_50M/MSR_50M.tif"

POPULATION_STOPS = [
    {"value": 1, "color": "#31565a", "opacity": 0.20},
    {"value": 10, "color": "#39756f", "opacity": 0.42},
    {"value": 50, "color": "#62a278", "opacity": 0.62},
    {"value": 250, "color": "#d2c56c", "opacity": 0.76},
    {"value": 1000, "color": "#e58d4b", "opacity": 0.86},
    {"value": 5000, "color": "#d95048", "opacity": 0.93},
    {"value": 20000, "color": "#f4e7ce", "opacity": 0.98},
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
    outline = [equal_earth_raw(*point) for point in sphere_coordinates(2)]
    xs = [point[0] for point in outline]
    ys = [point[1] for point in outline]
    scale = min(
        (VIEWBOX_WIDTH - PROJECTION_PADDING * 2) / (max(xs) - min(xs)),
        (VIEWBOX_HEIGHT - PROJECTION_PADDING * 2) / (max(ys) - min(ys)),
    )
    translate_x = VIEWBOX_WIDTH / 2 - ((min(xs) + max(xs)) / 2) * scale
    translate_y = VIEWBOX_HEIGHT / 2 - ((min(ys) + max(ys)) / 2) * scale
    return scale, translate_x, translate_y


PROJECT_SCALE, PROJECT_TRANSLATE_X, PROJECT_TRANSLATE_Y = projection_parameters()


def project_point(coordinate: Iterable[float]) -> list[float]:
    longitude, latitude = coordinate
    x, y = equal_earth_raw(float(longitude), float(latitude))
    return [
        round_number(x * PROJECT_SCALE + PROJECT_TRANSLATE_X, 2),
        round_number(y * PROJECT_SCALE + PROJECT_TRANSLATE_Y, 2),
    ]


def target_transform(width: int, height: int) -> Affine:
    if width / height != OUTPUT_WIDTH / OUTPUT_HEIGHT:
        raise ValueError("Equal Earth raster output must preserve the 1200:650 viewBox ratio")
    epsg_x, _ = transform("EPSG:4326", "EPSG:8857", [180.0], [0.0])
    raw_x, _ = equal_earth_raw(180.0, 0.0)
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
            dst_crs="EPSG:8857",
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
            dst_crs="EPSG:8857",
            dst_nodata=0,
            resampling=Resampling.bilinear,
            init_dest_nodata=True,
            num_threads=max(1, min(8, os.cpu_count() or 1)),
        )
    mask = sphere_mask(width, height)
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
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
    for index, coordinate in enumerate(coordinates):
        x, y = project_point(coordinate)
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
                "projectionId": "equal-earth",
                "viewBox": [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
                "path": projected_path(geometry),
                "bounds": projected_bounds(geometry),
                "transformationId": "wgs84-to-equal-earth-svg-v1",
            },
        },
    }


def load_vectors(source_cache: Path, lock_by_id: dict[str, Any]) -> tuple[list[Any], list[Any], list[Any]]:
    river_payload = json.loads((source_cache / lock_by_id[RIVER_SOURCE_ID]["target"]).read_text("utf8"))
    lake_payload = json.loads((source_cache / lock_by_id[LAKE_SOURCE_ID]["target"]).read_text("utf8"))
    city_payload = json.loads((source_cache / lock_by_id[CITY_SOURCE_ID]["target"]).read_text("utf8"))

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
        if not (rank <= 2 or int(properties.get("ADM0CAP") or 0) == 1):
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
                "population": (
                    {
                        "value": int(round(float(population_2025_thousands) * 1_000)),
                        "status": "estimated",
                        "unit": "people",
                        "temporal": temporal_extent("2025", "year"),
                        "sourceIds": [CITY_SOURCE_ID],
                        "sourceField": "POP2025 (thousands; converted to people)",
                        "notes": [
                            "Natural Earth's UN urban-agglomeration POP2025 field is stored in thousands and converted here to people.",
                            "The estimate is suitable for cartographic ranking, not a harmonized city-demography series."
                        ],
                    }
                    if population_2025_thousands and float(population_2025_thousands) > 0
                    else None
                ),
                "sourceIds": [CITY_SOURCE_ID],
                "temporal": temporal_extent(),
                "geometry": {
                    "geometryId": f"geometry:{feature_id}:wgs84",
                    "geometrySetId": "natural-earth-populated-places-50m-5.1.2",
                    "geometryType": "point",
                    "crs": "EPSG:4326",
                    "canonicalWgs84": {"type": "Point", "coordinates": location},
                    "boundsWgs84": [location, location],
                    "derived": {
                        "projectionId": "equal-earth",
                        "viewBox": [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
                        "point": projected,
                        "bounds": [projected, projected],
                        "transformationId": "wgs84-to-equal-earth-svg-v1",
                    },
                },
            }
        )
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--width", type=int, default=OUTPUT_WIDTH)
    parser.add_argument("--height", type=int, default=OUTPUT_HEIGHT)
    parser.add_argument("--source-cache", type=Path)
    parser.add_argument("--data-output", type=Path)
    parser.add_argument("--asset-output", type=Path)
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

    required_source_ids = [POP_SOURCE_ID, RELIEF_SOURCE_ID, RIVER_SOURCE_ID, LAKE_SOURCE_ID, CITY_SOURCE_ID]
    for source_id in required_source_ids:
        source = lock_by_id[source_id]
        source_path = source_cache / source["target"]
        if not source_path.exists():
            raise FileNotFoundError(f"Missing locked Atlas source: {source_path}")
        actual_hash = sha256_file(source_path)
        if actual_hash != source["checksumSha256"]:
            raise ValueError(f"Source checksum mismatch for {source_id}: {actual_hash}")

    population_asset = asset_output / "population-density-2025.equal-earth.webp"
    relief_asset = asset_output / "physical-relief.equal-earth.webp"
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

    rivers, lakes, cities = load_vectors(source_cache, lock_by_id)
    sources = [source_record(lock_by_id[source_id]) for source_id in required_source_ids]
    output_assets = {
        "populationDensity": {
            "href": "/atlas-world/layers/population-density-2025.equal-earth.webp",
            "mediaType": "image/webp",
            "width": arguments.width,
            "height": arguments.height,
            "viewBox": [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
            "checksumSha256": sha256_file(population_asset),
            "bytes": population_asset.stat().st_size,
        },
        "physicalRelief": {
            "href": "/atlas-world/layers/physical-relief.equal-earth.webp",
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
            "id": "equal-earth",
            "crs": "EPSG:8857",
            "viewBox": [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
            "canonicalCrs": "EPSG:4326",
            "canonicalGeometryCrs": "EPSG:4326",
            "transformationId": "wgs84-to-equal-earth-svg-v1",
        },
        "sources": sources,
        "transformations": [
            {
                "id": "ghsl-mollweide-to-equal-earth-raster-v1",
                "description": "Area-resample the 1 km World Mollweide population-count grid into a 2400 × 1300 Equal Earth raster; apply an explicit log1p color/opacity scale; clip to the projected sphere.",
                "inputCrs": "ESRI:54009",
                "outputCrs": "EPSG:8857",
                "resampling": "average",
                "code": "scripts/build-atlas-geography-pack.py",
            },
            {
                "id": "natural-earth-relief-to-equal-earth-raster-v1",
                "description": "Bilinear-warp the public-domain grayscale relief from WGS84 into Equal Earth and clip to the projected sphere. Styling opacity remains layer-owned.",
                "inputCrs": "EPSG:4326",
                "outputCrs": "EPSG:8857",
                "resampling": "bilinear",
                "code": "scripts/build-atlas-geography-pack.py",
            },
            {
                "id": "wgs84-to-equal-earth-svg-v1",
                "description": "Project canonical WGS84 coordinates with the same fitted Equal Earth formula and 1200 × 650 viewBox used by Atlas country geometry.",
                "inputCrs": "EPSG:4326",
                "outputCrs": "EPSG:8857",
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
                "transformationId": "ghsl-mollweide-to-equal-earth-raster-v1",
                "asset": output_assets["populationDensity"],
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
                "transformationId": "natural-earth-relief-to-equal-earth-raster-v1",
                "asset": output_assets["physicalRelief"],
                "visualization": {"recommendedOpacity": 0.18, "recommendedBlendMode": "multiply"},
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
                "geographicResolution": "1:50m cartographic vectors",
                "conceptualResolution": "major named river segments visible by regional zoom",
                "sourceIds": [RIVER_SOURCE_ID],
                "transformationId": "wgs84-to-equal-earth-svg-v1",
                "geometrySetId": "natural-earth-physical-50m-5.1.2",
                "featureCount": len(rivers),
                "selectionRule": "Natural Earth feature class River with source min_zoom <= 3.",
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
                "geographicResolution": "1:50m cartographic vectors",
                "conceptualResolution": "major lakes visible by regional zoom",
                "sourceIds": [LAKE_SOURCE_ID],
                "transformationId": "wgs84-to-equal-earth-svg-v1",
                "geometrySetId": "natural-earth-physical-50m-5.1.2",
                "featureCount": len(lakes),
                "selectionRule": "Natural Earth lake polygons with source min_zoom <= 3, after removal of exact duplicate source features.",
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
                "geographicResolution": "1:50m populated-place point selection",
                "conceptualResolution": "national capitals and high-rank world/regional cities",
                "sourceIds": [CITY_SOURCE_ID],
                "transformationId": "wgs84-to-equal-earth-svg-v1",
                "geometrySetId": "natural-earth-populated-places-50m-5.1.2",
                "featureCount": len(cities),
                "selectionRule": "All Natural Earth national capitals plus populated places with SCALERANK <= 2; SCALERANK derives the current world/regional/country LOD while source MIN_ZOOM is retained for future refinement.",
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
    output_path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", "utf8")
    print(
        json.dumps(
            {
                "output": str(output_path),
                "rasters": output_assets,
                "counts": {"rivers": len(rivers), "lakes": len(lakes), "cities": len(cities)},
                "populationStatistics": population_statistics,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
