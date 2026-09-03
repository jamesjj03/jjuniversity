import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
const ROOT = process.cwd();
const EXPECTED_PROJECT_REF = "nzlmnbppynjmutuukmbt";
const BOOK_ID = "isrpal";
const BOOK_SLUG = "a-land-divided";
const AGENCY_ID = "agency";
const CATALOG_TARGET_IDS = new Set([BOOK_ID, AGENCY_ID]);
const CONTENT_FILE = "isrpal.json";
const CONTENT_PATH = "private/book-content/isrpal.json";
const CATALOG_PATH = path.join(ROOT, "private", "catalog", "books.json");
const CONTENT_MANIFEST_PATH = path.join(ROOT, "private", "book-content", "manifest.json");
const BOOK_CONTENT_PATH = path.join(ROOT, "private", "book-content", CONTENT_FILE);
const SOURCE_RECEIPT_PATH = path.join(ROOT, "private", "source-receipts", `${BOOK_ID}.json`);
const TOPIC_AUTHORITY_PATH = path.join(ROOT, "private", "catalog", "topic-authority.json");

const CATALOG_FIELDS = [
  "id",
  "slug",
  "title",
  "subtitle",
  "creator",
  "description",
  "status",
  "visibility",
  "archive_category",
  "primary_category",
  "cover_file",
  "book_file",
  "content_key",
  "word_count",
  "reading_minutes",
  "reading_label",
  "chapter_count",
  "tags",
  "slug_aliases",
  "metadata",
];
const CATALOG_SELECT = CATALOG_FIELDS.join(",");
const CONTENT_SELECT = "book_id,version_number,content_file,content_path,content,updated_at";

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeId(value) {
  return text(value).replace(/\.(json|epub)$/i, "").toLowerCase();
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u02bc]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function semanticHash(value) {
  return sha256(stableJson(value));
}

