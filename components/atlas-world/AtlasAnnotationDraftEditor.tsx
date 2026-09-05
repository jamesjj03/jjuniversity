"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import type {
  AtlasAnnotationDraftContent,
  AtlasAnnotationDraftEvidence,
  AtlasAnnotationDraftMutation,
  AtlasAnnotationDraftRecord,
  AtlasAnnotationDraftSnapshot,
  AtlasAnnotationDraftState,
} from "@/lib/atlas-world/annotations/draftTypes";
import styles from "./AtlasAnnotationDraftEditor.module.css";

type Props = {
  snapshot: AtlasAnnotationDraftSnapshot;
  version: string;
  actor: string;
  onSaved: (snapshot: AtlasAnnotationDraftSnapshot, version: string, notice: string) => void;
  onNotice: (notice: string) => void;
  onDirtyChange: (dirty: boolean) => void;
};

type EvidenceForm = Omit<AtlasAnnotationDraftEvidence, "id" | "retrievedAt">;
type FormState = {
  origin: AtlasAnnotationDraftRecord["origin"];
  headline: string;
  summary: string;
  viewPresetId: string;
  layerIds: string[];
  entityIds: string[];
  featureIds: string[];
  focusLongitude: string;
  focusLatitude: string;
  west: string;
  south: string;
  east: string;
  north: string;
  highlightKind: AtlasAnnotationDraftContent["spatial"]["highlight"]["kind"];
  evidence: EvidenceForm[];
  relatedLayerIds: string[];
  actionEnabled: boolean;
  actionLabel: string;
  actionViewPresetId: string;
  actionLayerIds: string[];
  caveats: string;
};

const EMPTY_EVIDENCE: EvidenceForm = {
  title: "",
  publisher: "",
  url: "",
  publishedAt: null,
  supports: "",
};

