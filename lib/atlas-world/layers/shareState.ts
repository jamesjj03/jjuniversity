import {
  ATLAS_LAYER_BY_ID,
  ATLAS_VIEW_PRESET_BY_ALIAS,
  ATLAS_VIEW_PRESET_BY_ID,
  DEFAULT_ATLAS_VIEW_PRESET_ID,
  createAtlasSceneFromPreset,
} from "./catalog";
import { buildAtlasRenderPlan } from "./planner";
import type {
  AtlasLayerInstance,
  AtlasSceneFocus,
  AtlasSceneState,
  AtlasTimeSelection,
} from "./contracts";

export type AtlasSceneParseIssue = {
  code: string;
  message: string;
};

export type AtlasParsedSceneState = {
  scene: AtlasSceneState;
  issues: AtlasSceneParseIssue[];
  usedLegacyModeAlias: boolean;
};

function asSearchParams(input: URLSearchParams | string) {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  const query = input.startsWith("?") ? input.slice(1) : input;
  return new URLSearchParams(query);
}

function parseTime(raw: string | null, issues: AtlasSceneParseIssue[]): AtlasTimeSelection {
  if (!raw || raw === "latest") return { kind: "latest" };
  const intervalMatch = raw.match(/^([^./]+)\.\.([^./]+)$/);
  if (intervalMatch) {
    const [, from, to] = intervalMatch;
    if (Date.parse(from) <= Date.parse(to)) return { kind: "interval", from, to };
  }
  if (/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(raw) && !Number.isNaN(Date.parse(raw.length === 4 ? `${raw}-01-01` : raw))) {
    return { kind: "instant", at: raw };
  }
  issues.push({ code: "invalid-time", message: `Ignored invalid Atlas time selection ${raw}.` });
  return { kind: "latest" };
}

function parseFocus(raw: string | null, issues: AtlasSceneParseIssue[]): AtlasSceneFocus | null {
  if (!raw) return null;
  const separator = raw.indexOf(":");
  if (separator < 1) {
    issues.push({ code: "invalid-focus", message: `Ignored invalid Atlas focus ${raw}.` });
    return null;
  }
  const kind = raw.slice(0, separator);
  const value = raw.slice(separator + 1).trim();
  if ((kind === "entity" || kind === "feature") && value) return { kind, id: value };
  if (kind === "coordinate") {
    const [longitude, latitude, ...rest] = value.split(",").map(Number);
    if (rest.length === 0 && Number.isFinite(longitude) && Number.isFinite(latitude)
      && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90) {
      return { kind, longitude, latitude };
    }
  }
  issues.push({ code: "invalid-focus", message: `Ignored invalid Atlas focus ${raw}.` });
  return null;
}

