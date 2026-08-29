import "server-only";

import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { readAdminBookCatalog } from "@/lib/adminBookCatalog";
import {
  AdminVersionConflictError,
  assertAdminVersion,
  readGithubJson,
  readLocalJson,
  versionForContent,
  writeGithubJson,
} from "@/lib/adminVersionedJson";
import { SITE_V2_APPROVED_TOPICS } from "@/lib/siteV2Taxonomy";

export const TOPIC_AUTHORITY_SCHEMA_VERSION = 1;
export const TOPIC_AUTHORITY_REPO_PATH = "private/catalog/topic-authority.json";

const MAX_AUTHORITY_BYTES = 1_000_000;
const MAX_BOOKS = 2_000;
const APPROVED_TOPIC_SET = new Set<string>(SITE_V2_APPROVED_TOPICS);
const DOCUMENT_KEYS = new Set(["schemaVersion", "revision", "updatedAt", "topicsByBook"]);

export type TopicAuthorityDocument = {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  topicsByBook: Record<string, string[]>;
};

export type TopicAuthorityDiagnostics = {
  valid: boolean;
  schemaVersion: number;
  catalogBookCount: number;
  authorityBookCount: number;
  assignedBookCount: number;
  unassignedBookCount: number;
  overlapBookCount: number;
  totalAssignments: number;
  approvedTopicCount: number;
  usedTopicCount: number;
  unusedTopics: string[];
  booksWithoutTopics: string[];
  missingBookIds: string[];
  unknownBookIds: string[];
  topicCounts: Array<{ topic: string; count: number }>;
};

export type TopicAuthoritySnapshot = {
  authority: TopicAuthorityDocument;
  approvedTopics: string[];
  books: Array<{
    id: string;
    title: string;
    status: string;
    visibility: string;
    topics: string[];
    hasAuthorityEntry: boolean;
  }>;
  diagnostics: TopicAuthorityDiagnostics;
  source: "github" | "file";
  catalogSource: "supabase" | "github" | "file";
  version: string;
  writable: boolean;
  persistenceBoundary: string;
};

export class TopicAuthorityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopicAuthorityValidationError";
  }
}

export class TopicAuthorityPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopicAuthorityPersistenceError";
  }
}

function localAuthorityPath() {
  return path.join(process.cwd(), "private", "catalog", "topic-authority.json");
}

function objectRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TopicAuthorityValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function catalogBooks(value: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  return value.map((book, index) => {
    const id = String(book.id || "").trim().toLowerCase();
    if (!id || !/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
      throw new TopicAuthorityValidationError(`Catalog book ${index + 1} has an invalid id.`);
    }
    if (seen.has(id)) throw new TopicAuthorityValidationError(`The catalog contains duplicate book id ${id}.`);
    seen.add(id);
    return {
      id,
      title: String(book.title || id).trim() || id,
      status: String(book.status || "").trim().toLowerCase(),
      visibility: String(book.visibility || "").trim().toLowerCase(),
    };
  });
}

