import palette from "./data/political-palette.v1.json";

/** Editorial color identity: never a measured value or a sovereignty claim. */
export const ATLAS_POLITICAL_PALETTE_VERSION = palette.version;
export const ATLAS_POLITICAL_PALETTE_AUTHORITY = {
  status: palette.authorityStatus,
  reviewedAt: palette.reviewedAt,
  assignmentPolicy: palette.assignmentPolicy,
  references: palette.references,
  manualOverrides: palette.manualOverrides,
} as const;
export function atlasPoliticalColor(entityId: string) {
  const code = entityId.split(":").at(-1) ?? "";
  return (palette.colors as Record<string, string>)[code] ?? "#a6aba7";
}

export function atlasPoliticalColorAuthority(entityId: string) {
  const code = entityId.split(":").at(-1) ?? "";
  return (palette.manualOverrides as Record<string, {
    color: string;
    association: string;
    rationale: string;
  }>)[code] ?? null;
}