function parseLayerInstances(raw: string, issues: AtlasSceneParseIssue[]): AtlasLayerInstance[] | null {
  if (raw.startsWith("v2:")) {
    try {
      const decoded = JSON.parse(raw.slice(3)) as unknown;
      if (!Array.isArray(decoded) || decoded.length === 0 || decoded.length > 24) {
        throw new Error("Layer state must contain between one and 24 entries.");
      }
      return decoded.map((candidate, index) => {
        if (!candidate || typeof candidate !== "object") throw new Error("Layer state entry is not an object.");
        const value = candidate as Record<string, unknown>;
        if (typeof value.l !== "string" || !ATLAS_LAYER_BY_ID.has(value.l)) {
          throw new Error(`Unknown Atlas layer ${String(value.l)}.`);
        }
        const definition = ATLAS_LAYER_BY_ID.get(value.l)!;
        const opacity = value.o == null ? definition.defaultOpacity : Number(value.o);
        if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
          throw new Error(`Invalid opacity for Atlas layer ${value.l}.`);
        }
        let time: AtlasTimeSelection | null = null;
        if (value.t != null) {
          if (!value.t || typeof value.t !== "object") throw new Error("Invalid layer time selection.");
          const rawTime = value.t as Record<string, unknown>;
          if (rawTime.kind === "latest") time = { kind: "latest" };
          else if (rawTime.kind === "instant" && typeof rawTime.at === "string") {
            time = { kind: "instant", at: rawTime.at };
          } else if (rawTime.kind === "interval" && typeof rawTime.from === "string" && typeof rawTime.to === "string") {
            time = { kind: "interval", from: rawTime.from, to: rawTime.to };
          } else throw new Error("Invalid layer time selection.");
        }
        const parameters: Record<string, string | number | boolean | null> = {};
        if (value.p != null) {
          if (!value.p || typeof value.p !== "object" || Array.isArray(value.p)) {
            throw new Error("Invalid layer parameters.");
          }
          const entries = Object.entries(value.p);
          if (entries.length > 16) throw new Error("Too many layer parameters.");
          for (const [key, parameter] of entries) {
            if (typeof parameter !== "string" && typeof parameter !== "number"
              && typeof parameter !== "boolean" && parameter !== null) {
              throw new Error(`Invalid parameter ${key}.`);
            }
            parameters[key] = parameter;
          }
        }
        return {
          id: `share:${index}:${value.l}`,
          layerId: value.l,
          enabled: value.e === false ? false : true,
          opacity,
          time,
          parameters,
        };
      });
    } catch (error) {
      issues.push({
        code: "invalid-layer-state",
        message: error instanceof Error ? error.message : "Ignored invalid Atlas layer state.",
      });
      return null;
    }
  }
  const tokens = raw.split(",").map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 24) {
    issues.push({ code: "invalid-layers", message: "Ignored an empty or excessively large Atlas layer list." });
    return null;
  }
  const instances: AtlasLayerInstance[] = [];
  for (const [index, token] of tokens.entries()) {
    const match = token.match(/^([^@]+?)(?:@([01](?:\.\d+)?))?$/);
    if (!match) {
      issues.push({ code: "invalid-layer-token", message: `Ignored invalid Atlas layer token ${token}.` });
      return null;
    }
    const [, layerId, rawOpacity] = match;
    const definition = ATLAS_LAYER_BY_ID.get(layerId);
    if (!definition) {
      issues.push({ code: "unknown-layer", message: `Ignored unknown Atlas layer ${layerId}.` });
      return null;
    }
    const opacity = rawOpacity == null ? definition.defaultOpacity : Number(rawOpacity);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      issues.push({ code: "invalid-layer-opacity", message: `Ignored invalid opacity for Atlas layer ${layerId}.` });
      return null;
    }
    instances.push({
      id: `share:${index}:${layerId}`,
      layerId,
      enabled: true,
      opacity,
      time: null,
      parameters: {},
    });
  }
  return instances;
}

const CURATED_OVERLAY_LAYER_IDS = new Set(["watershed-pilot"]);

function usesPresetLayerDefinitions(left: AtlasLayerInstance[], right: AtlasLayerInstance[]) {
  if (left.length < right.length || left.length > right.length + CURATED_OVERLAY_LAYER_IDS.size) return false;
  if (!right.every((entry, index) => left[index]?.layerId === entry.layerId)) return false;
  const extras = left.slice(right.length);
  return new Set(extras.map((entry) => entry.layerId)).size === extras.length
    && extras.every((entry) => CURATED_OVERLAY_LAYER_IDS.has(entry.layerId));
}

/** Enables one reviewed overlay without opening shared URLs to arbitrary stacks. */
export function enableAtlasCuratedOverlay(scene: AtlasSceneState, layerId: string) {
  if (!CURATED_OVERLAY_LAYER_IDS.has(layerId)) return scene;
  const definition = ATLAS_LAYER_BY_ID.get(layerId);
  if (!definition) return scene;
  const existing = scene.layers.find((instance) => instance.layerId === layerId);
  let layers = existing
    ? scene.layers.map((instance) => instance.layerId === layerId ? { ...instance, enabled: true } : instance)
    : [...scene.layers, {
        id: `${scene.viewPresetId}:curated:${layerId}`,
        layerId,
        enabled: true,
        opacity: definition.defaultOpacity,
        time: null,
        parameters: {},
      }];
  const required = new Set(definition.compatibility.requiresLayerIds);
  layers = layers.map((instance) => required.has(instance.layerId)
    ? { ...instance, enabled: true }
    : instance);
  return { ...scene, layers };
}

