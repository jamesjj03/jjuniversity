import "server-only";

import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  TAXONOMY_REVIEW_SCHEMA_VERSION,
  canonicalizeTaxonomyReviewDraft,
  type TaxonomyReviewDraft,
  type TaxonomyReviewGroup,
} from "@/lib/taxonomyReviewTypes";

const REVIEW_DIRECTORY = path.join(process.cwd(), "tmp", "taxonomy-review");
const BACKUP_DIRECTORY = path.join(REVIEW_DIRECTORY, "backups");
const DRAFT_FILE = path.join(REVIEW_DIRECTORY, "draft.json");
const MAX_GROUPS_PER_MODE = 250;
const MAX_ASSIGNMENTS = 10_000;

type PersistedDraft = {
  savedAt: string;
  draft: TaxonomyReviewDraft;
};

export type TaxonomyReviewLoadResult = {
  draft: TaxonomyReviewDraft;
  savedAt: string | null;
  catalogChanged: boolean;
};

export async function readTaxonomyReviewDraft(
  fallback: TaxonomyReviewDraft,
  validBookIds: ReadonlySet<string>,
): Promise<TaxonomyReviewLoadResult> {
  try {
    const parsed = JSON.parse(await readFile(DRAFT_FILE, "utf8")) as PersistedDraft;
    const migrated = migrateLegacyDraft(parsed?.draft, fallback);
    const validated = validateDraft(migrated, fallback.catalogFingerprint, validBookIds, false);
    return {
      draft: validated,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
      catalogChanged: parsed?.draft?.catalogFingerprint !== fallback.catalogFingerprint,
    };
  } catch (error) {
    if (isMissingFile(error)) return { draft: fallback, savedAt: null, catalogChanged: false };
    console.error("Could not load taxonomy review draft", error);
    return { draft: fallback, savedAt: null, catalogChanged: false };
  }
}

export async function saveTaxonomyReviewDraft(
  input: unknown,
  expectedFingerprint: string,
  validBookIds: ReadonlySet<string>,
) {
  const draft = validateDraft(input, expectedFingerprint, validBookIds, true);
  const savedAt = new Date().toISOString();
  const envelope: PersistedDraft = { savedAt, draft };
  const serialized = `${JSON.stringify(envelope, null, 2)}\n`;

  await mkdir(BACKUP_DIRECTORY, { recursive: true });
  try {
    const backupName = `draft-${savedAt.replace(/[:.]/g, "-")}.json`;
    await copyFile(DRAFT_FILE, path.join(BACKUP_DIRECTORY, backupName));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const stagedFile = path.join(REVIEW_DIRECTORY, `draft-${process.pid}-${Date.now()}.tmp`);
  await writeFile(stagedFile, serialized, { encoding: "utf8", flag: "wx" });
  try {
    await rename(stagedFile, DRAFT_FILE);
  } catch (error) {
    if (!isDestinationExists(error)) throw error;
    await copyFile(stagedFile, DRAFT_FILE);
    await unlink(stagedFile);
  }

  return { draft, savedAt };
}

function validateDraft(
  input: unknown,
  expectedFingerprint: string,
  validBookIds: ReadonlySet<string>,
  rejectCatalogMismatch: boolean,
) {
  if (!input || typeof input !== "object") throw new TaxonomyReviewValidationError("Draft data is missing.");
  const candidate = input as Partial<TaxonomyReviewDraft>;
  if (candidate.schemaVersion !== TAXONOMY_REVIEW_SCHEMA_VERSION) {
    throw new TaxonomyReviewValidationError("This draft uses an unsupported schema version.");
  }
  if (rejectCatalogMismatch && candidate.catalogFingerprint !== expectedFingerprint) {
    throw new TaxonomyReviewConflictError("The book catalog changed while this desk was open. Reload before saving.");
  }
  if (!Array.isArray(candidate.collections) || !Array.isArray(candidate.shelves) || !Array.isArray(candidate.topics) || !Array.isArray(candidate.reviewBookIds)) {
    throw new TaxonomyReviewValidationError("The draft is missing collections, shelves, topics, or review state.");
  }
  if (candidate.collections.length > MAX_GROUPS_PER_MODE || candidate.shelves.length > MAX_GROUPS_PER_MODE || candidate.topics.length > MAX_GROUPS_PER_MODE) {
    throw new TaxonomyReviewValidationError("The draft contains too many groups.");
  }

  const draft = canonicalizeTaxonomyReviewDraft({
    schemaVersion: TAXONOMY_REVIEW_SCHEMA_VERSION,
    catalogFingerprint: expectedFingerprint,
    collections: validateGroups(candidate.collections, validBookIds),
    shelves: validateGroups(candidate.shelves, validBookIds),
    topics: validateGroups(candidate.topics, validBookIds),
    reviewBookIds: candidate.reviewBookIds.filter(id => typeof id === "string" && validBookIds.has(id)),
  });

  const assignmentCount = [...draft.collections, ...draft.shelves, ...draft.topics]
    .reduce((total, group) => total + group.bookIds.length, 0);
  if (assignmentCount > MAX_ASSIGNMENTS) throw new TaxonomyReviewValidationError("The taxonomy draft is too large.");
  return draft;
}

function validateGroups(value: unknown[], validBookIds: ReadonlySet<string>): TaxonomyReviewGroup[] {
  return value.map(group => {
    if (!group || typeof group !== "object") throw new TaxonomyReviewValidationError("A group is malformed.");
    const item = group as Partial<TaxonomyReviewGroup>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!id || id.length > 100 || !name || name.length > 100) {
      throw new TaxonomyReviewValidationError("Every group needs a short ID and name.");
    }
    if (!Array.isArray(item.bookIds)) throw new TaxonomyReviewValidationError(`${name} has invalid book assignments.`);
    return {
      id,
      name,
      ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.trim().slice(0, 1_000) } : {}),
      ...(["series", "paths", "new"].includes(String(item.sourceBucket)) ? { sourceBucket: item.sourceBucket } : {}),
      bookIds: item.bookIds.filter(bookId => typeof bookId === "string" && validBookIds.has(bookId)),
    };
  });
}

function migrateLegacyDraft(input: unknown, fallback: TaxonomyReviewDraft): unknown {
  if (!input || typeof input !== "object") return input;
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) return input;
  return {
    ...candidate,
    schemaVersion: TAXONOMY_REVIEW_SCHEMA_VERSION,
    collections: fallback.collections,
  };
}

function isMissingFile(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isDestinationExists(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && ["EEXIST", "EPERM", "EACCES"].includes(String(error.code)));
}

export class TaxonomyReviewValidationError extends Error {}
export class TaxonomyReviewConflictError extends Error {}
