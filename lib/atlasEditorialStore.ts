import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import rawLayerCatalog from "@/lib/atlas-world/layers/catalog.v2.json";
import rawCountries from "@/lib/atlas-world/data/countries.v1.json";
import rawGeography from "@/lib/atlas-world/data/geography-pack.v1.json";
import {
  AdminVersionConflictError,
  assertAdminVersion,
  readGithubJson,
  readLocalJson,
  writeGithubJson,
  writeLocalJson,
} from "@/lib/adminVersionedJson";
import { getAtlasBookAssociationSourceRevision } from "@/lib/atlas-world/associations/authority";
import type {
  AtlasJjuAssociationAuthority,
  AtlasJjuAssociationRecord,
  AtlasJjuAssociationReviewState,
} from "@/lib/atlas-world/associations/types";
import { validateAtlasAnnotationReviewAuthority } from "@/lib/atlas-world/annotations/authority";
import type { AtlasAnnotationReviewAuthority } from "@/lib/atlas-world/annotations/types";
import {
  applyAtlasAnnotationDraftMutation,
  validateAtlasAnnotationDraftAuthority,
} from "@/lib/atlas-world/annotations/draftAuthority";
import type {
  AtlasAnnotationDraftAuthority,
  AtlasAnnotationDraftMutation,
  AtlasAnnotationDraftReferenceOptions,
  AtlasAnnotationDraftSnapshot,
} from "@/lib/atlas-world/annotations/draftTypes";
import type { AtlasPatternNote, AtlasPatternNoteSnapshot } from "@/lib/atlas-world/geographyTypes";
import {
  applyAtlasAnnotationDecision,
  applyAtlasAssociationDecision,
  AtlasEditorialValidationError,
  type AtlasAnnotationDecision,
  type AtlasAnnotationReviewSnapshot,
  type AtlasAssociationDecision,
  type AtlasAssociationReviewSnapshot,
  type AtlasEditorialPersistence,
} from "@/lib/atlas-world/editorialReview";

const ANNOTATION_AUTHORITY_REPO_PATH = "lib/atlas-world/annotations/data/review-authority.v1.json";
const ANNOTATION_DRAFT_AUTHORITY_REPO_PATH = "lib/atlas-world/annotations/data/draft-authority.v1.json";
const ASSOCIATION_AUTHORITY_REPO_PATH = "lib/atlas-world/associations/data/authority.v1.json";
const PATTERN_NOTES_REPO_PATH = "lib/atlas-world/data/pattern-notes.v1.json";
const BOOK_CATALOG_REPO_PATH = "private/catalog/books.json";
const MAX_AUTHORITY_BYTES = 1_000_000;

type BookRecord = {
  id?: string | null;
  status?: string | null;
  visibility?: string | null;
  [key: string]: unknown;
};

type CatalogContext = {
  books: BookRecord[];
  byId: Map<string, { book: BookRecord; index: number }>;
};

export class AtlasEditorialPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtlasEditorialPersistenceError";
  }
}

function annotationAuthorityPath() {
  return path.join(process.cwd(), "lib", "atlas-world", "annotations", "data", "review-authority.v1.json");
}

function associationAuthorityPath() {
  return path.join(process.cwd(), "lib", "atlas-world", "associations", "data", "authority.v1.json");
}

function annotationDraftAuthorityPath() {
  return path.join(process.cwd(), "lib", "atlas-world", "annotations", "data", "draft-authority.v1.json");
}

function patternNotesPath() {
  return path.join(process.cwd(), "lib", "atlas-world", "data", "pattern-notes.v1.json");
}

function bookCatalogPath() {
  return path.join(process.cwd(), "private", "catalog", "books.json");
}

async function readAuthority<T>(repoPath: string, filePath: string) {
  const github = await readGithubJson<T>(repoPath);
  if (github) return { value: github.value, version: github.version, source: "github" as const };
  const local = await readLocalJson<T>(filePath);
  return { value: local.value, version: local.version, source: "file" as const };
}

async function readFromSameSource<T>(source: "github" | "file", repoPath: string, filePath: string) {
  if (source === "github") {
    const github = await readGithubJson<T>(repoPath);
    if (!github) throw new AtlasEditorialPersistenceError(`Could not load ${repoPath} from the configured GitHub branch.`);
    return { value: github.value, version: github.version };
  }
  const local = await readLocalJson<T>(filePath);
  return { value: local.value, version: local.version };
}

