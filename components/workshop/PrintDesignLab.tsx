"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import styles from "./PrintDesignLab.module.css";

const STORAGE_KEY = "jju.workshop.print-design-lab.v2";
const UNSAVED_SOURCE = "print-design-lab";

type ConceptId = "midnight-library" | "field-index" | "monument-split";
type PaletteId = "obsidian-gold" | "parchment-ink" | "collection-led" | "oxide-bone";
type MaterialId = "matte" | "soft-touch" | "linen";
type PreviewMode = "front" | "wrap" | "shelf";

type DesignDraft = {
  concept: ConceptId;
  series: string;
  title: string;
  subtitle: string;
  volume: string;
  collectionId: string;
  collectionName: string;
  collectionCode: string;
  collectionColor: string;
  palette: PaletteId;
  material: MaterialId;
  titleX: number;
  titleY: number;
  titleScale: number;
  spineWidth: number;
  accentStrength: number;
  directionForCodex: string;
};

type HistoryState = {
  past: DesignDraft[];
  present: DesignDraft;
  future: DesignDraft[];
};

type HistoryAction =
  | { type: "patch"; patch: Partial<DesignDraft> }
  | { type: "replace"; draft: DesignDraft }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" };

type DraftEnvelope = {
  schemaVersion: 1;
  kind: "jju-print-cover-design";
  savedAt: string;
  design: DesignDraft;
};

type PreviewVariables = CSSProperties & Record<`--${string}`, string>;

const CONCEPTS: Array<{
  id: ConceptId;
  name: string;
  label: string;
  summary: string;
  shelfNote: string;
  recommended?: boolean;
  defaults: Pick<DesignDraft, "titleX" | "titleY" | "titleScale" | "accentStrength">;
}> = [
  {
    id: "midnight-library",
    name: "Midnight Library",
    label: "Quiet authority",
    summary: "Matte black, restrained foil, and one collection-color signal. It can hold history, science, power, and culture without looking like four different brands.",
    shelfNote: "Best all-series shelf. The spines read as one library before they read as individual books.",
    recommended: true,
    defaults: { titleX: 44, titleY: 50, titleScale: 100, accentStrength: 52 },
  },
  {
    id: "field-index",
    name: "Field Index",
    label: "Editorial utility",
    summary: "Warm paper, visible catalog codes, and a modular index-card grid. It feels like a serious reference set without pretending to be an old encyclopedia.",
    shelfNote: "Fastest to navigate. Collection color and volume codes stay obvious from several feet away.",
    defaults: { titleX: 50, titleY: 54, titleScale: 92, accentStrength: 68 },
  },
  {
    id: "monument-split",
    name: "Monument Split",
    label: "Bold architecture",
    summary: "A hard color split, oversized typography, and heavy vertical geometry. This is the most contemporary and the strongest when a cover faces outward.",
    shelfNote: "Most dramatic rhythm. Better for a smaller flagship collection than hundreds of titles.",
    defaults: { titleX: 48, titleY: 56, titleScale: 112, accentStrength: 78 },
  },
];

const COLLECTIONS = [
  { id: "big-picture", name: "The Big Picture", code: "BP–01", color: "#315d91" },
  { id: "system", name: "The System", code: "SYS–01", color: "#9b3d37" },
  { id: "rulers", name: "The Rulers", code: "RUL–01", color: "#ad7a25" },
  { id: "divine-archive", name: "The Divine Archive", code: "DIV–01", color: "#694d86" },
  { id: "red-white-bruised", name: "Red, White, and Bruised", code: "RWB–01", color: "#7f3f4a" },
  { id: "map-makers", name: "Map Makers", code: "MAP–01", color: "#32715e" },
  { id: "social-codes", name: "Social Codes", code: "SOC–01", color: "#2c6771" },
] as const;

const PALETTES: Array<{ id: PaletteId; name: string; note: string }> = [
  { id: "obsidian-gold", name: "Obsidian + gold", note: "JJU baseline · strongest matte result" },
  { id: "parchment-ink", name: "Parchment + ink", note: "Lighter reference-library direction" },
  { id: "collection-led", name: "Collection-led", note: "Uses the collection color as the field" },
  { id: "oxide-bone", name: "Oxide + bone", note: "Warmer, less formal, still shelf-stable" },
];

const MATERIALS: Array<{ id: MaterialId; name: string; note: string }> = [
  { id: "matte", name: "Matte", note: "Recommended baseline" },
  { id: "soft-touch", name: "Soft-touch", note: "Velvety simulated finish" },
  { id: "linen", name: "Linen casewrap", note: "Premium texture study" },
];

