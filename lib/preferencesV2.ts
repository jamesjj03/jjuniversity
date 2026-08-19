export const PREFERENCES_V2_KEY = "jju.preferences.v2";
export const PREFERENCES_LEGACY_KEY = "jju.preferences";
export const PREFERENCES_EVENT = "jju-preferences-v2";

export const SITE_THEME_OPTIONS = Object.freeze(["black", "navy", "paper"] as const);
export const SITE_ACCENT_OPTIONS = Object.freeze(["gold", "blue", "red"] as const);
export const READER_THEME_OPTIONS = Object.freeze(["paper", "light", "night"] as const);
export const READER_FONT_OPTIONS = Object.freeze(["literata", "lexend", "bitter"] as const);
export const READER_SIZE_OPTIONS = Object.freeze(["comfortable", "large", "xlarge"] as const);
export const READER_SPACING_OPTIONS = Object.freeze(["standard", "relaxed", "open"] as const);
export const READER_WIDTH_OPTIONS = Object.freeze(["focused", "standard", "wide"] as const);

export type SiteThemeV2 = (typeof SITE_THEME_OPTIONS)[number];
export type SiteAccentV2 = (typeof SITE_ACCENT_OPTIONS)[number];
export type ReaderThemeV2 = (typeof READER_THEME_OPTIONS)[number];
export type ReaderFontV2 = (typeof READER_FONT_OPTIONS)[number];
export type ReaderSizeV2 = (typeof READER_SIZE_OPTIONS)[number];
export type ReaderSpacingV2 = (typeof READER_SPACING_OPTIONS)[number];
export type ReaderWidthV2 = (typeof READER_WIDTH_OPTIONS)[number];

export type PreferencesV2 = {
  siteTheme: SiteThemeV2;
  siteAccent: SiteAccentV2;
  readerTheme: ReaderThemeV2;
  readerFont: ReaderFontV2;
  readerSize: ReaderSizeV2;
  readerSpacing: ReaderSpacingV2;
  readerWidth: ReaderWidthV2;
  saveProgress: boolean;
};