function patternNotes(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AtlasEditorialValidationError("The Atlas pattern-note snapshot must be an object.");
  }
  const snapshot = value as AtlasPatternNoteSnapshot;
  if (snapshot.schemaVersion !== "1.0.0" || !Array.isArray(snapshot.notes) || !snapshot.snapshotId) {
    throw new AtlasEditorialValidationError("The Atlas pattern-note snapshot is incomplete or unsupported.");
  }
  return snapshot;
}

function catalogContext(value: unknown): CatalogContext {
  const books = (Array.isArray(value) ? value : (value as { books?: unknown })?.books) as BookRecord[];
  if (!Array.isArray(books)) throw new AtlasEditorialValidationError("The JJU book catalog is not an array.");
  const byId = new Map<string, { book: BookRecord; index: number }>();
  books.forEach((book, index) => {
    const id = String(book.id || "").trim().toLowerCase();
    if (!id || byId.has(id)) throw new AtlasEditorialValidationError("The JJU book catalog has a missing or duplicate id.");
    byId.set(id, { book, index });
  });
  return { books, byId };
}

async function loadAnnotationBundle() {
  const authority = await readAuthority<unknown>(ANNOTATION_AUTHORITY_REPO_PATH, annotationAuthorityPath());
  const source = await readFromSameSource<unknown>(authority.source, PATTERN_NOTES_REPO_PATH, patternNotesPath());
  return {
    authority: validateAtlasAnnotationReviewAuthority(authority.value),
    authorityVersion: authority.version,
    source: authority.source,
    sourceVersion: source.version,
    patterns: patternNotes(source.value),
  };
}

async function loadAssociationBundle() {
  const authority = await readAuthority<unknown>(ASSOCIATION_AUTHORITY_REPO_PATH, associationAuthorityPath());
  const source = await readFromSameSource<unknown>(authority.source, BOOK_CATALOG_REPO_PATH, bookCatalogPath());
  return {
    authority: validateAssociationAuthority(authority.value),
    authorityVersion: authority.version,
    source: authority.source,
    sourceVersion: source.version,
    catalog: catalogContext(source.value),
  };
}

function persistenceFor(source: "github" | "file"): AtlasEditorialPersistence {
  const writable = source === "github" || process.env.VERCEL !== "1";
  return {
    source,
    writable,
    boundary: source === "github"
      ? "Decisions save as exact-version GitHub commits. Public changes still require the resulting build."
      : writable
        ? "Decisions save to the local authority file. A build is required before public Atlas behavior changes."
        : "Saving is locked: this deployment has no durable GitHub-backed Atlas review store.",
  };
}

function assertIsoDateTime(value: unknown, label: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new AtlasEditorialValidationError(`${label} must be an ISO date-time.`);
  }
}