const DEFAULT_DRAFT: DesignDraft = {
  concept: "midnight-library",
  series: "101 · HOW WE FIGURED IT OUT",
  title: "CALCULUS 101",
  subtitle: "A HISTORY OF CHANGE",
  volume: "VOLUME I",
  collectionId: "big-picture",
  collectionName: "The Big Picture",
  collectionCode: "BP–01",
  collectionColor: "#315d91",
  palette: "obsidian-gold",
  material: "matte",
  titleX: 44,
  titleY: 50,
  titleScale: 100,
  spineWidth: 1.35,
  accentStrength: 52,
  directionForCodex: "Keep the shelf disciplined, but let the collection color do more work on the spine.",
};

const SHELF_VARIANTS = [
  { title: "THE PYRAMID", volume: "VOLUME II", code: "SYS–01", color: "#9b3d37" },
  { title: "THE PRESIDENTS", volume: "VOLUME III", code: "RUL–01", color: "#ad7a25" },
  { title: "PANTHEON I", volume: "VOLUME IV", code: "BP–04", color: "#315d91" },
  { title: "THE BORDERS BOOK", volume: "VOLUME V", code: "MAP–01", color: "#32715e" },
] as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function copyDraft(draft: DesignDraft): DesignDraft {
  return { ...draft };
}

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return {
      past: state.past.slice(0, -1),
      present: copyDraft(previous),
      future: [copyDraft(state.present), ...state.future].slice(0, 80),
    };
  }
  if (action.type === "redo") {
    const next = state.future[0];
    if (!next) return state;
    return {
      past: [...state.past, copyDraft(state.present)].slice(-80),
      present: copyDraft(next),
      future: state.future.slice(1),
    };
  }
  if (action.type === "replace") {
    return { past: [], present: copyDraft(action.draft), future: [] };
  }

  const next = action.type === "reset"
    ? copyDraft(DEFAULT_DRAFT)
    : { ...state.present, ...action.patch };
  if (JSON.stringify(next) === JSON.stringify(state.present)) return state;
  return {
    past: [...state.past, copyDraft(state.present)].slice(-80),
    present: next,
    future: [],
  };
}

function parseDraft(value: unknown): DraftEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.schemaVersion !== 1
    || envelope.kind !== "jju-print-cover-design"
    || typeof envelope.savedAt !== "string"
    || !Number.isFinite(Date.parse(envelope.savedAt))
    || !envelope.design
    || typeof envelope.design !== "object"
    || Array.isArray(envelope.design)
  ) return null;

  const raw = envelope.design as Record<string, unknown>;
  const conceptIds = CONCEPTS.map(concept => concept.id);
  const paletteIds = PALETTES.map(palette => palette.id);
  const materialIds = MATERIALS.map(material => material.id);
  if (
    !conceptIds.includes(raw.concept as ConceptId)
    || !paletteIds.includes(raw.palette as PaletteId)
    || !materialIds.includes(raw.material as MaterialId)
    || typeof raw.series !== "string"
    || typeof raw.title !== "string"
    || typeof raw.subtitle !== "string"
    || typeof raw.volume !== "string"
    || typeof raw.collectionId !== "string"
    || typeof raw.collectionName !== "string"
    || typeof raw.collectionCode !== "string"
    || typeof raw.collectionColor !== "string"
    || !/^#[0-9a-f]{6}$/i.test(raw.collectionColor)
    || !Number.isFinite(raw.titleX)
    || !Number.isFinite(raw.titleY)
    || !Number.isFinite(raw.titleScale)
    || !Number.isFinite(raw.spineWidth)
    || !Number.isFinite(raw.accentStrength)
    || (raw.directionForCodex !== undefined && typeof raw.directionForCodex !== "string")
  ) return null;

  return {
    schemaVersion: 1,
    kind: "jju-print-cover-design",
    savedAt: envelope.savedAt,
    design: {
      concept: raw.concept as ConceptId,
      series: raw.series.slice(0, 100),
      title: raw.title.slice(0, 180),
      subtitle: raw.subtitle.slice(0, 240),
      volume: raw.volume.slice(0, 80),
      collectionId: raw.collectionId.slice(0, 80),
      collectionName: raw.collectionName.slice(0, 120),
      collectionCode: raw.collectionCode.slice(0, 40),
      collectionColor: raw.collectionColor,
      palette: raw.palette as PaletteId,
      material: raw.material as MaterialId,
      titleX: clamp(Number(raw.titleX), 18, 82),
      titleY: clamp(Number(raw.titleY), 22, 78),
      titleScale: clamp(Number(raw.titleScale), 70, 140),
      spineWidth: clamp(Number(raw.spineWidth), 0.45, 2.25),
      accentStrength: clamp(Number(raw.accentStrength), 0, 100),
      directionForCodex: typeof raw.directionForCodex === "string" ? raw.directionForCodex.slice(0, 1200) : "",
    },
  };
}

