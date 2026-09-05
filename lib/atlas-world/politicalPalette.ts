import palette from "./data/political-palette.v1.json";

/** Editorial color identity: never a measured value or a sovereignty claim. */
export const ATLAS_POLITICAL_PALETTE_VERSION = palette.version;
export function atlasPoliticalColor(entityId: string) {
  const code = entityId.split(":").at(-1) ?? "";
  return (palette.colors as Record<string, string>)[code] ?? "#a6aba7";
}