function cleanEtag(value: string | null) {
  return String(value || "").trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

function blankForm(snapshot: AtlasAnnotationDraftSnapshot): FormState {
  const view = snapshot.references.views.find((candidate) => candidate.id === "where-people-live") ?? snapshot.references.views[0];
  return {
    origin: "manual_editorial",
    headline: "",
    summary: "",
    viewPresetId: view?.id || "",
    layerIds: view?.layerIds.slice(0, 1) || [],
    entityIds: [],
    featureIds: [],
    focusLongitude: "",
    focusLatitude: "",
    west: "",
    south: "",
    east: "",
    north: "",
    highlightKind: "bounds",
    evidence: [{ ...EMPTY_EVIDENCE }],
    relatedLayerIds: [],
    actionEnabled: false,
    actionLabel: "",
    actionViewPresetId: "",
    actionLayerIds: [],
    caveats: "",
  };
}

function formFromDraft(draft: AtlasAnnotationDraftRecord): FormState {
  const { content } = draft;
  return {
    origin: draft.origin,
    headline: content.headline,
    summary: content.summary,
    viewPresetId: content.viewPresetId,
    layerIds: [...content.layerIds],
    entityIds: [...content.spatial.entityIds],
    featureIds: [...content.spatial.featureIds],
    focusLongitude: content.spatial.focus ? String(content.spatial.focus.longitude) : "",
    focusLatitude: content.spatial.focus ? String(content.spatial.focus.latitude) : "",
    west: content.spatial.boundsWgs84 ? String(content.spatial.boundsWgs84[0][0]) : "",
    south: content.spatial.boundsWgs84 ? String(content.spatial.boundsWgs84[0][1]) : "",
    east: content.spatial.boundsWgs84 ? String(content.spatial.boundsWgs84[1][0]) : "",
    north: content.spatial.boundsWgs84 ? String(content.spatial.boundsWgs84[1][1]) : "",
    highlightKind: content.spatial.highlight.kind,
    evidence: content.evidence.map(({ title, publisher, url, publishedAt, supports }) => ({ title, publisher, url, publishedAt, supports })),
    relatedLayerIds: [...content.relatedLayerIds],
    actionEnabled: Boolean(content.action),
    actionLabel: content.action?.label || "",
    actionViewPresetId: content.action?.viewPresetId || "",
    actionLayerIds: [...(content.action?.layerIds || [])],
    caveats: content.caveats.join("\n"),
  };
}

function optionalPoint(left: string, right: string) {
  if (!left.trim() && !right.trim()) return null;
  return { longitude: Number(left), latitude: Number(right) };
}

function optionalBounds(form: FormState): [[number, number], [number, number]] | null {
  if (![form.west, form.south, form.east, form.north].some((value) => value.trim())) return null;
  return [[Number(form.west), Number(form.south)], [Number(form.east), Number(form.north)]];
}

function contentFromForm(form: FormState): AtlasAnnotationDraftContent {
  return {
    headline: form.headline,
    summary: form.summary,
    viewPresetId: form.viewPresetId,
    layerIds: form.layerIds,
    spatial: {
      entityIds: form.entityIds,
      featureIds: form.featureIds,
      focus: optionalPoint(form.focusLongitude, form.focusLatitude),
      boundsWgs84: optionalBounds(form),
      highlight: { kind: form.highlightKind },
    },
    evidence: form.evidence.map((source) => ({ ...source, id: "pending", retrievedAt: "pending" })),
    relatedLayerIds: form.relatedLayerIds,
    action: form.actionEnabled ? {
      label: form.actionLabel,
      viewPresetId: form.actionViewPresetId || null,
      layerIds: form.actionLayerIds,
    } : null,
    caveats: form.caveats.split("\n").map((value) => value.trim()).filter(Boolean),
  };
}

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function stateLabel(state: AtlasAnnotationDraftState) {
  if (state === "draft") return "Working draft";
  if (state === "proposed") return "Awaiting review";
  if (state === "approved") return "Approved · not promoted";
  if (state === "rejected") return "Rejected";
  return "Retired";
}

export default function AtlasAnnotationDraftEditor({ snapshot, version, actor, onSaved, onNotice, onDirtyChange }: Props) {
  const { setUnsaved } = useAdminUnsavedChanges();
  const [selectedId, setSelectedId] = useState(snapshot.drafts[0]?.draft.id ?? "");
  const selectedItem = snapshot.drafts.find((item) => item.draft.id === selectedId) ?? null;
  const [form, setForm] = useState<FormState>(() => selectedItem ? formFromDraft(selectedItem.draft) : blankForm(snapshot));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decisionNote, setDecisionNote] = useState("");
  const [entityQuery, setEntityQuery] = useState("");
  const [featureQuery, setFeatureQuery] = useState("");
  const hasUnsavedDraftWork = dirty || decisionNote.trim().length > 0;

  useEffect(() => setUnsaved("atlas-annotation-draft", hasUnsavedDraftWork, "this Atlas explanation draft"), [hasUnsavedDraftWork, setUnsaved]);
  useEffect(() => () => setUnsaved("atlas-annotation-draft", false), [setUnsaved]);
  useEffect(() => {
    onDirtyChange(hasUnsavedDraftWork);
  }, [hasUnsavedDraftWork, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const selectedView = snapshot.references.views.find((view) => view.id === form.viewPresetId) ?? snapshot.references.views[0];
  const layerById = useMemo(() => new Map(snapshot.references.layers.map((layer) => [layer.id, layer])), [snapshot.references.layers]);
  const entityById = useMemo(() => new Map(snapshot.references.entities.map((entity) => [entity.id, entity])), [snapshot.references.entities]);
  const featureById = useMemo(() => new Map(snapshot.references.features.map((feature) => [feature.id, feature])), [snapshot.references.features]);
  const matchingEntities = useMemo(() => {
    const query = entityQuery.trim().toLowerCase();
    if (!query) return [];
    return snapshot.references.entities.filter((entity) => `${entity.name} ${entity.id}`.toLowerCase().includes(query)).slice(0, 12);
  }, [entityQuery, snapshot.references.entities]);
  const matchingFeatures = useMemo(() => {
    const query = featureQuery.trim().toLowerCase();
    if (!query) return [];
    return snapshot.references.features.filter((feature) => `${feature.name} ${feature.kind} ${feature.id}`.toLowerCase().includes(query)).slice(0, 12);
  }, [featureQuery, snapshot.references.features]);
  const editable = !selectedItem || selectedItem.draft.state === "draft" || selectedItem.draft.state === "proposed";

  function patch(next: Partial<FormState>) {
    setForm((current) => ({ ...current, ...next }));
    setDirty(true);
  }

  function chooseDraft(id: string) {
    if (hasUnsavedDraftWork && !window.confirm("Discard the unsaved annotation changes in this form?")) return;
    setSelectedId(id);
    const item = snapshot.drafts.find((candidate) => candidate.draft.id === id);
    setForm(item ? formFromDraft(item.draft) : blankForm(snapshot));
    setDirty(false);
    setDecisionNote("");
  }

  function startNew() {
    if (hasUnsavedDraftWork && !window.confirm("Discard the unsaved annotation changes in this form?")) return;
    setSelectedId("");
    setForm(blankForm(snapshot));
    setDirty(false);
    setDecisionNote("");
  }

  async function mutate(mutation: Omit<AtlasAnnotationDraftMutation, "actor" | "sourceVersion">) {
    if (busy) return;
    if (!actor.trim()) {
      onNotice("Add your name above before saving or reviewing an annotation draft.");
      return;
    }
    setBusy(true);
    onNotice("");
    try {
      const response = await fetch("/api/admin/atlas/annotation-drafts", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": version },
        body: JSON.stringify({ ...mutation, actor, sourceVersion: snapshot.references.version }),
      });
      const payload = await response.json() as {
        error?: string;
        note?: string;
        snapshot?: Omit<AtlasAnnotationDraftSnapshot, "version">;
      };
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "The annotation draft could not be saved.");
      const nextVersion = cleanEtag(response.headers.get("etag"));
      if (!nextVersion) throw new Error("The save returned no exact version. Reload before editing again.");
      const nextSnapshot = { ...payload.snapshot, version: nextVersion };
      let nextSelectedId = selectedId;
      if (!selectedId && mutation.operation === "create") {
        const oldIds = new Set(snapshot.drafts.map((item) => item.draft.id));
        nextSelectedId = nextSnapshot.drafts.find((item) => !oldIds.has(item.draft.id))?.draft.id || "";
        setSelectedId(nextSelectedId);
      }
      const savedItem = nextSnapshot.drafts.find((item) => item.draft.id === nextSelectedId);
      if (savedItem) setForm(formFromDraft(savedItem.draft));
      onSaved(nextSnapshot, nextVersion, payload.note || "Annotation draft saved.");
      setDirty(false);
      setDecisionNote("");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The annotation draft could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    await mutate({
      operation: selectedItem ? "save" : "create",
      draftId: selectedItem?.draft.id,
      origin: form.origin,
      content: contentFromForm(form),
    });
  }

  async function transition(state: AtlasAnnotationDraftState) {
    if (!selectedItem || dirty) {
      onNotice("Save the current draft before changing its review state.");
      return;
    }
    await mutate({ operation: "transition", draftId: selectedItem.draft.id, state, decisionNote });
  }

  function patchEvidence(index: number, value: Partial<EvidenceForm>) {
    patch({ evidence: form.evidence.map((source, sourceIndex) => sourceIndex === index ? { ...source, ...value } : source) });
  }

  const previewBounds = optionalBounds(form);
  const previewFocus = optionalPoint(form.focusLongitude, form.focusLatitude);
  const boundsRect = previewBounds && previewBounds.flat().every(Number.isFinite) ? {
    x: ((previewBounds[0][0] + 180) / 360) * 100,
    y: ((85 - previewBounds[1][1]) / 170) * 50,
    width: ((previewBounds[1][0] - previewBounds[0][0]) / 360) * 100,
    height: ((previewBounds[1][1] - previewBounds[0][1]) / 170) * 50,
  } : null;
  const focusPoint = previewFocus && Number.isFinite(previewFocus.longitude) && Number.isFinite(previewFocus.latitude) ? {
    x: ((previewFocus.longitude + 180) / 360) * 100,
    y: ((85 - previewFocus.latitude) / 170) * 50,
  } : null;

  return (
    <section className={styles.workspace} aria-label="Annotation draft editor">
      <header className={styles.intro}>
        <div><h2>Author an explanation</h2><p>Create and review an evidence-backed proposal without touching public Atlas notes.</p></div>
        <div className={styles.promotionBoundary}><strong>Promotion is a separate operation</strong><span>Even “Approved” here means approved for a later promotion review—not published.</span></div>
      </header>

      <div className={styles.draftBar}>
        <label><span>Draft</span><select value={selectedId} onChange={(event) => chooseDraft(event.target.value)}>
          <option value="">New annotation</option>
          {snapshot.drafts.map(({ draft, stale }) => <option key={draft.id} value={draft.id}>{draft.content.headline} · {stateLabel(draft.state)}{stale ? " · stale" : ""}</option>)}
        </select></label>
        <button type="button" onClick={startNew}>New proposal</button>
        {selectedItem && <span className={styles.state}>{stateLabel(selectedItem.draft.state)}{selectedItem.stale ? " · source references changed" : ""}</span>}
      </div>

      <div className={styles.split}>
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <fieldset disabled={!editable || busy}>
            <legend>Explanation</legend>
            <div className={styles.twoColumns}>
              <label><span>Draft origin</span><select value={form.origin} onChange={(event) => patch({ origin: event.target.value as FormState["origin"] })}><option value="manual_editorial">Human-authored</option><option value="ai_assisted">AI-assisted proposal</option></select></label>
              <label><span>Scene</span><select value={form.viewPresetId} onChange={(event) => {
                const view = snapshot.references.views.find((candidate) => candidate.id === event.target.value);
                patch({ viewPresetId: event.target.value, layerIds: view?.layerIds.slice(0, 1) || [] });
              }}>{snapshot.references.views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
            </div>
            <label><span>Headline</span><input value={form.headline} maxLength={120} onChange={(event) => patch({ headline: event.target.value })} placeholder="What visible pattern should the user notice?" /></label>
            <label><span>Concise explanation</span><textarea value={form.summary} maxLength={700} onChange={(event) => patch({ summary: event.target.value })} placeholder="Explain why the pattern looks this way, without implying more certainty than the evidence supports." /></label>

            <details open>
              <summary>Trigger layers</summary>
              <div className={styles.checkGrid}>{(selectedView?.layerIds || []).map((layerId) => <label className={styles.check} key={layerId}><input type="checkbox" checked={form.layerIds.includes(layerId)} onChange={() => patch({ layerIds: toggle(form.layerIds, layerId) })} /><span>{layerById.get(layerId)?.name || layerId}</span></label>)}</div>
            </details>

            <details open>
              <summary>Geography and highlight</summary>
              <div className={styles.searchAdder}>
                <label><span>Add country or entity</span><input value={entityQuery} onChange={(event) => setEntityQuery(event.target.value)} placeholder="Search Egypt, Indonesia…" /></label>
                {matchingEntities.length > 0 && <div className={styles.matches}>{matchingEntities.map((entity) => <button type="button" key={entity.id} onClick={() => { patch({ entityIds: [...new Set([...form.entityIds, entity.id])] }); setEntityQuery(""); }}>{entity.name}<small>{entity.id}</small></button>)}</div>}
                <div className={styles.chips}>{form.entityIds.map((id) => <button type="button" key={id} onClick={() => patch({ entityIds: form.entityIds.filter((value) => value !== id) })}>{entityById.get(id)?.name || id} ×</button>)}</div>
              </div>
              <div className={styles.searchAdder}>
                <label><span>Add mapped river, lake, or city feature</span><input value={featureQuery} onChange={(event) => setFeatureQuery(event.target.value)} placeholder="Search Nile, Java cities…" /></label>
                {matchingFeatures.length > 0 && <div className={styles.matches}>{matchingFeatures.map((feature) => <button type="button" key={feature.id} onClick={() => { patch({ featureIds: [...new Set([...form.featureIds, feature.id])] }); setFeatureQuery(""); }}>{feature.name}<small>{feature.kind}</small></button>)}</div>}
                <div className={styles.chips}>{form.featureIds.map((id) => <button type="button" key={id} onClick={() => patch({ featureIds: form.featureIds.filter((value) => value !== id) })}>{featureById.get(id)?.name || id} ×</button>)}</div>
              </div>
              <div className={styles.coordinateGrid}>
                <label><span>Focus longitude</span><input inputMode="decimal" value={form.focusLongitude} onChange={(event) => patch({ focusLongitude: event.target.value })} /></label>
                <label><span>Focus latitude</span><input inputMode="decimal" value={form.focusLatitude} onChange={(event) => patch({ focusLatitude: event.target.value })} /></label>
                <label><span>West</span><input inputMode="decimal" value={form.west} onChange={(event) => patch({ west: event.target.value })} /></label>
                <label><span>South</span><input inputMode="decimal" value={form.south} onChange={(event) => patch({ south: event.target.value })} /></label>
                <label><span>East</span><input inputMode="decimal" value={form.east} onChange={(event) => patch({ east: event.target.value })} /></label>
                <label><span>North</span><input inputMode="decimal" value={form.north} onChange={(event) => patch({ north: event.target.value })} /></label>
              </div>
              <label><span>Highlight</span><select value={form.highlightKind} onChange={(event) => patch({ highlightKind: event.target.value as FormState["highlightKind"] })}><option value="bounds">Viewing bounds</option><option value="feature-reference">Mapped features</option><option value="point">Focus point</option></select></label>
              <p className={styles.help}>Coordinates are canonical WGS84. This bounded editor uses searchable IDs and numeric bounds; drawing directly on the map is intentionally deferred.</p>
            </details>

            <details open>
              <summary>Evidence</summary>
              {form.evidence.map((source, index) => <div className={styles.evidenceEditor} key={index}>
                <div className={styles.twoColumns}><label><span>Source title</span><input value={source.title} onChange={(event) => patchEvidence(index, { title: event.target.value })} /></label><label><span>Publisher</span><input value={source.publisher} onChange={(event) => patchEvidence(index, { publisher: event.target.value })} /></label></div>
                <label><span>Source URL</span><input type="url" value={source.url} onChange={(event) => patchEvidence(index, { url: event.target.value })} /></label>
                <label><span>What this source supports</span><textarea value={source.supports} onChange={(event) => patchEvidence(index, { supports: event.target.value })} /></label>
                <label><span>Publication date, month, or year</span><input value={source.publishedAt || ""} onChange={(event) => patchEvidence(index, { publishedAt: event.target.value || null })} placeholder="2024-06-12, 2024-06, or 2024" /></label>
                {form.evidence.length > 1 && <button type="button" className={styles.remove} onClick={() => patch({ evidence: form.evidence.filter((_, sourceIndex) => sourceIndex !== index) })}>Remove source</button>}
              </div>)}
              <button type="button" className={styles.add} disabled={form.evidence.length >= 8} onClick={() => patch({ evidence: [...form.evidence, { ...EMPTY_EVIDENCE }] })}>Add another source</button>
            </details>

            <details>
              <summary>Related action and caveats</summary>
              <div className={styles.checkGrid}>{snapshot.references.layers.map((layer) => <label className={styles.check} key={layer.id}><input type="checkbox" checked={form.relatedLayerIds.includes(layer.id)} onChange={() => patch({ relatedLayerIds: toggle(form.relatedLayerIds, layer.id) })} /><span>{layer.name}</span></label>)}</div>
              <label className={styles.check}><input type="checkbox" checked={form.actionEnabled} onChange={(event) => patch({ actionEnabled: event.target.checked })} /><span>Offer a related Atlas action</span></label>
              {form.actionEnabled && <>
                <div className={styles.twoColumns}><label><span>Action label</span><input value={form.actionLabel} onChange={(event) => patch({ actionLabel: event.target.value })} placeholder="See the river system" /></label><label><span>Action scene</span><select value={form.actionViewPresetId} onChange={(event) => patch({ actionViewPresetId: event.target.value })}><option value="">Keep current scene</option>{snapshot.references.views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label></div>
                <div className={styles.checkGrid}>{snapshot.references.layers.map((layer) => <label className={styles.check} key={`action-${layer.id}`}><input type="checkbox" checked={form.actionLayerIds.includes(layer.id)} onChange={() => patch({ actionLayerIds: toggle(form.actionLayerIds, layer.id) })} /><span>Action shows {layer.name}</span></label>)}</div>
              </>}
              <label><span>Caveats · one per line</span><textarea value={form.caveats} onChange={(event) => patch({ caveats: event.target.value })} /></label>
            </details>

            <button className={styles.save} type="submit">{busy ? "Saving…" : selectedItem ? "Save draft revision" : "Create private draft"}</button>
          </fieldset>
        </form>

        <aside className={styles.preview} aria-label="Annotation draft preview">
          <span className={styles.previewFlag}>Draft preview · not public</span>
          <div className={styles.miniMap}>
            <svg viewBox="0 0 100 50" role="img" aria-label="WGS84 focus and bounds preview">
              <path d="M0 25H100M50 0V50M25 0V50M75 0V50M0 12.5H100M0 37.5H100" />
              {boundsRect && <rect x={boundsRect.x} y={boundsRect.y} width={boundsRect.width} height={boundsRect.height} />}
              {focusPoint && <circle cx={focusPoint.x} cy={focusPoint.y} r="1.8" />}
            </svg>
          </div>
          <p className={styles.previewScene}>{selectedView?.name || "Choose a scene"} · {form.layerIds.map((id) => layerById.get(id)?.name || id).join(", ") || "No trigger layer"}</p>
          <h3>{form.headline || "Your explanation headline"}</h3>
          <p>{form.summary || "The concise explanation will appear here while you work."}</p>
          {(form.entityIds.length > 0 || form.featureIds.length > 0) && <dl><dt>Geography</dt><dd>{[
            ...form.entityIds.map((id) => entityById.get(id)?.name || id),
            ...form.featureIds.map((id) => featureById.get(id)?.name || id),
          ].join(" · ")}</dd></dl>}
          <section><h4>Evidence</h4>{form.evidence.map((source, index) => <div key={index}><strong>{source.publisher || "Publisher"}: {source.title || "Source title"}</strong><p>{source.supports || "The support statement will make clear what this source actually establishes."}</p></div>)}</section>
          {form.caveats.trim() && <section><h4>Caveats</h4><ul>{form.caveats.split("\n").filter(Boolean).map((value) => <li key={value}>{value}</li>)}</ul></section>}
          {form.actionEnabled && <button type="button" disabled>{form.actionLabel || "Related Atlas action"}</button>}
          <footer>Preview uses a simple coordinate frame, not the production map renderer. It verifies the authored claim and extent without implying publication.</footer>
        </aside>
      </div>

      {selectedItem && <section className={styles.reviewDock}>
        <div><strong>Review state: {stateLabel(selectedItem.draft.state)}</strong><p>Approval remains inside the private draft authority. There is intentionally no “publish” button.</p></div>
        <label><span>Review decision note</span><textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Required for approval, rejection, or retirement" /></label>
        <div className={styles.reviewActions}>
          {(selectedItem.draft.state === "draft" || selectedItem.draft.state === "rejected") && <button type="button" disabled={busy || dirty} onClick={() => void transition("proposed")}>Submit for review</button>}
          {selectedItem.draft.state === "proposed" && <><button type="button" disabled={busy || dirty || selectedItem.stale || !decisionNote.trim()} onClick={() => void transition("approved")}>Approve proposal</button><button type="button" disabled={busy || dirty || !decisionNote.trim()} onClick={() => void transition("rejected")}>Reject</button></>}
          {(selectedItem.draft.state === "approved" || selectedItem.draft.state === "rejected" || selectedItem.draft.state === "retired") && <button type="button" disabled={busy || dirty} onClick={() => void transition("draft")}>Revise as draft</button>}
          {selectedItem.draft.state !== "retired" && <button type="button" disabled={busy || dirty || !decisionNote.trim()} onClick={() => void transition("retired")}>Retire</button>}
        </div>
      </section>}
    </section>
  );
}