function validateAssociationAuthority(value: unknown): AtlasJjuAssociationAuthority {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AtlasEditorialValidationError("The Atlas association authority must be an object.");
  }
  const authority = value as AtlasJjuAssociationAuthority;
  if (authority.schemaVersion !== "1.0.0" || authority.authorityId !== "jju-atlas-geographic-associations") {
    throw new AtlasEditorialValidationError("The Atlas association authority has an unsupported identity or schema.");
  }
  if (authority.policy?.automatedPublication !== false
    || authority.policy?.requireExactEvidence !== true
    || authority.policy?.publicReviewStates?.[0] !== "approved"
    || authority.policy.publicReviewStates.length !== 1) {
    throw new AtlasEditorialValidationError("The Atlas association publication gate is invalid.");
  }
  assertIsoDateTime(authority.updatedAt, "Association authority updatedAt");
  if (!Array.isArray(authority.sources) || !Array.isArray(authority.associations)) {
    throw new AtlasEditorialValidationError("The Atlas association authority is incomplete.");
  }
  const ids = new Set<string>();
  for (const association of authority.associations) {
    if (!association?.id || ids.has(association.id)) throw new AtlasEditorialValidationError("The Atlas association authority has a missing or duplicate id.");
    ids.add(association.id);
    if (!association.subject?.id || !association.subject?.sourceRevision || !association.place?.entityId) {
      throw new AtlasEditorialValidationError(`${association.id} is missing its subject, source revision, or place.`);
    }
    if (!Array.isArray(association.evidence) || !association.evidence.length
      || association.evidence.some((evidence) => !evidence.exactText || !evidence.exactTextSha256 || !evidence.locator)) {
      throw new AtlasEditorialValidationError(`${association.id} has no exact review evidence.`);
    }
    if (!Number.isFinite(association.proposal?.confidence)
      || association.proposal.confidence < 0
      || association.proposal.confidence > 1) {
      throw new AtlasEditorialValidationError(`${association.id} has invalid proposal confidence.`);
    }
    if (!["proposed", "approved", "rejected", "superseded"].includes(association.review?.state)) {
      throw new AtlasEditorialValidationError(`${association.id} has an invalid review state.`);
    }
    const compatibleRelationships: Record<string, string[]> = {
      book: ["primary_subject", "substantial_coverage", "contextual_coverage"],
      series: ["primary_subject", "substantial_coverage", "contextual_coverage"],
      person: ["born_in", "died_in", "lived_in", "active_in", "governed_in"],
      event: ["occurred_in", "began_in", "ended_in", "affected"],
      concept: ["originated_in", "institutionally_centered", "historically_prominent"],
    };
    if (!compatibleRelationships[association.subject.kind]?.includes(association.relationship)) {
      throw new AtlasEditorialValidationError(`${association.id} uses an invalid relationship for a ${association.subject.kind}.`);
    }
    if (association.review.state === "approved") {
      if (association.review.reviewerKind !== "human"
        || !association.review.reviewedBy?.trim()
        || !association.review.reviewedAt
        || !association.review.decisionNote?.trim()) {
        throw new AtlasEditorialValidationError(`${association.id} is marked approved without a complete human decision.`);
      }
      assertIsoDateTime(association.review.reviewedAt, `${association.id} reviewedAt`);
    } else if (association.review.state === "proposed") {
      if (association.review.reviewerKind !== null
        || association.review.reviewedBy !== null
        || association.review.reviewedAt !== null
        || association.review.decisionNote !== null) {
        throw new AtlasEditorialValidationError(`${association.id} is still proposed but claims a review decision.`);
      }
    }
  }
  return authority;
}

function sourceCurrent(association: AtlasJjuAssociationRecord, catalog: CatalogContext) {
  if (association.subject.kind !== "book") return true;
  const entry = catalog.byId.get(association.subject.id.toLowerCase());
  return Boolean(entry && getAtlasBookAssociationSourceRevision(entry.book) === association.subject.sourceRevision);
}