export const DEFAULT_PREFERENCES_V2: Readonly<PreferencesV2> = Object.freeze({
  siteTheme: "black",
  siteAccent: "gold",
  readerTheme: "paper",
  readerFont: "literata",
  readerSize: "comfortable",
  readerSpacing: "relaxed",
  readerWidth: "standard",
  saveProgress: true,
});

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includes<const T extends readonly string[]>(options: T, value: unknown): value is T[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function validateV2Record(value: UnknownRecord): PreferencesV2 {
  return {
    siteTheme: includes(SITE_THEME_OPTIONS, value.siteTheme) ? value.siteTheme : DEFAULT_PREFERENCES_V2.siteTheme,
    siteAccent: includes(SITE_ACCENT_OPTIONS, value.siteAccent) ? value.siteAccent : DEFAULT_PREFERENCES_V2.siteAccent,
    readerTheme: includes(READER_THEME_OPTIONS, value.readerTheme) ? value.readerTheme : DEFAULT_PREFERENCES_V2.readerTheme,
    readerFont: includes(READER_FONT_OPTIONS, value.readerFont) ? value.readerFont : mapLegacyReaderFont(value.readerFont),
    readerSize: includes(READER_SIZE_OPTIONS, value.readerSize) ? value.readerSize : DEFAULT_PREFERENCES_V2.readerSize,
    readerSpacing: includes(READER_SPACING_OPTIONS, value.readerSpacing) ? value.readerSpacing : DEFAULT_PREFERENCES_V2.readerSpacing,
    readerWidth: includes(READER_WIDTH_OPTIONS, value.readerWidth) ? value.readerWidth : DEFAULT_PREFERENCES_V2.readerWidth,
    saveProgress: typeof value.saveProgress === "boolean" ? value.saveProgress : DEFAULT_PREFERENCES_V2.saveProgress,
  };
}

function mapLegacySiteTheme(value: unknown): SiteThemeV2 {
  if (["dark", "carbon", "warm", "crimson"].includes(String(value))) return "black";
  if (["navy", "forest", "royal", "terminal", "aurora"].includes(String(value))) return "navy";
  if (["manuscript", "light", "sepia"].includes(String(value))) return "paper";
  return DEFAULT_PREFERENCES_V2.siteTheme;
}

function mapLegacySiteAccent(value: unknown): SiteAccentV2 {
  if (value === "gold") return "gold";
  if (["blue", "green", "violet"].includes(String(value))) return "blue";
  if (["crimson", "copper"].includes(String(value))) return "red";
  return DEFAULT_PREFERENCES_V2.siteAccent;
}

function mapLegacyReaderTheme(value: unknown): ReaderThemeV2 {
  if (["paper", "sepia"].includes(String(value))) return "paper";
  if (value === "light") return "light";
  if (["dark", "night"].includes(String(value))) return "night";
  return DEFAULT_PREFERENCES_V2.readerTheme;
}

function mapLegacyReaderFont(value: unknown): ReaderFontV2 {
  if (["serif", "classic", "georgia"].includes(String(value))) return "literata";
  if (["dyslexic", "verdana", "sans", "journal", "atkinson"].includes(String(value))) return "lexend";
  if (["book", "mono"].includes(String(value))) return "bitter";
  return DEFAULT_PREFERENCES_V2.readerFont;
}

function mapLegacyReaderSize(value: unknown): ReaderSizeV2 {
  if (["small", "medium"].includes(String(value))) return "comfortable";
  if (value === "large") return "large";
  if (value === "xlarge") return "xlarge";
  return DEFAULT_PREFERENCES_V2.readerSize;
}

function mapLegacyReaderSpacing(value: unknown): ReaderSpacingV2 {
  if (value === "tight") return "standard";
  if (value === "normal") return "relaxed";
  if (value === "loose") return "open";
  return DEFAULT_PREFERENCES_V2.readerSpacing;
}

function mapLegacyReaderWidth(value: unknown): ReaderWidthV2 {
  if (value === "narrow") return "focused";
  if (value === "focused") return "standard";
  if (["wide", "full"].includes(String(value))) return "wide";
  return DEFAULT_PREFERENCES_V2.readerWidth;
}

function deriveLegacyPreferences(value: UnknownRecord): PreferencesV2 {
  return {
    siteTheme: mapLegacySiteTheme(value.siteTheme),
    siteAccent: mapLegacySiteAccent(value.siteAccent),
    readerTheme: mapLegacyReaderTheme(value.readerTheme),
    readerFont: mapLegacyReaderFont(value.readerFont),
    readerSize: mapLegacyReaderSize(value.readerSize),
    readerSpacing: mapLegacyReaderSpacing(value.readerSpacing),
    readerWidth: mapLegacyReaderWidth(value.readerWidth),
    saveProgress: typeof value.saveProgress === "boolean" ? value.saveProgress : DEFAULT_PREFERENCES_V2.saveProgress,
  };
}

function parseStoredRecord(raw: string | null): UnknownRecord | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readPreferencesV2(): PreferencesV2 {
  if (typeof window === "undefined") return { ...DEFAULT_PREFERENCES_V2 };

  try {
    const current = parseStoredRecord(window.localStorage.getItem(PREFERENCES_V2_KEY));
    if (current) return validateV2Record(current);

    const legacy = parseStoredRecord(window.localStorage.getItem(PREFERENCES_LEGACY_KEY));
    return legacy ? deriveLegacyPreferences(legacy) : { ...DEFAULT_PREFERENCES_V2 };
  } catch {
    return { ...DEFAULT_PREFERENCES_V2 };
  }
}

export function writePreferencesV2(value: unknown): PreferencesV2 {
  const preferences = isRecord(value) ? validateV2Record(value) : { ...DEFAULT_PREFERENCES_V2 };
  if (typeof window === "undefined") return preferences;

  try {
    window.localStorage.setItem(PREFERENCES_V2_KEY, JSON.stringify(preferences));
    window.dispatchEvent(new Event(PREFERENCES_EVENT));
    window.dispatchEvent(new Event("jju-preferences"));
  } catch {
    return preferences;
  }

  return preferences;
}

export function applyPreferencesV2ToDocument(
  preferences: PreferencesV2 = readPreferencesV2(),
  target?: HTMLElement,
): PreferencesV2 {
  const root = target ?? (typeof document !== "undefined" ? document.documentElement : undefined);
  if (!root) return preferences;

  const siteTheme = preferences.siteTheme === "paper" ? "manuscript" : preferences.siteTheme === "navy" ? "navy" : "dark";
  const siteBackground = preferences.siteTheme === "paper" ? "paper" : preferences.siteTheme === "navy" ? "blueprint" : "grid";
  const siteScheme = preferences.siteTheme === "paper" ? "light" : "dark";
  const siteAccent = preferences.siteAccent === "red" ? "crimson" : preferences.siteAccent;

  delete root.dataset.siteMode;
  root.dataset.siteTheme = siteTheme;
  root.dataset.siteScheme = siteScheme;
  root.dataset.siteAccent = siteAccent;
  root.dataset.siteIntensity = "standard";
  root.dataset.siteBackground = siteBackground;
  root.style.colorScheme = siteScheme;

  return preferences;
}

export const PREFERENCES_PREPAINT_SCRIPT = `
(function () {
  try {
    var defaults = {
      siteTheme: "black",
      siteAccent: "gold",
      readerTheme: "paper",
      readerFont: "literata",
      readerSize: "comfortable",
      readerSpacing: "relaxed",
      readerWidth: "standard",
      saveProgress: true
    };
    var isRecord = function (value) {
      return typeof value === "object" && value !== null && !Array.isArray(value);
    };
    var parseRecord = function (raw) {
      if (raw === null) return null;
      try {
        var parsed = JSON.parse(raw);
        return isRecord(parsed) ? parsed : null;
      } catch (error) {
        return null;
      }
    };
    var oneOf = function (options, value, fallback) {
      return typeof value === "string" && options.indexOf(value) !== -1 ? value : fallback;
    };
    var current = parseRecord(localStorage.getItem("jju.preferences.v2"));
    var preferences;
    if (current) {
      preferences = {
        siteTheme: oneOf(["black", "navy", "paper"], current.siteTheme, defaults.siteTheme),
        siteAccent: oneOf(["gold", "blue", "red"], current.siteAccent, defaults.siteAccent),
        readerTheme: oneOf(["paper", "light", "night"], current.readerTheme, defaults.readerTheme),
        readerFont: oneOf(["literata", "lexend", "bitter"], current.readerFont, current.readerFont === "georgia" ? "literata" : ["atkinson", "verdana"].indexOf(String(current.readerFont || "")) !== -1 ? "lexend" : defaults.readerFont),
        readerSize: oneOf(["comfortable", "large", "xlarge"], current.readerSize, defaults.readerSize),
        readerSpacing: oneOf(["standard", "relaxed", "open"], current.readerSpacing, defaults.readerSpacing),
        readerWidth: oneOf(["focused", "standard", "wide"], current.readerWidth, defaults.readerWidth),
        saveProgress: typeof current.saveProgress === "boolean" ? current.saveProgress : defaults.saveProgress
      };
    } else {
      var legacy = parseRecord(localStorage.getItem("jju.preferences")) || {};
      var oldTheme = String(legacy.siteTheme || "");
      var oldAccent = String(legacy.siteAccent || "");
      var oldReaderTheme = String(legacy.readerTheme || "");
      var oldFont = String(legacy.readerFont || "");
      var oldSize = String(legacy.readerSize || "");
      var oldSpacing = String(legacy.readerSpacing || "");
      var oldWidth = String(legacy.readerWidth || "");
      preferences = {
        siteTheme: ["dark", "carbon", "warm", "crimson"].indexOf(oldTheme) !== -1 ? "black" : ["navy", "forest", "royal", "terminal", "aurora"].indexOf(oldTheme) !== -1 ? "navy" : ["manuscript", "light", "sepia"].indexOf(oldTheme) !== -1 ? "paper" : defaults.siteTheme,
        siteAccent: oldAccent === "gold" ? "gold" : ["blue", "green", "violet"].indexOf(oldAccent) !== -1 ? "blue" : ["crimson", "copper"].indexOf(oldAccent) !== -1 ? "red" : defaults.siteAccent,
        readerTheme: ["paper", "sepia"].indexOf(oldReaderTheme) !== -1 ? "paper" : oldReaderTheme === "light" ? "light" : ["dark", "night"].indexOf(oldReaderTheme) !== -1 ? "night" : defaults.readerTheme,
        readerFont: ["serif", "classic", "georgia"].indexOf(oldFont) !== -1 ? "literata" : ["dyslexic", "verdana", "sans", "journal", "atkinson"].indexOf(oldFont) !== -1 ? "lexend" : ["book", "mono"].indexOf(oldFont) !== -1 ? "bitter" : defaults.readerFont,
        readerSize: ["small", "medium"].indexOf(oldSize) !== -1 ? "comfortable" : oldSize === "large" ? "large" : oldSize === "xlarge" ? "xlarge" : defaults.readerSize,
        readerSpacing: oldSpacing === "tight" ? "standard" : oldSpacing === "normal" ? "relaxed" : oldSpacing === "loose" ? "open" : defaults.readerSpacing,
        readerWidth: oldWidth === "narrow" ? "focused" : oldWidth === "focused" ? "standard" : ["wide", "full"].indexOf(oldWidth) !== -1 ? "wide" : defaults.readerWidth,
        saveProgress: typeof legacy.saveProgress === "boolean" ? legacy.saveProgress : defaults.saveProgress
      };
    }
    var root = document.documentElement;
    var theme = preferences.siteTheme === "paper" ? "manuscript" : preferences.siteTheme === "navy" ? "navy" : "dark";
    var background = preferences.siteTheme === "paper" ? "paper" : preferences.siteTheme === "navy" ? "blueprint" : "grid";
    var scheme = preferences.siteTheme === "paper" ? "light" : "dark";
    var accent = preferences.siteAccent === "red" ? "crimson" : preferences.siteAccent;
    delete root.dataset.siteMode;
    root.dataset.siteTheme = theme;
    root.dataset.siteScheme = scheme;
    root.dataset.siteAccent = accent;
    root.dataset.siteIntensity = "standard";
    root.dataset.siteBackground = background;
    root.style.colorScheme = scheme;
  } catch (error) {}
})();
`.trim();