function canonicalizeTopicAuthority(
  value: unknown,
  validBookIds: ReadonlySet<string>,
  mode: "source" | "submission",
): TopicAuthorityDocument {
  const record = objectRecord(value, "Topic authority");
  const unknownDocumentKeys = Object.keys(record).filter(key => !DOCUMENT_KEYS.has(key));
  if (unknownDocumentKeys.length) {
    throw new TopicAuthorityValidationError(`Topic authority contains unknown fields: ${unknownDocumentKeys.join(", ")}.`);
  }
  if (record.schemaVersion !== TOPIC_AUTHORITY_SCHEMA_VERSION) {
    throw new TopicAuthorityValidationError(`Topic authority schema must be ${TOPIC_AUTHORITY_SCHEMA_VERSION}.`);
  }
  if (!Number.isSafeInteger(record.revision) || Number(record.revision) < 1) {
    throw new TopicAuthorityValidationError("Topic authority revision must be a positive integer.");
  }
  if (typeof record.updatedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(record.updatedAt)
    || !Number.isFinite(Date.parse(record.updatedAt))) {
    throw new TopicAuthorityValidationError("Topic authority updatedAt must be an ISO date-time.");
  }

  const rawTopicsByBook = objectRecord(record.topicsByBook, "topicsByBook");
  const entries = Object.entries(rawTopicsByBook);
  if (!entries.length || entries.length > MAX_BOOKS) {
    throw new TopicAuthorityValidationError(`Topic authority has an unsafe book count (${entries.length}).`);
  }

  const topicsByBook: Record<string, string[]> = {};
  for (const [rawBookId, rawTopics] of entries) {
    const bookId = rawBookId.trim().toLowerCase();
    if (!bookId || !/^[a-z0-9][a-z0-9_-]*$/.test(bookId)) {
      throw new TopicAuthorityValidationError(`Topic authority contains invalid book id ${rawBookId}.`);
    }
    if (mode === "source" && rawBookId !== bookId) {
      throw new TopicAuthorityValidationError(`Topic authority book id ${rawBookId} is not canonical.`);
    }
    if (Object.hasOwn(topicsByBook, bookId)) {
      throw new TopicAuthorityValidationError(`Topic authority contains duplicate canonical book id ${bookId}.`);
    }
    if (mode === "submission" && !validBookIds.has(bookId)) {
      throw new TopicAuthorityValidationError(`Topic authority references unknown catalog book ${bookId}.`);
    }
    if (!Array.isArray(rawTopics) || rawTopics.length > SITE_V2_APPROVED_TOPICS.length) {
      throw new TopicAuthorityValidationError(`Topic authority entry for ${bookId} must be a safe Topic array.`);
    }

    const topics = rawTopics.map((topic, index) => {
      if (typeof topic !== "string") {
        throw new TopicAuthorityValidationError(`Topic ${index + 1} for ${bookId} is not text.`);
      }
      const clean = topic.trim();
      if (!APPROVED_TOPIC_SET.has(clean)) {
        throw new TopicAuthorityValidationError(`Topic authority entry for ${bookId} contains unapproved Topic ${clean || "(blank)"}.`);
      }
      if (mode === "source" && clean !== topic) {
        throw new TopicAuthorityValidationError(`Topic authority entry for ${bookId} contains non-canonical whitespace.`);
      }
      return clean;
    });
    if (mode === "source" && new Set(topics).size !== topics.length) {
      throw new TopicAuthorityValidationError(`Topic authority entry for ${bookId} contains duplicate Topics.`);
    }
    topicsByBook[bookId] = [...new Set(topics)].sort((left, right) => left.localeCompare(right));
  }

  const missingBookIds = mode === "submission"
    ? [...validBookIds].filter(id => !Object.hasOwn(topicsByBook, id)).sort()
    : [];
  if (mode === "submission" && missingBookIds.length) {
    throw new TopicAuthorityValidationError(
      `Topic authority is incomplete: ${missingBookIds.length} catalog book${missingBookIds.length === 1 ? " is" : "s are"} missing (${missingBookIds.slice(0, 8).join(", ")}).`,
    );
  }

  return {
    schemaVersion: TOPIC_AUTHORITY_SCHEMA_VERSION,
    revision: Number(record.revision),
    updatedAt: new Date(record.updatedAt).toISOString(),
    topicsByBook: Object.fromEntries(Object.entries(topicsByBook).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function buildDiagnostics(
  authority: TopicAuthorityDocument,
  validBookIds: ReadonlySet<string>,
): TopicAuthorityDiagnostics {
  const authorityBookIds = Object.keys(authority.topicsByBook);
  const missingBookIds = [...validBookIds]
    .filter(id => !Object.hasOwn(authority.topicsByBook, id))
    .sort();
  const unknownBookIds = authorityBookIds
    .filter(id => !validBookIds.has(id))
    .sort();
  const entries = [...validBookIds]
    .sort()
    .map(id => [id, authority.topicsByBook[id] || []] as const);
  const topicCounts = SITE_V2_APPROVED_TOPICS.map(topic => ({
    topic,
    count: entries.reduce((total, [, topics]) => total + (topics.includes(topic) ? 1 : 0), 0),
  }));
  const booksWithoutTopics = entries.filter(([, topics]) => topics.length === 0).map(([id]) => id).sort();

  return {
    valid: missingBookIds.length === 0 && unknownBookIds.length === 0,
    schemaVersion: authority.schemaVersion,
    catalogBookCount: validBookIds.size,
    authorityBookCount: authorityBookIds.length,
    assignedBookCount: entries.length - booksWithoutTopics.length,
    unassignedBookCount: booksWithoutTopics.length,
    overlapBookCount: entries.filter(([, topics]) => topics.length > 1).length,
    totalAssignments: entries.reduce((total, [, topics]) => total + topics.length, 0),
    approvedTopicCount: SITE_V2_APPROVED_TOPICS.length,
    usedTopicCount: topicCounts.filter(item => item.count > 0).length,
    unusedTopics: topicCounts.filter(item => item.count === 0).map(item => item.topic),
    booksWithoutTopics,
    missingBookIds,
    unknownBookIds,
    topicCounts: topicCounts.sort((left, right) => right.count - left.count || left.topic.localeCompare(right.topic)),
  };
}

async function loadTopicAuthoritySnapshot(): Promise<TopicAuthoritySnapshot> {
  const catalog = await readAdminBookCatalog();
  const books = catalogBooks(catalog.books);
  const validBookIds = new Set(books.map(book => book.id));
  const github = await readGithubJson<unknown>(TOPIC_AUTHORITY_REPO_PATH);
  const local = github ? null : await readLocalJson<unknown>(localAuthorityPath());
  const sourceValue = github?.value ?? local?.value;
  const authority = canonicalizeTopicAuthority(sourceValue, validBookIds, "source");
  const source = github ? "github" as const : "file" as const;
  const version = github?.version || local?.version;
  if (!version) throw new Error("Topic authority returned no exact source version.");
  const writable = source === "github" || process.env.VERCEL !== "1";
  const diagnostics = buildDiagnostics(authority, validBookIds);

  return {
    authority,
    approvedTopics: [...SITE_V2_APPROVED_TOPICS],
    books: books
      .map(book => ({
        ...book,
        topics: [...(authority.topicsByBook[book.id] || [])],
        hasAuthorityEntry: Object.hasOwn(authority.topicsByBook, book.id),
      }))
      .sort((left, right) => left.title.localeCompare(right.title, "en", { numeric: true, sensitivity: "base" })),
    diagnostics,
    source,
    catalogSource: catalog.source,
    version,
    writable,
    persistenceBoundary: source === "github"
      ? "Topic assignments save through GitHub exact-version commits. Supabase Topic CAS is not configured."
      : writable
        ? "Topic assignments save to the local authority file. Supabase Topic CAS is not configured."
        : "Topic saving is locked: this deployment has neither GitHub persistence nor a Supabase Topic CAS store.",
  };
}

export async function readTopicAuthoritySnapshot() {
  return loadTopicAuthoritySnapshot();
}

const localWriteQueues = new Map<string, Promise<void>>();

async function atomicReplace(filePath: string, content: string) {
  const pendingPath = `${filePath}.pending-${process.pid}-${randomUUID()}`;
  await writeFile(pendingPath, content, { encoding: "utf8", flag: "wx" });
  try {
    const written = await readFile(pendingPath, "utf8");
    JSON.parse(written);
    await rename(pendingPath, filePath);
  } finally {
    await unlink(pendingPath).catch(() => {});
  }
}

async function writeLocalAuthority(content: string, expectedVersion: string) {
  const filePath = localAuthorityPath();
  const previous = localWriteQueues.get(filePath) || Promise.resolve();
  let release = () => {};
  const turn = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.catch(() => {}).then(() => turn);
  localWriteQueues.set(filePath, queued);
  await previous.catch(() => {});

  try {
    const current = await readFile(filePath, "utf8");
    assertAdminVersion(expectedVersion, versionForContent(current));
    await atomicReplace(filePath, content);
    return { version: versionForContent(content) };
  } finally {
    release();
    if (localWriteQueues.get(filePath) === queued) localWriteQueues.delete(filePath);
  }
}

export async function saveTopicAuthority(
  value: unknown,
  expectedVersion: string,
  message: string,
) {
  const current = await loadTopicAuthoritySnapshot();
  assertAdminVersion(expectedVersion, current.version);
  const validBookIds = new Set(current.books.map(book => book.id));
  const submitted = canonicalizeTopicAuthority(value, validBookIds, "submission");
  if (submitted.revision !== current.authority.revision) {
    throw new AdminVersionConflictError("This Topic draft has an old document revision. Reload before saving.");
  }

  const authority = canonicalizeTopicAuthority({
    ...submitted,
    revision: current.authority.revision + 1,
    updatedAt: new Date().toISOString(),
  }, validBookIds, "source");
  const content = `${JSON.stringify(authority, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_AUTHORITY_BYTES) {
    throw new TopicAuthorityValidationError("The canonical Topic authority is too large to save safely.");
  }

  const github = await writeGithubJson(TOPIC_AUTHORITY_REPO_PATH, content, message, expectedVersion);
  if (github) {
    try {
      await atomicReplace(localAuthorityPath(), content);
    } catch {
      // GitHub is canonical on a deployed save; the deployment filesystem may be read-only.
    }
    return {
      authority,
      diagnostics: buildDiagnostics(authority, validBookIds),
      target: "github" as const,
      version: github.version,
      note: "Saved the Topic authority to GitHub. The public bundle updates with the resulting deployment.",
    };
  }

  if (process.env.VERCEL === "1") {
    throw new TopicAuthorityPersistenceError(
      "Topic saving is locked because no durable GitHub or Supabase Topic CAS persistence is configured.",
    );
  }
  const local = await writeLocalAuthority(content, expectedVersion);
  return {
    authority,
    diagnostics: buildDiagnostics(authority, validBookIds),
    target: "local" as const,
    version: local.version,
    note: "Saved the Topic authority locally. Rebuild before treating the public bundle as updated; Supabase Topic CAS is not configured.",
  };
}

export function revalidateTopicAuthority() {
  revalidatePath("/");
  revalidatePath("/books");
  revalidatePath("/books/index");
  revalidatePath("/books/[slug]", "page");
  revalidatePath("/site-v2/books/[slug]", "page");
  revalidatePath("/admin/topics");
  revalidatePath("/admin/organize");
  revalidatePath("/sitemap.xml");
}