function subjectReadable(association: AtlasJjuAssociationRecord, catalog: CatalogContext) {
  if (association.subject.kind !== "book") return true;
  const entry = catalog.byId.get(association.subject.id.toLowerCase());
  return Boolean(entry
    && String(entry.book.status || "ready").toLowerCase() === "ready"
    && ["main", "archive"].includes(String(entry.book.visibility || "main").toLowerCase()));
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function annotationDraftReferences(): AtlasAnnotationDraftReferenceOptions {
  const catalog = rawLayerCatalog as unknown as {
    schemaVersion: string;
    layers: Array<{ id: string; name: string }>;
    viewPresets: Array<{ id: string; name: string; layerInstances: Array<{ layerId: string }> }>;
  };
  const countries = rawCountries as unknown as {
    snapshotId: string;
    countries: Array<{ id: string; names: { common: string } }>;
  };
  const geography = rawGeography as unknown as {
    snapshotId: string;
    featureCollections: {
      majorRivers: { features: Array<{ featureId: string; name: string }> };
      majorLakes: { features: Array<{ featureId: string; name: string }> };
      majorCities: { features: Array<{ featureId: string; name: string }> };
    };
  };
  const views = catalog.viewPresets.map((view) => ({
    id: view.id,
    name: view.name,
    layerIds: view.layerInstances.map((instance) => instance.layerId),
  }));
  const layers = catalog.layers.map((layer) => ({ id: layer.id, name: layer.name }));
  const entities = countries.countries.map((country) => ({ id: country.id, name: country.names.common }));
  const features = [
    ...geography.featureCollections.majorRivers.features.map((feature) => ({ id: feature.featureId, name: feature.name, kind: "river" as const })),
    ...geography.featureCollections.majorLakes.features.map((feature) => ({ id: feature.featureId, name: feature.name, kind: "lake" as const })),
    ...geography.featureCollections.majorCities.features.map((feature) => ({ id: feature.featureId, name: feature.name, kind: "city" as const })),
  ].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const identity = {
    layerSchemaVersion: catalog.schemaVersion,
    views: views.map((view) => [view.id, view.layerIds]),
    layers: layers.map((layer) => layer.id),
    countrySnapshotId: countries.snapshotId,
    geographySnapshotId: geography.snapshotId,
  };
  return {
    version: sha256(JSON.stringify(identity)),
    views,
    layers,
    entities: entities.sort((left, right) => left.name.localeCompare(right.name)),
    features,
  };
}

function evidenceStatus(association: AtlasJjuAssociationRecord, catalog: CatalogContext) {
  const sourceIds = new Set(association.evidence.map((evidence) => evidence.sourceId));
  let current = association.evidence.every((evidence) => (
    evidence.exactTextSha256 === sha256(evidence.exactText)
    && Boolean(evidence.locator)
    && Boolean(evidence.sourceRevision)
  ));
  if (association.subject.kind === "book") {
    const entry = catalog.byId.get(association.subject.id.toLowerCase());
    if (!entry) current = false;
    for (const evidence of association.evidence) {
      if (evidence.sourceId !== "jju-book-catalog" || !entry) continue;
      const locator = evidence.locator.match(/^\/(\d+)\/(title|description)$/);
      if (!locator
        || Number(locator[1]) !== entry.index
        || !String(entry.book[locator[2]] || "").includes(evidence.exactText)
        || evidence.sourceRevision !== association.subject.sourceRevision) {
        current = false;
      }
    }
  }
  return {
    current,
    supportsRelationship: sourceIds.size > 0
      && association.evidence.some((evidence) => evidence.supports.includes("relationship_semantics")),
  };
}

function annotationVisible(note: AtlasPatternNote, authority: AtlasAnnotationReviewAuthority) {
  const state = authority.records.find((record) => record.noteId === note.id)?.state;
  return note.review.publicationStatus === "atlas-visible"
    && Boolean(state)
    && !["rejected", "retired", "superseded"].includes(state || "");
}

function annotationSnapshot(
  authority: AtlasAnnotationReviewAuthority,
  patterns: AtlasPatternNoteSnapshot,
  version: string,
  sourceVersion: string,
  source: "github" | "file",
): AtlasAnnotationReviewSnapshot {
  const patternById = new Map(patterns.notes.map((note) => [note.id, note]));
  const missingReviewIds = patterns.notes.filter((note) => !authority.records.some((record) => record.noteId === note.id)).map((note) => note.id);
  if (missingReviewIds.length) {
    throw new AtlasEditorialValidationError(`Pattern notes are missing editorial review records: ${missingReviewIds.join(", ")}.`);
  }
  const items = authority.records.map((review) => {
    const note = patternById.get(review.noteId);
    if (!note) throw new AtlasEditorialValidationError(`Review record ${review.noteId} has no matching annotation.`);
    return {
      note,
      review,
      stale: note.revision !== review.noteRevision,
      visibleNow: annotationVisible(note, authority),
    };
  });
  const counts = Object.fromEntries(["proposed", "approved", "rejected", "retired", "superseded"].map((state) => [
    state,
    items.filter((item) => item.review.state === state).length,
  ])) as AtlasAnnotationReviewSnapshot["counts"];
  return {
    authorityRevision: authority.revision,
    updatedAt: authority.updatedAt,
    items,
    counts,
    sourceReviewedVisible: items.filter((item) => item.visibleNow).length,
    humanApproved: counts.approved,
    stale: items.filter((item) => item.stale).length,
    persistence: persistenceFor(source),
    sourceVersion,
    version,
  };
}

function annotationDraftSnapshot(
  authority: AtlasAnnotationDraftAuthority,
  version: string,
  source: "github" | "file",
  references: AtlasAnnotationDraftReferenceOptions,
): AtlasAnnotationDraftSnapshot {
  const states = ["draft", "proposed", "approved", "rejected", "retired"] as const;
  const counts = Object.fromEntries(states.map((state) => [
    state,
    authority.drafts.filter((draft) => draft.state === state).length,
  ])) as AtlasAnnotationDraftSnapshot["counts"];
  return {
    authorityRevision: authority.revision,
    updatedAt: authority.updatedAt,
    drafts: authority.drafts.map((draft) => ({ draft, stale: draft.referenceVersion !== references.version })),
    counts,
    references,
    persistence: persistenceFor(source),
    version,
  };
}

function associationSnapshot(
  authority: AtlasJjuAssociationAuthority,
  catalog: CatalogContext,
  version: string,
  sourceVersion: string,
  source: "github" | "file",
): AtlasAssociationReviewSnapshot {
  const items = authority.associations.map((association) => {
    const current = sourceCurrent(association, catalog);
    const readable = subjectReadable(association, catalog);
    const evidence = evidenceStatus(association, catalog);
    return {
      association,
      sourceCurrent: current,
      evidenceCurrent: evidence.current,
      evidenceSupportsRelationship: evidence.supportsRelationship,
      subjectReadable: readable,
      publicEligible: association.review.state === "approved"
        && association.review.reviewerKind === "human"
        && Boolean(association.review.reviewedAt && association.review.reviewedBy)
        && current
        && evidence.current
        && evidence.supportsRelationship
        && readable,
    };
  });
  const states: AtlasJjuAssociationReviewState[] = ["proposed", "approved", "rejected", "superseded"];
  const counts = Object.fromEntries(states.map((state) => [state, items.filter((item) => item.association.review.state === state).length])) as AtlasAssociationReviewSnapshot["counts"];
  return {
    authorityRevision: authority.revision,
    updatedAt: authority.updatedAt,
    items,
    counts,
    publicEligible: items.filter((item) => item.publicEligible).length,
    stale: items.filter((item) => !item.sourceCurrent).length,
    persistence: persistenceFor(source),
    sourceVersion,
    version,
  };
}

export async function readAtlasAnnotationReviewSnapshot() {
  const loaded = await loadAnnotationBundle();
  return annotationSnapshot(loaded.authority, loaded.patterns, loaded.authorityVersion, loaded.sourceVersion, loaded.source);
}

export async function readAtlasAnnotationDraftSnapshot() {
  const references = annotationDraftReferences();
  const loaded = await readAuthority<unknown>(ANNOTATION_DRAFT_AUTHORITY_REPO_PATH, annotationDraftAuthorityPath());
  const authority = validateAtlasAnnotationDraftAuthority(loaded.value, references);
  return annotationDraftSnapshot(authority, loaded.version, loaded.source, references);
}

export async function readAtlasAssociationReviewSnapshot() {
  const loaded = await loadAssociationBundle();
  return associationSnapshot(loaded.authority, loaded.catalog, loaded.authorityVersion, loaded.sourceVersion, loaded.source);
}

async function persistAuthority(
  repoPath: string,
  filePath: string,
  authority: unknown,
  expectedVersion: string,
  message: string,
) {
  const content = `${JSON.stringify(authority, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_AUTHORITY_BYTES) {
    throw new AtlasEditorialValidationError("The Atlas review authority is too large to save safely.");
  }
  const github = await writeGithubJson(repoPath, content, message, expectedVersion);
  if (github) {
    try {
      await writeFile(filePath, content, "utf8");
    } catch {
      // GitHub is canonical on a deployed save; its filesystem can be read-only.
    }
    return { version: github.version, target: "github" as const };
  }
  if (process.env.VERCEL === "1") {
    throw new AtlasEditorialPersistenceError("Atlas review saving is locked because durable GitHub persistence is not configured.");
  }
  const local = await writeLocalJson(filePath, content, expectedVersion);
  return { version: local.version, target: "local" as const };
}

export async function saveAtlasAnnotationDecision(decision: AtlasAnnotationDecision, expectedVersion: string) {
  const loaded = await loadAnnotationBundle();
  assertAdminVersion(expectedVersion, loaded.authorityVersion);
  assertAdminVersion(decision.sourceVersion, loaded.sourceVersion);
  const patternById = new Map(loaded.patterns.notes.map((note) => [note.id, note]));
  const currentNote = patternById.get(decision.noteId);
  if (!currentNote) throw new AtlasEditorialValidationError("That annotation no longer exists in the source snapshot.");
  if (decision.currentNoteRevision !== currentNote.revision) {
    throw new AdminVersionConflictError("This explanation changed after it was loaded. Reload it before saving a decision.");
  }
  const authority = validateAtlasAnnotationReviewAuthority(applyAtlasAnnotationDecision(loaded.authority, decision));
  const saved = await persistAuthority(
    ANNOTATION_AUTHORITY_REPO_PATH,
    annotationAuthorityPath(),
    authority,
    loaded.authorityVersion,
    `Review Atlas annotation: ${currentNote.headline}`,
  );
  revalidatePath("/atlas");
  revalidatePath("/admin/atlas");
  return {
    snapshot: annotationSnapshot(authority, loaded.patterns, saved.version, loaded.sourceVersion, saved.target === "github" ? "github" : "file"),
    target: saved.target,
    note: saved.target === "github"
      ? "Saved the reviewed annotation authority to GitHub. Public Atlas changes with the resulting build."
      : "Saved the reviewed annotation authority locally. Rebuild before treating public Atlas as updated.",
  };
}

export async function saveAtlasAssociationDecision(decision: AtlasAssociationDecision, expectedVersion: string) {
  const loaded = await loadAssociationBundle();
  assertAdminVersion(expectedVersion, loaded.authorityVersion);
  assertAdminVersion(decision.sourceVersion, loaded.sourceVersion);
  const currentAssociation = loaded.authority.associations.find((association) => association.id === decision.associationId);
  if (!currentAssociation) throw new AtlasEditorialValidationError("That association no longer exists in the authority.");
  const evidence = evidenceStatus(currentAssociation, loaded.catalog);
  const authority = validateAssociationAuthority(applyAtlasAssociationDecision(loaded.authority, {
    ...decision,
    sourceCurrent: sourceCurrent(currentAssociation, loaded.catalog),
    evidenceCurrent: evidence.current,
    evidenceSupportsRelationship: evidence.supportsRelationship,
  }));
  const saved = await persistAuthority(
    ASSOCIATION_AUTHORITY_REPO_PATH,
    associationAuthorityPath(),
    authority,
    loaded.authorityVersion,
    `Review Atlas link: ${currentAssociation.subject.title} — ${currentAssociation.place.name}`,
  );
  revalidatePath("/atlas");
  revalidatePath("/admin/atlas");
  return {
    snapshot: associationSnapshot(authority, loaded.catalog, saved.version, loaded.sourceVersion, saved.target === "github" ? "github" : "file"),
    target: saved.target,
    note: saved.target === "github"
      ? "Saved the reviewed association authority to GitHub. Only explicit human approvals can become public in the resulting build."
      : "Saved the reviewed association authority locally. Rebuild before approved links can appear in public Atlas.",
  };
}

function draftIdFor(headline: string) {
  const slug = String(headline || "annotation")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 54) || "annotation";
  return `annotation-draft:${slug}:${randomUUID().slice(0, 8)}`;
}

export async function saveAtlasAnnotationDraftMutation(mutation: AtlasAnnotationDraftMutation, expectedVersion: string) {
  const references = annotationDraftReferences();
  assertAdminVersion(mutation.sourceVersion, references.version);
  const loaded = await readAuthority<unknown>(ANNOTATION_DRAFT_AUTHORITY_REPO_PATH, annotationDraftAuthorityPath());
  assertAdminVersion(expectedVersion, loaded.version);
  const current = validateAtlasAnnotationDraftAuthority(loaded.value, references);
  const now = new Date().toISOString();
  const authority = applyAtlasAnnotationDraftMutation(current, mutation, references, {
    now,
    newDraftId: mutation.operation === "create" ? draftIdFor(mutation.content?.headline || "annotation") : undefined,
  });
  const saved = await persistAuthority(
    ANNOTATION_DRAFT_AUTHORITY_REPO_PATH,
    annotationDraftAuthorityPath(),
    authority,
    loaded.version,
    mutation.operation === "transition"
      ? `Review Atlas annotation draft: ${mutation.draftId || "unknown"}`
      : `${mutation.operation === "create" ? "Create" : "Revise"} Atlas annotation draft: ${mutation.content?.headline || mutation.draftId || "unknown"}`,
  );
  // Draft approval is deliberately not a public Atlas invalidation or write.
  revalidatePath("/admin/atlas");
  return {
    snapshot: annotationDraftSnapshot(authority, saved.version, saved.target === "github" ? "github" : "file", references),
    target: saved.target,
    note: saved.target === "github"
      ? "Saved the annotation draft authority to GitHub. Even approved drafts remain outside public pattern-notes until a separate promotion is reviewed and built."
      : "Saved the annotation draft authority locally. Approval still does not publish or alter public pattern-notes.",
  };
}

export { AdminVersionConflictError };