/** Parses both Phase 2 `view` state and the V1 `mode` alias. */
export function parseAtlasSceneSearchParams(input: URLSearchParams | string): AtlasParsedSceneState {
  const params = asSearchParams(input);
  const issues: AtlasSceneParseIssue[] = [];
  const rawView = params.get("view");
  const rawMode = params.get("mode");
  const requested = rawView ?? rawMode;
  const preset = requested
    ? ATLAS_VIEW_PRESET_BY_ALIAS.get(requested.toLocaleLowerCase("en-US"))
    : ATLAS_VIEW_PRESET_BY_ID.get(DEFAULT_ATLAS_VIEW_PRESET_ID);
  if (requested && !preset) {
    issues.push({ code: "unknown-view", message: `Unknown Atlas view ${requested}; opened Political instead.` });
  }
  const scene = createAtlasSceneFromPreset(preset?.id ?? DEFAULT_ATLAS_VIEW_PRESET_ID);
  scene.time = parseTime(params.get("time"), issues);
  scene.focus = parseFocus(params.get("focus"), issues);

  const rawLayers = params.get("layers");
  if (rawLayers) {
    const parsedLayers = parseLayerInstances(rawLayers, issues);
    if (parsedLayers) {
      if (!usesPresetLayerDefinitions(parsedLayers, scene.layers)) {
        issues.push({
          code: "unsupported-custom-layer-composition",
          message: "Atlas does not yet accept arbitrary layer stacks in shared URLs; kept the selected view's authored composition.",
        });
      } else {
        const candidate = { ...scene, layers: parsedLayers };
        const plan = buildAtlasRenderPlan(candidate);
        const compositionErrors = plan.issues.filter((entry) =>
          entry.severity === "error" && entry.code !== "unsupported-time-selection",
        );
        if (compositionErrors.length === 0) scene.layers = parsedLayers;
        else {
          issues.push(...compositionErrors
            .map((entry) => ({ code: entry.code, message: entry.message })));
          issues.push({ code: "invalid-layer-composition", message: "Kept the selected view's safe layer composition." });
        }
      }
    }
  }

  const finalPlan = buildAtlasRenderPlan(scene);
  const unsupportedTime = finalPlan.issues.filter((entry) => entry.code === "unsupported-time-selection");
  if (unsupportedTime.length > 0) {
    issues.push({
      code: "unsupported-time-selection",
      message: `The ${scene.viewPresetId} view does not yet have a historical snapshot for that date.`,
    });
    issues.push({
      code: "time-fell-back-to-latest",
      message: "This present-day view has no historical snapshot for that date, so Atlas opened its latest sourced observations.",
    });
    scene.time = { kind: "latest" };
    scene.layers = scene.layers.map((instance) => ({ ...instance, time: null }));
  }

  return {
    scene,
    issues,
    usedLegacyModeAlias: (rawView == null && rawMode != null)
      || Boolean(rawView && preset && rawView.toLocaleLowerCase("en-US") !== preset.id),
  };
}

function timeParam(time: AtlasTimeSelection) {
  if (time.kind === "latest") return "latest";
  if (time.kind === "instant") return time.at;
  return `${time.from}..${time.to}`;
}

function focusParam(focus: AtlasSceneFocus) {
  if (focus.kind === "coordinate") return `coordinate:${focus.longitude},${focus.latitude}`;
  return `${focus.kind}:${focus.id}`;
}

function sameLayerState(left: AtlasLayerInstance[], right: AtlasLayerInstance[]) {
  const enabledLeft = left.filter((entry) => entry.enabled);
  const enabledRight = right.filter((entry) => entry.enabled);
  return enabledLeft.length === enabledRight.length && enabledLeft.every((entry, index) => {
    const other = enabledRight[index];
    return other?.layerId === entry.layerId
      && other.opacity === entry.opacity
      && JSON.stringify(other.parameters) === JSON.stringify(entry.parameters)
      && JSON.stringify(other.time) === JSON.stringify(entry.time);
  });
}

/**
 * Applies canonical Atlas state while preserving unrelated state such as the
 * existing `country` deep link. Default preset layers are omitted for concise URLs.
 */
export function applyAtlasSceneToSearchParams(
  scene: AtlasSceneState,
  target: URLSearchParams = new URLSearchParams(),
) {
  const params = new URLSearchParams(target);
  params.set("view", scene.viewPresetId);
  params.delete("mode");
  const preset = ATLAS_VIEW_PRESET_BY_ID.get(scene.viewPresetId);
  if (preset && sameLayerState(scene.layers, preset.layerInstances)) {
    params.delete("layers");
  } else {
    const compact = scene.layers.map((entry) => {
      const definition = ATLAS_LAYER_BY_ID.get(entry.layerId);
      return {
        l: entry.layerId,
        ...(entry.enabled ? {} : { e: false }),
        ...(entry.opacity === definition?.defaultOpacity ? {} : { o: Number(entry.opacity.toFixed(3)) }),
        ...(entry.time ? { t: entry.time } : {}),
        ...(Object.keys(entry.parameters).length > 0 ? { p: entry.parameters } : {}),
      };
    });
    params.set("layers", `v2:${JSON.stringify(compact)}`);
  }
  if (scene.time.kind === "latest") params.delete("time");
  else params.set("time", timeParam(scene.time));
  if (scene.focus) params.set("focus", focusParam(scene.focus));
  else params.delete("focus");
  return params;
}

export function serializeAtlasSceneSearchParams(scene: AtlasSceneState) {
  return applyAtlasSceneToSearchParams(scene).toString();
}
