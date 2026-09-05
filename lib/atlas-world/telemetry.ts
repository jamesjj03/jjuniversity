"use client";

import { track } from "@vercel/analytics";

const sentOnce = new Set<string>();

/** Small allowlisted Atlas telemetry helper. Never pass names, queries or URLs. */
export function recordAtlasEvent(
  name:
    | "Atlas ready"
    | "Atlas scene repaired"
    | "Atlas layer failure"
    | "Atlas raster failure"
    | "Atlas long task"
    | "Atlas client error"
    | "Atlas memory pressure"
    | "Atlas route error",
  properties: Record<string, string | number | boolean>,
  onceKey?: string,
) {
  if (onceKey && sentOnce.has(onceKey)) return;
  if (onceKey) sentOnce.add(onceKey);
  try {
    track(name, properties);
  } catch {
    // Product telemetry must never become a product failure.
  }
}