function formatSavedAt(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not saved yet";
  return `Saved ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))}`;
}

function resolveColors(draft: DesignDraft) {
  if (draft.palette === "parchment-ink") {
    return { field: "#e8dfcc", ink: "#1d1b18", foil: draft.collectionColor, quiet: "#665f54" };
  }
  if (draft.palette === "collection-led") {
    return {
      field: `color-mix(in srgb, ${draft.collectionColor} 72%, #10100e)`,
      ink: "#f5efe2",
      foil: "#e6c86d",
      quiet: "#ded5c6",
    };
  }
  if (draft.palette === "oxide-bone") {
    return { field: "#672f2c", ink: "#f1e4cd", foil: "#d3ad61", quiet: "#d2bda3" };
  }
  return { field: "#11110f", ink: "#f2eadb", foil: "#d5ad55", quiet: "#aaa192" };
}

function designVariables(draft: DesignDraft, dragPosition: { x: number; y: number } | null): PreviewVariables {
  const colors = resolveColors(draft);
  const titleX = dragPosition?.x ?? draft.titleX;
  const titleY = dragPosition?.y ?? draft.titleY;
  return {
    "--cover-field": colors.field,
    "--cover-ink": colors.ink,
    "--cover-foil": colors.foil,
    "--cover-quiet": colors.quiet,
    "--collection-color": draft.collectionColor,
    "--title-x": `${titleX}%`,
    "--title-y": `${titleY}%`,
    "--title-scale": `${draft.titleScale / 100}`,
    "--spine-width": `${(draft.spineWidth * 57.5).toFixed(2)}px`,
    "--spine-width-mobile": `${(draft.spineWidth * (290 / 6)).toFixed(2)}px`,
    "--shelf-spine-width": `${(draft.spineWidth * 45).toFixed(2)}px`,
    "--shelf-spine-width-mobile": `${(draft.spineWidth * 25.2).toFixed(2)}px`,
    "--accent-strength": `${draft.accentStrength / 100}`,
    "--accent-opacity": `${0.28 + (draft.accentStrength / 100) * 0.72}`,
    "--accent-band-height": `${8 + (draft.accentStrength / 100) * 9}%`,
    "--accent-width": `${3 + (draft.accentStrength / 100) * 18}px`,
    "--accent-spine-width": `${3 + (draft.accentStrength / 100) * 8}px`,
    "--accent-percent": `${draft.accentStrength}%`,
  };
}