function arraysEqualAsTextSets(left, right) {
  const normalize = values => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  return stableJson(normalize(left)) === stableJson(normalize(right));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function exactOne(values, label) {
  if (values.length !== 1) fail(`Expected exactly one ${label}; found ${values.length}.`);
  return values[0];
}

function projectRef(url) {
  try {
    return new URL(url).hostname.toLowerCase().split(".")[0] || "";
  } catch {
    return "";
  }
}

function assertResult(result, label) {
  if (result.error) fail(`${label}: ${result.error.message}`);
  return result.data || [];
}

async function fetchAllRows(supabase, table, columns, orderColumn) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const result = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(start, start + 999);
    const page = assertResult(result, `Could not read ${table}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function catalogRowFromLocal(book) {
  const id = normalizeId(book?.id);
  const title = text(book?.title || id || "Untitled");
  const tags = Array.isArray(book?.tags) ? book.tags.map(String).filter(Boolean) : [];
  const visibility = book?.archive || text(book?.visibility || "main").toLowerCase() === "archive"
    ? "archive"
    : "main";
  const slug = slugify(book?.slug || title || id);
  const slugAliases = [
    id,
    slugify(book?.title || ""),
    ...(Array.isArray(book?.slugAliases) ? book.slugAliases.map(alias => slugify(String(alias))) : []),
  ].filter(alias => alias && alias !== slug);

  return {
    id,
    slug,
    title,
    subtitle: text(book?.subtitle),
    creator: text(book?.creator || book?.author || "James Johnson"),
    description: text(book?.description),
    status: text(book?.status || "ready").toLowerCase(),
    visibility,
    archive_category: text(book?.archiveCategory || book?.category),
    primary_category: text(book?.primaryCategory || book?.category || "Library") || "Library",
    cover_file: text(book?.coverFile),
    book_file: text(book?.bookFile),
    content_key: text(book?.contentKey),
    word_count: Number(book?.wordCount || 0),
    reading_minutes: Number(book?.readingMinutes || 0),
    reading_label: text(book?.readingLabel),
    chapter_count: Number(book?.chapterCount || 0),
    tags,
    slug_aliases: [...new Set(slugAliases)],
    metadata: {
      series: text(book?.series),
      similar: Array.isArray(book?.similar) ? book.similar.map(item => text(item).toLowerCase()).filter(Boolean) : [],
      hiddenShelves: Array.isArray(book?.hiddenShelves) ? book.hiddenShelves.map(String).filter(Boolean) : [],
      hiddenCategories: Array.isArray(book?.hiddenCategories) ? book.hiddenCategories.map(String).filter(Boolean) : [],
    },
  };
}

function catalogValue(row) {
  return Object.fromEntries(CATALOG_FIELDS.map(field => [field, row?.[field]]));
}

function normalizedAliases(values) {
  const seen = new Set();
  const aliases = [];
  for (const value of Array.isArray(values) ? values : []) {
    const alias = text(value).toLowerCase();
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    aliases.push(alias);
  }
  return aliases;
}

// This mirrors the normalization performed inside jju_admin_save_book_catalog.
// Every unrelated row must already round-trip through the RPC without a value change.
function rowAfterCatalogRpc(row) {
  const integer = value => Number(value || 0);
  const nonblank = (value, fallback) => text(value) || fallback;
  return {
    id: normalizeId(row?.id),
    slug: text(row?.slug),
    title: text(row?.title),
    subtitle: row?.subtitle == null ? "" : String(row.subtitle),
    creator: nonblank(row?.creator, "James Johnson"),
    description: row?.description == null ? "" : String(row.description),
    status: nonblank(row?.status, "ready"),
    visibility: nonblank(row?.visibility, "main"),
    archive_category: row?.archive_category == null ? "" : String(row.archive_category),
    primary_category: nonblank(row?.primary_category, "Library"),
    cover_file: row?.cover_file == null ? "" : String(row.cover_file),
    book_file: row?.book_file == null ? "" : String(row.book_file),
    content_key: row?.content_key == null ? "" : String(row.content_key),
    word_count: integer(row?.word_count),
    reading_minutes: integer(row?.reading_minutes),
    reading_label: row?.reading_label == null ? "" : String(row.reading_label),
    chapter_count: integer(row?.chapter_count),
    tags: Array.isArray(row?.tags) ? row.tags.map(String) : [],
    slug_aliases: normalizedAliases(row?.slug_aliases),
    metadata: row?.metadata == null ? {} : row.metadata,
  };
}

function aliasMap(rows) {
  const result = new Map();
  for (const row of rows) {
    const alias = text(row?.alias).toLowerCase();
    const owner = normalizeId(row?.book_id);
    if (!alias || !owner) fail("The live slug-alias table contains a blank alias or owner.");
    if (result.has(alias) && result.get(alias) !== owner) {
      fail(`The live slug alias ${alias} has more than one owner.`);
    }
    result.set(alias, owner);
  }
  return result;
}

function aliasesByBook(rows) {
  const result = new Map();
  for (const row of rows) {
    const owner = normalizeId(row?.book_id);
    const alias = text(row?.alias).toLowerCase();
    if (!owner || !alias) continue;
    const aliases = result.get(owner) || [];
    aliases.push(alias);
    result.set(owner, aliases);
  }
  for (const [owner, aliases] of result) {
    result.set(owner, [...new Set(aliases)].sort((a, b) => a.localeCompare(b)));
  }
  return result;
}

function assertUniqueCatalog(rows, label) {
  const ids = new Set();
  const slugs = new Map();
  for (const row of rows) {
    const id = normalizeId(row?.id);
    if (!id || ids.has(id)) fail(`${label} contains a missing or duplicate normalized book id.`);
    ids.add(id);
    const slug = text(row?.slug).toLowerCase();
    if (slug && slugs.has(slug) && slugs.get(slug) !== id) {
      fail(`${label} assigns slug ${slug} to both ${slugs.get(slug)} and ${id}.`);
    }
    if (slug) slugs.set(slug, id);
  }
}

function assertTargetRouteOwnership(catalogRows, aliasRows, targetRow) {
  const targetId = normalizeId(targetRow?.id);
  if (!targetId) fail("A catalog target has no canonical id.");
  const wanted = new Set([
    targetId,
    targetRow.slug,
    ...(targetRow.slug_aliases || []),
  ].map(value => text(value).toLowerCase()).filter(Boolean));

  for (const row of catalogRows) {
    const owner = normalizeId(row?.id);
    if (owner === targetId) continue;
    const keys = [
      owner,
      text(row?.slug).toLowerCase(),
      ...(Array.isArray(row?.slug_aliases) ? row.slug_aliases.map(value => text(value).toLowerCase()) : []),
    ];
    for (const key of keys) {
      if (key && wanted.has(key)) fail(`Route key ${key} is already owned by catalog book ${owner}.`);
    }
  }

  const owners = aliasMap(aliasRows);
  for (const key of wanted) {
    const owner = owners.get(key);
    if (owner && owner !== targetId) fail(`Route alias ${key} is already owned by ${owner}.`);
  }
}

function assertUnrelatedRowsCanRoundTrip(catalogRows, aliasRows) {
  const liveAliases = aliasesByBook(aliasRows);
  for (const row of catalogRows) {
    const id = normalizeId(row?.id);
    if (CATALOG_TARGET_IDS.has(id)) continue;
    const before = catalogValue(row);
    const afterRpc = rowAfterCatalogRpc(row);
    if (semanticHash(before) !== semanticHash(afterRpc)) {
      fail(`${id}: the catalog RPC would normalize an unrelated row; refusing the full-catalog save.`);
    }
    const rowAliases = normalizedAliases(row?.slug_aliases).sort((a, b) => a.localeCompare(b));
    const tableAliases = liveAliases.get(id) || [];
    if (stableJson(rowAliases) !== stableJson(tableAliases)) {
      fail(`${id}: the catalog row and slug-alias table differ; refusing to alter unrelated aliases.`);
    }
  }
}

async function loadLocalSource() {
  const [catalog, manifest, contentText, receipt, topicAuthority] = await Promise.all([
    readJson(CATALOG_PATH),
    readJson(CONTENT_MANIFEST_PATH),
    readFile(BOOK_CONTENT_PATH, "utf8"),
    readJson(SOURCE_RECEIPT_PATH),
    readJson(TOPIC_AUTHORITY_PATH),
  ]);
  const content = JSON.parse(contentText);
  if (!Array.isArray(catalog)) fail("The local book catalog is malformed.");
  assertUniqueCatalog(catalog, "The local catalog");
  const localBook = exactOne(catalog.filter(book => normalizeId(book?.id) === BOOK_ID), `local ${BOOK_ID} catalog row`);
  const localAgency = exactOne(catalog.filter(book => normalizeId(book?.id) === AGENCY_ID), `local ${AGENCY_ID} catalog row`);
  const manifestBooks = Array.isArray(manifest?.books) ? manifest.books : [];
  const manifestEntry = exactOne(manifestBooks.filter(book => normalizeId(book?.id) === BOOK_ID), `local ${BOOK_ID} manifest row`);
  const targetRow = catalogRowFromLocal(localBook);
  const agencyTargetRow = catalogRowFromLocal(localAgency);

  if (targetRow.id !== BOOK_ID || targetRow.slug !== BOOK_SLUG) fail("The local A Land Divided id or slug is not canonical.");
  if (targetRow.status !== "ready" || targetRow.visibility !== "main") fail("The local A Land Divided catalog row is not ready in the main library.");
  if (targetRow.book_file !== CONTENT_FILE) fail(`The local catalog must point to ${CONTENT_FILE}.`);
  if (agencyTargetRow.id !== AGENCY_ID || agencyTargetRow.status !== "hidden") {
    fail("The local Agency catalog row is not the canonical hidden target.");
  }
  if (normalizeId(content?.id) !== BOOK_ID || !Array.isArray(content?.sections) || !content.sections.length) {
    fail("The local A Land Divided manuscript is malformed.");
  }
  if (Number(content.sectionCount) !== content.sections.length) fail("The local manuscript section count is inconsistent.");
  const sectionIds = new Set();
  content.sections.forEach((section, index) => {
    const sectionId = text(section?.id);
    if (!sectionId || sectionIds.has(sectionId.toLowerCase()) || Number(section?.index) !== index || typeof section?.html !== "string") {
      fail(`The local manuscript contains an invalid section at position ${index + 1}.`);
    }
    sectionIds.add(sectionId.toLowerCase());
  });
  if (
    normalizeId(manifestEntry?.id) !== BOOK_ID
    || text(manifestEntry?.slug) !== BOOK_SLUG
    || path.basename(text(manifestEntry?.path)) !== CONTENT_FILE
    || Number(manifestEntry?.sectionCount) !== content.sections.length
    || Number(manifestEntry?.wordCount) !== Number(content.wordCount)
  ) {
    fail("The local A Land Divided manifest row does not match its manuscript.");
  }
  if (
    receipt?.bookId !== BOOK_ID
    || receipt?.source?.originalPreserved !== true
    || Number(receipt?.validation?.unintendedTextDeltaCount) !== 0
    || receipt?.validation?.copyrightPreservedExactly !== true
    || text(receipt?.output?.path).replace(/\\/g, "/") !== `private/book-content/${CONTENT_FILE}`
    || text(receipt?.output?.sha256) !== sha256(contentText)
  ) {
    fail("The reviewed A Land Divided source receipt does not match the local manuscript.");
  }
  const authorityTopics = topicAuthority?.topicsByBook?.[BOOK_ID];
  if (!arraysEqualAsTextSets(authorityTopics, targetRow.tags)) {
    fail("A Land Divided topics no longer match the local Topic authority.");
  }

  return {
    content,
    contentHash: semanticHash(content),
    targetRows: new Map([
      [BOOK_ID, targetRow],
      [AGENCY_ID, agencyTargetRow],
    ]),
  };
}

async function fetchCatalogRevision(supabase) {
  const result = await supabase
    .from("jju_admin_document_revisions")
    .select("revision")
    .eq("document_key", "book_catalog")
    .limit(2);
  const rows = assertResult(result, "Could not read the catalog revision");
  return text(exactOne(rows, "live book_catalog revision row").revision);
}

async function fetchCatalogBundle(supabase) {
  const revisionBefore = await fetchCatalogRevision(supabase);
  const [rows, aliases] = await Promise.all([
    fetchAllRows(supabase, "book_catalog", CATALOG_SELECT, "id"),
    fetchAllRows(supabase, "book_slug_aliases", "alias,book_id", "alias"),
  ]);
  const revisionAfter = await fetchCatalogRevision(supabase);
  if (!revisionBefore || revisionBefore !== revisionAfter) {
    fail("The catalog changed while its snapshot was being read. Run the command again.");
  }
  assertUniqueCatalog(rows, "The live catalog");
  return { rows, aliases, revision: revisionAfter };
}

async function fetchContentState(supabase) {
  const [byIdResult, byFileResult, byPathResult] = await Promise.all([
    supabase.from("book_content_live").select(CONTENT_SELECT).ilike("book_id", BOOK_ID),
    supabase.from("book_content_live").select(CONTENT_SELECT).ilike("content_file", CONTENT_FILE),
    supabase.from("book_content_live").select(CONTENT_SELECT).ilike("content_path", `%/${CONTENT_FILE}`),
  ]);
  const candidates = new Map();
  for (const [result, label] of [
    [byIdResult, "Could not inspect A Land Divided content by id"],
    [byFileResult, "Could not inspect A Land Divided content by filename"],
    [byPathResult, "Could not inspect A Land Divided content by path"],
  ]) {
    for (const row of assertResult(result, label)) {
      const key = String(row?.book_id || "");
      if (!key) fail("A candidate live manuscript row has no book id.");
      candidates.set(key, row);
    }
  }
  const rows = [...candidates.values()];
  const collisions = rows.filter(row => normalizeId(row?.book_id) !== BOOK_ID);
  if (collisions.length) {
    fail(`The ${CONTENT_FILE} filename or path is already used by ${collisions.map(row => row.book_id).join(", ")}.`);
  }
  const targetRows = rows.filter(row => normalizeId(row?.book_id) === BOOK_ID);
  if (targetRows.length > 1) fail("More than one normalized isrpal manuscript row exists.");
  const row = targetRows[0] || null;
  if (row && String(row.book_id) !== BOOK_ID) fail("The live A Land Divided manuscript id is not canonical lowercase.");
  return row;
}

function assertExistingContentMatches(row, local) {
  if (!row) return;
  if (!Number.isSafeInteger(Number(row.version_number)) || Number(row.version_number) < 1) {
    fail("The live A Land Divided manuscript has an invalid version number.");
  }
  if (text(row.content_file) !== CONTENT_FILE || text(row.content_path).replace(/\\/g, "/") !== CONTENT_PATH) {
    fail("The existing A Land Divided manuscript uses an unexpected filename or content path; refusing to rewrite it automatically.");
  }
  const liveHash = semanticHash(row.content);
  if (liveHash !== local.contentHash) {
    fail(`The existing A Land Divided manuscript differs from the reviewed local source (local ${local.contentHash}, live ${liveHash}).`);
  }
}

function targetCatalogRow(bundle, id) {
  return exactOne(bundle.rows.filter(row => normalizeId(row?.id) === id), `live ${id} catalog row`);
}

function catalogMatchesTarget(row, target) {
  return semanticHash(catalogValue(row)) === semanticHash(target);
}

function assertCatalogTargetsReadBack(bundle, targetRows) {
  const aliases = aliasesByBook(bundle.aliases);
  for (const [id, target] of targetRows) {
    const savedTarget = targetCatalogRow(bundle, id);
    if (!catalogMatchesTarget(savedTarget, target)) {
      fail(`${target.title || id} did not read back with the exact requested catalog values.`);
    }
    const expectedAliases = normalizedAliases(target.slug_aliases).sort((a, b) => a.localeCompare(b));
    if (stableJson(aliases.get(id) || []) !== stableJson(expectedAliases)) {
      fail(`${target.title || id} route aliases did not read back exactly.`);
    }
  }
}

function assertCatalogPreserved(before, after, targetRows) {
  if (before.rows.length !== after.rows.length) fail("The catalog row count changed during the two-book catalog save.");
  const beforeById = new Map(before.rows.map(row => [normalizeId(row.id), row]));
  const afterById = new Map(after.rows.map(row => [normalizeId(row.id), row]));
  if (beforeById.size !== afterById.size || [...beforeById.keys()].some(id => !afterById.has(id))) {
    fail("The catalog book ids changed during the two-book catalog save.");
  }
  const beforeAliases = aliasesByBook(before.aliases);
  const afterAliases = aliasesByBook(after.aliases);
  for (const [id, row] of beforeById) {
    if (CATALOG_TARGET_IDS.has(id)) continue;
    if (semanticHash(catalogValue(row)) !== semanticHash(catalogValue(afterById.get(id)))) {
      fail(`${id}: an unrelated catalog value changed during the two-book catalog save.`);
    }
    if (stableJson(beforeAliases.get(id) || []) !== stableJson(afterAliases.get(id) || [])) {
      fail(`${id}: an unrelated route alias changed during the two-book catalog save.`);
    }
  }
  assertCatalogTargetsReadBack(after, targetRows);
}

async function inspectRemote(supabase, local) {
  const [catalog, content] = await Promise.all([
    fetchCatalogBundle(supabase),
    fetchContentState(supabase),
  ]);
  const landDividedTarget = local.targetRows.get(BOOK_ID);
  const agencyTarget = local.targetRows.get(AGENCY_ID);
  const liveTargets = new Map([
    [BOOK_ID, targetCatalogRow(catalog, BOOK_ID)],
    [AGENCY_ID, targetCatalogRow(catalog, AGENCY_ID)],
  ]);
  for (const target of local.targetRows.values()) {
    assertTargetRouteOwnership(catalog.rows, catalog.aliases, target);
  }
  assertUnrelatedRowsCanRoundTrip(catalog.rows, catalog.aliases);
  assertExistingContentMatches(content, local);
  const landDividedCatalogChangeNeeded = !catalogMatchesTarget(liveTargets.get(BOOK_ID), landDividedTarget);
  const agencyCatalogChangeNeeded = !catalogMatchesTarget(liveTargets.get(AGENCY_ID), agencyTarget);
  return {
    catalog,
    content,
    liveTargets,
    contentMissing: !content,
    landDividedCatalogChangeNeeded,
    agencyCatalogChangeNeeded,
    agencyHideNeeded: text(liveTargets.get(AGENCY_ID)?.status).toLowerCase() !== "hidden",
    catalogChangeNeeded: landDividedCatalogChangeNeeded || agencyCatalogChangeNeeded,
  };
}

async function createMissingContent(supabase, local) {
  const result = await supabase.rpc("jju_admin_save_book_content", {
    p_expected_version: 0,
    p_book_id: BOOK_ID,
    p_content: local.content,
    p_content_file: CONTENT_FILE,
    p_content_path: CONTENT_PATH,
    p_message: "Publish reviewed A Land Divided source",
  });
  if (result.error) {
    if (String(result.error.code || "") === "40001") {
      fail("A Land Divided content changed after the preflight check. Nothing was overwritten; run the command again.");
    }
    fail(`Could not create A Land Divided content: ${result.error.message}`);
  }
  if (Number(result.data) !== 1) fail("The new A Land Divided manuscript did not return version 1.");
  const saved = await fetchContentState(supabase);
  if (!saved || Number(saved.version_number) !== 1) fail("The new A Land Divided manuscript could not be verified after saving.");
  assertExistingContentMatches(saved, local);
  return saved;
}

async function saveCatalogTargets(supabase, local) {
  // Re-read both the complete raw catalog and its document revision immediately
  // before the CAS. No earlier snapshot is used for this write.
  const before = await fetchCatalogBundle(supabase);
  for (const [id, target] of local.targetRows) {
    targetCatalogRow(before, id);
    assertTargetRouteOwnership(before.rows, before.aliases, target);
  }
  assertUnrelatedRowsCanRoundTrip(before.rows, before.aliases);
  const payload = before.rows.map(row => {
    const target = local.targetRows.get(normalizeId(row?.id));
    return target || catalogValue(row);
  });

  const result = await supabase.rpc("jju_admin_save_book_catalog", {
    p_expected_revision: before.revision,
    p_books: payload,
  });
  if (result.error) {
    if (String(result.error.code || "") === "40001") {
      fail("The catalog changed after the fresh snapshot. Nothing was overwritten; run the command again.");
    }
    fail(`Could not publish A Land Divided and hide Agency: ${result.error.message}`);
  }
  const returnedRevision = text(result.data);
  if (!returnedRevision || returnedRevision === before.revision) fail("The catalog save returned no trustworthy new revision.");
  const after = await fetchCatalogBundle(supabase);
  if (after.revision !== returnedRevision) fail("The catalog changed again before the save could be verified.");
  assertCatalogPreserved(before, after, local.targetRows);
  return after;
}

function printSummary({ mode, local, remote, finalContent, finalCatalog }) {
  const content = finalContent || remote.content;
  const catalogRows = finalCatalog
    ? new Map([
      [BOOK_ID, targetCatalogRow(finalCatalog, BOOK_ID)],
      [AGENCY_ID, targetCatalogRow(finalCatalog, AGENCY_ID)],
    ])
    : remote.liveTargets;
  const landDividedTarget = local.targetRows.get(BOOK_ID);
  const agencyTarget = local.targetRows.get(AGENCY_ID);
  const landDividedRow = catalogRows.get(BOOK_ID);
  const agencyRow = catalogRows.get(AGENCY_ID);
  console.log(JSON.stringify({
    mode,
    projectRef: EXPECTED_PROJECT_REF,
    release: {
      contentBookId: BOOK_ID,
      catalogBookIds: [BOOK_ID, AGENCY_ID],
    },
    local: {
      slug: BOOK_SLUG,
      sections: local.content.sections.length,
      words: Number(local.content.wordCount || 0),
      contentHash: local.contentHash,
    },
    live: {
      content: content ? {
        state: "matches",
        version: Number(content.version_number),
        contentHash: semanticHash(content.content),
      } : { state: "missing" },
      catalog: {
        landDivided: {
          state: catalogMatchesTarget(landDividedRow, landDividedTarget) ? "matches" : "needs-update",
          status: text(landDividedRow.status),
          slug: text(landDividedRow.slug),
        },
        agency: {
          state: catalogMatchesTarget(agencyRow, agencyTarget) ? "matches" : "needs-update",
          status: text(agencyRow.status),
          slug: text(agencyRow.slug),
          hideNeeded: text(agencyRow.status).toLowerCase() !== "hidden",
        },
      },
    },
    pending: mode === "check" ? {
      createLandDividedContent: remote.contentMissing,
      updateLandDividedCatalog: remote.landDividedCatalogChangeNeeded,
      updateAgencyCatalog: remote.agencyCatalogChangeNeeded,
      hideAgency: remote.agencyHideNeeded,
      updateCatalog: remote.catalogChangeNeeded,
      applyCommand: "npm run publication:publish-land-divided -- --apply",
    } : undefined,
    verified: mode === "apply" ? {
      exactContentReadback: true,
      exactLandDividedCatalogReadback: true,
      exactAgencyCatalogReadback: true,
      unrelatedCatalogValuesPreserved: true,
      note: "The document-wide catalog RPC updates timestamps on all catalog rows; unrelated field values and aliases were verified unchanged.",
    } : undefined,
  }, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npm run publication:publish-land-divided -- [--check | --apply]");
    console.log("Default and --check are read-only. Only --apply can write to Supabase.");
    return;
  }
  const unknown = args.filter(arg => arg !== "--check" && arg !== "--apply");
  if (unknown.length) fail(`Unknown option: ${unknown[0]}`);
  if (args.includes("--check") && args.includes("--apply")) fail("Choose either --check or --apply, not both.");
  const apply = args.includes("--apply");

  const local = await loadLocalSource();
  loadEnvConfig(ROOT);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceRole) fail("Supabase admin configuration is unavailable.");
  if (projectRef(url) !== EXPECTED_PROJECT_REF) {
    fail(`Refusing to use Supabase project ${projectRef(url) || "unknown"}; expected ${EXPECTED_PROJECT_REF}.`);
  }
  const supabase = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const remote = await inspectRemote(supabase, local);
  if (!apply) {
    printSummary({ mode: "check", local, remote });
    return;
  }

  // Content always lands first. If the later catalog CAS loses a race, the
  // manuscript remains non-public and a rerun will safely skip the exact match.
  const finalContent = remote.contentMissing
    ? await createMissingContent(supabase, local)
    : remote.content;

  // Confirm the manuscript is present before making the catalog row readable.
  if (!finalContent) fail("A Land Divided content is missing after the content-save step.");
  assertExistingContentMatches(finalContent, local);
  const contentBeforeCatalog = await fetchContentState(supabase);
  if (!contentBeforeCatalog) fail("A Land Divided content disappeared before its catalog row could be published.");
  assertExistingContentMatches(contentBeforeCatalog, local);
  const currentCatalog = await fetchCatalogBundle(supabase);
  const catalogStillNeedsUpdate = [...local.targetRows].some(([id, target]) => (
    !catalogMatchesTarget(targetCatalogRow(currentCatalog, id), target)
  ));
  if (catalogStillNeedsUpdate) {
    await saveCatalogTargets(supabase, local);
  }

  const readbackContent = await fetchContentState(supabase);
  if (!readbackContent) fail("A Land Divided content is missing from the final readback.");
  assertExistingContentMatches(readbackContent, local);
  const readbackCatalog = await fetchCatalogBundle(supabase);
  assertCatalogTargetsReadBack(readbackCatalog, local.targetRows);
  printSummary({
    mode: "apply",
    local,
    remote,
    finalContent: readbackContent,
    finalCatalog: readbackCatalog,
  });
}

await main().catch(error => {
  console.error(`A Land Divided / Agency catalog release failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
