/** Authored SVG representation; identity and source geometry remain WGS84. */
export const ATLAS_PROJECTION_ID = "mercator" as const;
export const ATLAS_MERCATOR_LATITUDE_LIMIT = 85.0511287798066;
export const ATLAS_PROJECTION_SCALE = 622 / (2 * Math.PI);
export const ATLAS_WORLD_BOUNDS: [[number, number], [number, number]] = [[289, 14], [911, 636]];

export function projectAtlasWgs84([longitude, latitude]: readonly [number, number]): [number, number] {
  const phi = Math.max(-ATLAS_MERCATOR_LATITUDE_LIMIT, Math.min(ATLAS_MERCATOR_LATITUDE_LIMIT, latitude)) * Math.PI / 180;
  return [600 + longitude * Math.PI / 180 * ATLAS_PROJECTION_SCALE,
    325 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) * ATLAS_PROJECTION_SCALE];
}

/** Starting extent is a camera decision, not a deletion of polar geography. */
export const ATLAS_INITIAL_BOUNDS: [[number, number], [number, number]] = [
  projectAtlasWgs84([-180, 80]), projectAtlasWgs84([180, -60]),
];

export function atlasProjectedWgs84Bounds([[west, south], [east, north]]: [[number, number], [number, number]]): [[number, number], [number, number]] {
  return [projectAtlasWgs84([west, north]), projectAtlasWgs84([east, south])];
}