function downloadDesign(draft: DesignDraft) {
  const exportedAt = new Date().toISOString();
  const payload = {
    schemaVersion: 1,
    kind: "jju-print-cover-design-handoff",
    exportedAt,
    status: "design-draft-not-production-art",
    trim: {
      widthInches: 6,
      heightInches: 9,
      spineWidthInches: draft.spineWidth,
      note: "Final wrap dimensions, bleed, hinge, and barcode placement must come from the selected printer template after the interior page count is sealed.",
    },
    design: draft,
    resolvedColors: resolveColors(draft),
    productionActions: "none",
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `jju-cover-design-${draft.collectionCode.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "draft"}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function makeDesignBrief(draft: DesignDraft) {
  const concept = CONCEPTS.find(item => item.id === draft.concept)?.name || draft.concept;
  const palette = PALETTES.find(item => item.id === draft.palette)?.name || draft.palette;
  const material = MATERIALS.find(item => item.id === draft.material)?.name || draft.material;
  return [
    "JJU PRINT COVER DESIGN BRIEF",
    `Concept: ${concept}`,
    `Series: ${draft.series}`,
    `Title: ${draft.title}`,
    `Subtitle: ${draft.subtitle}`,
    `Volume: ${draft.volume}`,
    `Collection: ${draft.collectionName} (${draft.collectionCode})`,
    `Collection color: ${draft.collectionColor}`,
    `Palette / material: ${palette} / ${material}`,
    `Geometry: title ${draft.titleScale}% at X${Math.round(draft.titleX)} Y${Math.round(draft.titleY)}; ${draft.spineWidth.toFixed(2)}in spine; accent ${draft.accentStrength}%`,
    `Direction for Codex: ${draft.directionForCodex.trim() || "No additional direction yet."}`,
    "Boundary: design study only; no printing, ordering, publishing, or sale action.",
  ].join("\n");
}

function FrontCover({
  draft,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onTitleKeyDown,
}: {
  draft: DesignDraft;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onTitleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <article
      className={`${styles.coverFace} ${styles.frontCover}`}
      data-concept={draft.concept}
      data-material={draft.material}
      aria-label="Editable front-cover preview"
    >
      <div className={styles.coverTexture} aria-hidden="true" />
      <div className={styles.coverTopline}>
        <span>{draft.series || "Series"}</span>
        <span>{draft.collectionCode || "Code"}</span>
      </div>
      <div
        className={styles.titleBlock}
        role="group"
        tabIndex={0}
        aria-label="Title block. Drag to reposition, or use the arrow keys. Hold Shift for larger steps."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onTitleKeyDown}
      >
        <span className={styles.volumeLine}>{draft.volume || "Volume"}</span>
        <strong>{draft.title || "Untitled"}</strong>
        <span className={styles.subtitleLine}>{draft.subtitle || "Add a subtitle"}</span>
        <span className={styles.dragHint}>Drag title block</span>
      </div>
      <div className={styles.coverFooter}>
        <span>{draft.collectionName}</span>
        <strong>JAMES JOHNSON</strong>
      </div>
    </article>
  );
}

function BackCover({ draft }: { draft: DesignDraft }) {
  return (
    <article className={`${styles.coverFace} ${styles.backCover}`} data-concept={draft.concept} data-material={draft.material} aria-label="Back-cover preview">
      <div className={styles.coverTexture} aria-hidden="true" />
      <div className={styles.backHeading}>{draft.series || "JJ University"}</div>
      <p>
        A standardized series system built to hold a large connected library. Final summary, endorsements, pricing, and legal copy remain separate editorial decisions.
      </p>
      <div className={styles.backRule} aria-hidden="true" />
      <dl className={styles.backFacts}>
        <div><dt>Collection</dt><dd>{draft.collectionName}</dd></div>
        <div><dt>Volume</dt><dd>{draft.volume}</dd></div>
        <div><dt>Code</dt><dd>{draft.collectionCode}</dd></div>
      </dl>
      <div className={styles.barcodeReserve} aria-label="Reserved area for a future printer-supplied barcode">
        <span>BARCODE</span>
        <small>reserved after ISBN + printer template</small>
      </div>
    </article>
  );
}

function Spine({
  draft,
  compact = false,
  volume,
  title,
  code,
  color,
}: {
  draft: DesignDraft;
  compact?: boolean;
  volume?: string;
  title?: string;
  code?: string;
  color?: string;
}) {
  const variantStyle: PreviewVariables | undefined = color
    ? {
      "--collection-color": color,
      ...(draft.palette === "collection-led"
        ? { "--cover-field": `color-mix(in srgb, ${color} 72%, #10100e)` }
        : {}),
    }
    : undefined;
  const resolvedTitle = title || draft.title;
  return (
    <article
      className={`${styles.spine} ${compact ? styles.shelfSpine : ""}`}
      data-concept={draft.concept}
      data-material={draft.material}
      style={variantStyle}
      aria-label={compact ? `${resolvedTitle}, ${volume || draft.volume} shelf spine` : "Spine preview"}
    >
      <div className={styles.coverTexture} aria-hidden="true" />
      <span className={styles.spineSeries}>{compact ? "101" : draft.series}</span>
      <strong>{compact ? resolvedTitle : `${draft.title} · ${draft.subtitle}`}</strong>
      <span className={styles.spineVolume}>{compact ? (volume || draft.volume).replace(/^VOLUME\s+/i, "") : (volume || draft.volume)}</span>
      <span className={styles.spineCode}>{code || draft.collectionCode}</span>
    </article>
  );
}

export default function PrintDesignLab() {
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: copyDraft(DEFAULT_DRAFT),
    future: [],
  });
  const [previewMode, setPreviewMode] = useState<PreviewMode>("front");
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [notice, setNotice] = useState("Loading this device’s cover draft…");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [storageNotice, setStorageNotice] = useState("");
  const [replaceBlockedCopyAllowed, setReplaceBlockedCopyAllowed] = useState(false);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ pointerX: number; pointerY: number; titleX: number; titleY: number; width: number; height: number } | null>(null);
  const lastSaved = useRef("");
  const blockedBaseline = useRef(JSON.stringify(DEFAULT_DRAFT));
  const { setUnsaved } = useAdminUnsavedChanges();
  const draft = history.present;
  const variables = useMemo(() => designVariables(draft, dragPosition), [draft, dragPosition]);
  const activeConcept = CONCEPTS.find(concept => concept.id === draft.concept) || CONCEPTS[0];

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          lastSaved.current = JSON.stringify(DEFAULT_DRAFT);
          setNotice("Fresh local study. Changes will save automatically on this device.");
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          setStorageBlocked(true);
          setReplaceBlockedCopyAllowed(true);
          const message = "A damaged local cover draft was found and left untouched. Download it or replace it deliberately.";
          setStorageNotice(message);
          setNotice(message);
          return;
        }
        const envelope = parseDraft(parsed);
        if (!envelope) {
          setStorageBlocked(true);
          setReplaceBlockedCopyAllowed(true);
          const message = "An unknown local cover-draft format was found and left untouched. Download it or replace it deliberately.";
          setStorageNotice(message);
          setNotice(message);
          return;
        }
        dispatch({ type: "replace", draft: envelope.design });
        lastSaved.current = JSON.stringify(envelope.design);
        setSavedAt(envelope.savedAt);
        setNotice(`Recovered this device’s ${envelope.design.collectionCode || "cover"} design draft.`);
      } catch {
        setStorageBlocked(true);
        setReplaceBlockedCopyAllowed(false);
        const message = "Local cover-draft storage is unavailable. Editing still works; download JSON before leaving.";
        setStorageNotice(message);
        setNotice(message);
      } finally {
        setHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const serialized = JSON.stringify(draft);
    if (storageBlocked) {
      setUnsaved(UNSAVED_SOURCE, serialized !== blockedBaseline.current, "the unsaved Print Design Lab draft");
      return;
    }
    if (serialized === lastSaved.current) {
      setUnsaved(UNSAVED_SOURCE, false);
      return;
    }
    setUnsaved(UNSAVED_SOURCE, true, "the Print Design Lab draft");
    setNotice("Saving this design on this device…");
    const timer = window.setTimeout(() => {
      const nextSavedAt = new Date().toISOString();
      const envelope: DraftEnvelope = {
        schemaVersion: 1,
        kind: "jju-print-cover-design",
        savedAt: nextSavedAt,
        design: draft,
      };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
        lastSaved.current = serialized;
        setSavedAt(nextSavedAt);
        setNotice("Design saved locally. Nothing was printed, ordered, published, or sold.");
        setUnsaved(UNSAVED_SOURCE, false);
      } catch {
        blockedBaseline.current = lastSaved.current || JSON.stringify(DEFAULT_DRAFT);
        setStorageBlocked(true);
        setReplaceBlockedCopyAllowed(false);
        setUnsaved(UNSAVED_SOURCE, true, "the unsaved Print Design Lab draft");
        const message = "This browser could not save the design. Download JSON before leaving.";
        setStorageNotice(message);
        setNotice(message);
      }
    }, 420);
    return () => window.clearTimeout(timer);
  }, [draft, hydrated, setUnsaved, storageBlocked]);

  useEffect(() => () => setUnsaved(UNSAVED_SOURCE, false), [setUnsaved]);

  function patch(patchValue: Partial<DesignDraft>) {
    dispatch({ type: "patch", patch: patchValue });
  }

  function selectConcept(conceptId: ConceptId) {
    const concept = CONCEPTS.find(item => item.id === conceptId);
    if (!concept) return;
    patch({ concept: conceptId, ...concept.defaults });
  }

  function selectCollection(collectionId: string) {
    const collection = COLLECTIONS.find(item => item.id === collectionId);
    if (!collection) return;
    patch({
      collectionId: collection.id,
      collectionName: collection.name,
      collectionCode: collection.code,
      collectionColor: collection.color,
    });
  }

  function nudgeTitle(horizontal: number, vertical: number) {
    patch({
      titleX: clamp(draft.titleX + horizontal, 18, 82),
      titleY: clamp(draft.titleY + vertical, 22, 78),
    });
  }

  function titleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 5 : 1;
    if (event.key === "ArrowLeft") nudgeTitle(-step, 0);
    else if (event.key === "ArrowRight") nudgeTitle(step, 0);
    else if (event.key === "ArrowUp") nudgeTitle(0, -step);
    else if (event.key === "ArrowDown") nudgeTitle(0, step);
    else return;
    event.preventDefault();
  }

  function titlePointerDown(event: PointerEvent<HTMLDivElement>) {
    const face = event.currentTarget.closest(`.${styles.frontCover}`)?.getBoundingClientRect();
    if (!face) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      titleX: draft.titleX,
      titleY: draft.titleY,
      width: face.width,
      height: face.height,
    };
    setDragPosition({ x: draft.titleX, y: draft.titleY });
    event.preventDefault();
  }

  function titlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const start = dragStart.current;
    setDragPosition({
      x: clamp(start.titleX + ((event.clientX - start.pointerX) / start.width) * 100, 18, 82),
      y: clamp(start.titleY + ((event.clientY - start.pointerY) / start.height) * 100, 22, 78),
    });
  }

  function titlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const finalPosition = dragPosition;
    dragStart.current = null;
    setDragPosition(null);
    if (finalPosition) patch({ titleX: finalPosition.x, titleY: finalPosition.y });
  }

  function replaceBlockedDraft() {
    if (!window.confirm("Replace the unreadable local cover draft with the design currently on screen? The unreadable browser copy will be overwritten.")) return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      lastSaved.current = "";
      setStorageBlocked(false);
      setStorageNotice("");
      setReplaceBlockedCopyAllowed(false);
      setNotice("Unreadable local copy cleared. Saving the current design now.");
    } catch {
      const message = "This browser could not replace the unreadable local copy. Download JSON before leaving.";
      setStorageNotice(message);
      setNotice(message);
    }
  }

  function downloadBlockedDraft() {
    let raw = "";
    try {
      raw = window.localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      const message = "This browser could not read the damaged local draft.";
      setStorageNotice(message);
      setNotice(message);
      return;
    }
    const blob = new Blob([raw], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jju-cover-design-unreadable-draft.txt";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function copyDesignBrief() {
    try {
      await navigator.clipboard.writeText(makeDesignBrief(draft));
      setNotice("Copied a compact design brief. Paste it into chat whenever you want Codex to respond to this exact state.");
    } catch {
      setNotice("This browser could not copy the design brief. Download the design JSON instead.");
    }
  }

  function resetDesign() {
    if (!window.confirm("Reset every Print Design Lab field to the starting design? You can undo this until you leave or reload.")) return;
    dispatch({ type: "reset" });
  }

  return (
    <main className={styles.lab}>
      <header className={styles.labHeader}>
        <div>
          <p className={styles.eyebrow}>JJU Workshop · Print Design Lab</p>
          <h1>Build the shelf before building 300 covers.</h1>
          <p>
            Choose one repeatable series system, stress-test the wrap and spine, then carry it across collections. This is editable HTML and CSS—not final printer artwork.
          </p>
        </div>
        <div className={styles.safetyCard}>
          <strong>Design study only</strong>
          <span>No upload, order, checkout, sale, or ISBN action exists on this screen.</span>
          <small>{formatSavedAt(savedAt)}</small>
        </div>
      </header>

      <section className={styles.conceptSection} aria-labelledby="concept-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Cover systems</p>
            <h2 id="concept-heading">Three genuinely different directions</h2>
          </div>
          <p><strong>Recommendation:</strong> Midnight Library is the safest system for a huge, mixed-subject catalog and the strongest wall of thick spines.</p>
        </div>
        <div className={styles.conceptGrid}>
          {CONCEPTS.map(concept => (
            <button
              className={styles.conceptCard}
              data-active={draft.concept === concept.id ? "true" : "false"}
              data-concept={concept.id}
              type="button"
              aria-pressed={draft.concept === concept.id}
              onClick={() => selectConcept(concept.id)}
              key={concept.id}
            >
              <span className={styles.conceptMini} aria-hidden="true"><i /><i /><i /></span>
              <span className={styles.conceptCopy}>
                <span className={styles.conceptLabel}>{concept.label}{concept.recommended && <b>Recommended</b>}</span>
                <strong>{concept.name}</strong>
                <small>{concept.summary}</small>
                <em>{concept.shelfNote}</em>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.studio} aria-labelledby="studio-heading">
        <div className={styles.previewColumn}>
          <div className={styles.previewHeader}>
            <div>
              <p className={styles.eyebrow}>Live deterministic preview</p>
              <h2 id="studio-heading">{activeConcept.name}</h2>
            </div>
            <div className={styles.previewTabs} role="group" aria-label="Preview view">
              {(["front", "wrap", "shelf"] as PreviewMode[]).map(mode => (
                <button type="button" aria-pressed={previewMode === mode} onClick={() => setPreviewMode(mode)} key={mode}>
                  {mode === "front" ? "Front" : mode === "wrap" ? "Full wrap" : "Shelf"}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.previewStage} data-mode={previewMode} style={variables}>
            {previewMode === "front" && (
              <div className={styles.frontStage}>
                <FrontCover
                  draft={draft}
                  onPointerDown={titlePointerDown}
                  onPointerMove={titlePointerMove}
                  onPointerUp={titlePointerUp}
                  onTitleKeyDown={titleKeyDown}
                />
              </div>
            )}
            {previewMode === "wrap" && (
              <div className={styles.wrapScroller}>
                <div className={styles.wrapPreview}>
                  <BackCover draft={draft} />
                  <Spine draft={draft} />
                  <FrontCover
                    draft={draft}
                    onPointerDown={titlePointerDown}
                    onPointerMove={titlePointerMove}
                    onPointerUp={titlePointerUp}
                    onTitleKeyDown={titleKeyDown}
                  />
                </div>
              </div>
            )}
            {previewMode === "shelf" && (
              <div className={styles.shelfScene}>
                <div className={styles.shelfBooks}>
                  <Spine draft={draft} compact />
                  {SHELF_VARIANTS.map(variant => (
                    <Spine
                      draft={draft}
                      compact
                      title={variant.title}
                      volume={variant.volume}
                      code={variant.code}
                      color={variant.color}
                      key={variant.code}
                    />
                  ))}
                </div>
                <div className={styles.shelfBoard} aria-hidden="true" />
                <p>Five 101-library variants · simulated {draft.spineWidth.toFixed(2)}&quot; spines · {draft.material.replace("-", " ")}</p>
              </div>
            )}
          </div>

          <div className={styles.previewNote}>
            <strong>{previewMode === "front" ? "Move the title block directly." : previewMode === "wrap" ? "Scroll sideways on a phone to inspect back, spine, and front." : "Judge the set before judging one cover."}</strong>
            <span>{activeConcept.shelfNote}</span>
          </div>
        </div>

        <aside className={styles.controls} aria-label="Cover design controls">
          <section className={styles.controlSection}>
            <div className={styles.controlHeading}><span>01</span><h3>Words on the object</h3></div>
            <div className={styles.fieldGrid}>
              <label className={styles.wideField}>Series<input value={draft.series} maxLength={100} onChange={event => patch({ series: event.target.value })} /></label>
              <label className={styles.wideField}>Title<textarea value={draft.title} maxLength={180} rows={2} onChange={event => patch({ title: event.target.value })} /></label>
              <label className={styles.wideField}>Subtitle<textarea value={draft.subtitle} maxLength={240} rows={2} onChange={event => patch({ subtitle: event.target.value })} /></label>
              <label>Volume<input value={draft.volume} maxLength={80} onChange={event => patch({ volume: event.target.value })} /></label>
              <label>Collection code<input value={draft.collectionCode} maxLength={40} onChange={event => patch({ collectionCode: event.target.value })} /></label>
            </div>
          </section>

          <section className={styles.controlSection}>
            <div className={styles.controlHeading}><span>02</span><h3>Collection logic</h3></div>
            <label className={styles.selectField}>
              Collection
              <select value={draft.collectionId} onChange={event => selectCollection(event.target.value)}>
                {COLLECTIONS.map(collection => <option value={collection.id} key={collection.id}>{collection.name}</option>)}
              </select>
            </label>
            <div className={styles.colorLogic}>
              <label>Collection color<input type="color" value={draft.collectionColor} onChange={event => patch({ collectionColor: event.target.value })} /></label>
              <p>The preset assigns the collection name, code prefix, and signal color together. You can still override the exact color or code.</p>
            </div>
          </section>

          <section className={styles.controlSection}>
            <div className={styles.controlHeading}><span>03</span><h3>Palette and material</h3></div>
            <div className={styles.choiceGrid}>
              {PALETTES.map(palette => (
                <button type="button" data-active={draft.palette === palette.id ? "true" : "false"} aria-pressed={draft.palette === palette.id} onClick={() => patch({ palette: palette.id })} key={palette.id}>
                  <i data-palette={palette.id} style={{ "--swatch-color": draft.collectionColor } as PreviewVariables} aria-hidden="true" />
                  <span><strong>{palette.name}</strong><small>{palette.note}</small></span>
                </button>
              ))}
            </div>
            <div className={styles.materialRow} role="group" aria-label="Cover material simulation">
              {MATERIALS.map(material => (
                <button type="button" data-active={draft.material === material.id ? "true" : "false"} aria-pressed={draft.material === material.id} onClick={() => patch({ material: material.id })} key={material.id}>
                  <strong>{material.name}</strong><small>{material.note}</small>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.controlSection}>
            <div className={styles.controlHeading}><span>04</span><h3>Proportion and position</h3></div>
            <label className={styles.rangeField}>
              <span>Title scale <output>{draft.titleScale}%</output></span>
              <input type="range" min="70" max="140" step="1" value={draft.titleScale} onChange={event => patch({ titleScale: Number(event.target.value) })} />
            </label>
            <label className={styles.rangeField}>
              <span>Spine width study <output>{draft.spineWidth.toFixed(2)} in</output></span>
              <input type="range" min="0.45" max="2.25" step="0.05" value={draft.spineWidth} onChange={event => patch({ spineWidth: Number(event.target.value) })} />
            </label>
            <label className={styles.rangeField}>
              <span>Accent presence <output>{draft.accentStrength}%</output></span>
              <input type="range" min="0" max="100" step="1" value={draft.accentStrength} onChange={event => patch({ accentStrength: Number(event.target.value) })} />
            </label>
            <div className={styles.nudgeControl}>
              <span>Title block position</span>
              <div>
                <button type="button" aria-label="Move title block left" onClick={() => nudgeTitle(-1, 0)}>←</button>
                <button type="button" aria-label="Move title block up" onClick={() => nudgeTitle(0, -1)}>↑</button>
                <button type="button" aria-label="Move title block down" onClick={() => nudgeTitle(0, 1)}>↓</button>
                <button type="button" aria-label="Move title block right" onClick={() => nudgeTitle(1, 0)}>→</button>
              </div>
              <output aria-live="polite" aria-label={`Title block position X ${Math.round(draft.titleX)}, Y ${Math.round(draft.titleY)}`}>
                X {Math.round(draft.titleX)} · Y {Math.round(draft.titleY)}. Drag the preview or focus it and use arrow keys; Shift moves five steps.
              </output>
            </div>
          </section>

          <section className={styles.controlSection}>
            <div className={styles.controlHeading}><span>05</span><h3>Direction for Codex</h3></div>
            <label className={styles.directionField}>
              What should change next?
              <textarea
                value={draft.directionForCodex}
                maxLength={1200}
                rows={5}
                placeholder="Example: Make the spine bolder, keep the front quiet, and show me a version with less gold."
                onChange={event => patch({ directionForCodex: event.target.value })}
              />
            </label>
            <p className={styles.directionHelp}>This does not send anything automatically. Copy the brief and paste it into chat so Codex gets the exact concept, settings, and your note together.</p>
            <button className={styles.copyBriefButton} type="button" onClick={copyDesignBrief}>Copy design brief for chat</button>
          </section>
        </aside>
      </section>

      <section className={styles.designDock} aria-label="Design draft controls">
        <div className={styles.saveState} role="status" aria-live="polite">
          <strong>{storageBlocked ? (storageNotice || notice) : notice}</strong>
          <span>{draft.collectionName} · {draft.collectionCode} · {activeConcept.name}</span>
        </div>
        <div className={styles.dockActions}>
          {storageBlocked && replaceBlockedCopyAllowed && <button type="button" onClick={downloadBlockedDraft}>Download damaged copy</button>}
          {storageBlocked && replaceBlockedCopyAllowed && <button type="button" onClick={replaceBlockedDraft}>Replace local copy</button>}
          <button type="button" disabled={!history.past.length} onClick={() => dispatch({ type: "undo" })}>Undo</button>
          <button type="button" disabled={!history.future.length} onClick={() => dispatch({ type: "redo" })}>Redo</button>
          <button type="button" onClick={resetDesign}>Reset entire design</button>
          <button type="button" onClick={copyDesignBrief}>Copy design brief</button>
          <button className={styles.downloadButton} type="button" onClick={() => downloadDesign(draft)}>Download design JSON</button>
        </div>
      </section>
    </main>
  );
}
