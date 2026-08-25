import type { PathBook, PathsFile, ReadingPath } from "@/lib/paths";

export const COLLECTIONS_DRAFT_SCHEMA_VERSION = 1 as const;
export const COLLECTIONS_DRAFT_STORAGE_PREFIX = "jju.workshop.collections-organizer.v1";
export const COLLECTIONS_MEMBERSHIP_EDITOR_SCOPE = "collections-membership-v1" as const;

export type OrganizerBook = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  visibility: string;
  coverSrc: string;
  fallbackCoverSrc: string;
  legacyAlias: boolean;
};

export type OrganizerCollection = {
  id: string;
  title: string;
  description: string;
  sourceBucket: "series" | "paths" | "tagPaths" | "recommendedReading";
  books: PathBook[];
};

export type OrganizerDiagnostic = {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
  blocking: boolean;
};

export type CollectionDiff = {
  id: string;
  title: string;
  sourceBucket: OrganizerCollection["sourceBucket"];
  beforeIds: string[];
  afterIds: string[];
  added: Array<{ id: string; position: number }>;
  removed: Array<{ id: string; position: number }>;
  moved: Array<{ id: string; from: number; to: number }>;
};

export type OrganizerIssueLink = {
  kind: "book" | "collection";
  id: string;
  label?: string;
};

export type OrganizerIssue = {
  id: string;
  title: string;
  question: string;
  context: string;
  recommendation?: string;
  links: OrganizerIssueLink[];
};

export type OrganizerIssueQueue = {
  id: "collections" | "shelf" | "topics" | "duplicates" | "covers";
  title: string;
  shortTitle: string;
  description: string;
  issues: OrganizerIssue[];
};

export type CollectionsDraftRevision = {
  savedAt: string;
  paths: PathsFile;
};

export type CollectionsDraftEnvelope = {
  schemaVersion: typeof COLLECTIONS_DRAFT_SCHEMA_VERSION;
  draftId: string;
  baseVersion: string;
  savedAt: string;
  paths: PathsFile;
  revisions: CollectionsDraftRevision[];
};

const COLLECTION_BUCKETS = ["series", "paths", "tagPaths", "recommendedReading"] as const;

export function cleanAdminVersion(value: string | null | undefined) {
  return String(value || "").trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

export function collectionDraftStoragePrefix(baseVersion?: string) {
  return baseVersion
    ? `${COLLECTIONS_DRAFT_STORAGE_PREFIX}.${encodeURIComponent(cleanAdminVersion(baseVersion))}.`
    : `${COLLECTIONS_DRAFT_STORAGE_PREFIX}.`;
}

export function collectionDraftStorageKey(baseVersion: string, draftId: string) {
  return `${collectionDraftStoragePrefix(baseVersion)}${draftId}`;
}

export function clonePathsFile(paths: PathsFile): PathsFile {
  return JSON.parse(JSON.stringify(paths)) as PathsFile;
}

export function isOrganizerPathsFile(value: unknown): value is PathsFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.series) || !Array.isArray(record.paths)) return false;
  for (const bucket of COLLECTION_BUCKETS) {
    const groups = bucket === "series" || bucket === "paths" ? record[bucket] : record[bucket] || [];
    if (!Array.isArray(groups)) return false;
    for (const group of groups) {
      if (!group || typeof group !== "object" || Array.isArray(group)) return false;
      const groupRecord = group as Record<string, unknown>;
      if (typeof groupRecord.id !== "string" || typeof groupRecord.title !== "string" || !Array.isArray(groupRecord.books)) return false;
      for (const book of groupRecord.books) {
        if (!book || typeof book !== "object" || Array.isArray(book) || typeof (book as Record<string, unknown>).id !== "string") return false;
      }
    }
  }
  return true;
}

export function parseCollectionsDraftEnvelope(value: unknown): CollectionsDraftEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.schemaVersion !== COLLECTIONS_DRAFT_SCHEMA_VERSION
    || typeof envelope.draftId !== "string"
    || !envelope.draftId.trim()
    || typeof envelope.baseVersion !== "string"
    || !cleanAdminVersion(envelope.baseVersion)
    || typeof envelope.savedAt !== "string"
    || !Number.isFinite(Date.parse(envelope.savedAt))
    || !isOrganizerPathsFile(envelope.paths)
    || !Array.isArray(envelope.revisions)
  ) return null;

  const revisions: CollectionsDraftRevision[] = [];
  for (const revision of envelope.revisions) {
    if (!revision || typeof revision !== "object" || Array.isArray(revision)) return null;
    const record = revision as Record<string, unknown>;
    if (typeof record.savedAt !== "string" || !Number.isFinite(Date.parse(record.savedAt)) || !isOrganizerPathsFile(record.paths)) return null;
    revisions.push({ savedAt: record.savedAt, paths: preparePathsForSave(record.paths) });
  }

  return {
    schemaVersion: COLLECTIONS_DRAFT_SCHEMA_VERSION,
    draftId: envelope.draftId,
    baseVersion: cleanAdminVersion(envelope.baseVersion),
    savedAt: envelope.savedAt,
    paths: preparePathsForSave(envelope.paths),
    revisions: revisions.slice(-5),
  };
}

export function pathsEqual(left: PathsFile | null, right: PathsFile | null) {
  return Boolean(left && right) && JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Applies only the ordered Collection membership expressed by a client draft.
 * Titles, descriptions, group metadata, top-level metadata, and book notes are
 * always taken from the authoritative document. The Collection topology must
 * also match exactly, so a recovery copy cannot add, remove, rename, or move a
 * Collection between source buckets.
 */
export function rebaseOrganizerMembershipDraft(
  authoritative: PathsFile,
  proposed: PathsFile,
): PathsFile | null {
  if (!isOrganizerPathsFile(authoritative) || !isOrganizerPathsFile(proposed)) return null;

  const source = preparePathsForSave(authoritative);
  const candidate = preparePathsForSave(proposed);
  const rebased = clonePathsFile(source);
  const assignedBookIds = new Set<string>();

  for (const bucket of COLLECTION_BUCKETS) {
    const sourceGroups = source[bucket] || [];
    const candidateGroups = candidate[bucket] || [];
    if (sourceGroups.length !== candidateGroups.length) return null;

    const candidateById = new Map<string, ReadingPath>();
    for (const group of candidateGroups) {
      if (!group.id || candidateById.has(group.id)) return null;
      candidateById.set(group.id, group);
    }

    const nextGroups: ReadingPath[] = [];
    for (const sourceGroup of sourceGroups) {
      const candidateGroup = candidateById.get(sourceGroup.id);
      if (!candidateGroup) return null;

      const sourceBooks = new Map(sourceGroup.books.map(book => [book.id, book]));
      const seenInGroup = new Set<string>();
      const books: PathBook[] = [];
      for (const candidateBook of candidateGroup.books) {
        const id = String(candidateBook.id || "").trim().toLowerCase();
        if (!id || seenInGroup.has(id) || assignedBookIds.has(id)) return null;
        seenInGroup.add(id);
        assignedBookIds.add(id);

        const sourceBook = sourceBooks.get(id);
        books.push({
          ...(sourceBook || { id, note: "" }),
          id,
          order: books.length + 1,
        });
      }

      nextGroups.push({
        ...sourceGroup,
        bookCount: books.length,
        books,
      });
    }
    rebased[bucket] = nextGroups;
  }

  return preparePathsForSave(rebased);
}

function normalizeGroup(group: ReadingPath): ReadingPath {
  const books = (group.books || []).map((book, index) => ({
    ...book,
    id: String(book.id || "").trim().toLowerCase(),
    order: index + 1,
    note: String(book.note || ""),
  })).filter(book => book.id);
  return {
    ...group,
    id: String(group.id || "").trim().toLowerCase(),
    title: String(group.title || group.id || "Untitled Collection").trim(),
    bookCount: books.length,
    books,
  };
}

export function preparePathsForSave(paths: PathsFile): PathsFile {
  const next = clonePathsFile(paths);
  next.series = (next.series || []).map(normalizeGroup);
  next.paths = (next.paths || []).map(normalizeGroup);
  next.tagPaths = (next.tagPaths || []).map(normalizeGroup);
  next.recommendedReading = (next.recommendedReading || []).map(normalizeGroup);
  const collections = organizerCollections(next);
  const assignments = collections.reduce((total, collection) => total + collection.books.length, 0);
  const uniqueBooks = new Set(collections.flatMap(collection => collection.books.map(book => book.id)));
  next.counts = {
    ...(next.counts || {}),
    series: next.series.length,
    paths: next.paths.length,
    tagPaths: next.tagPaths.length,
    recommendedSections: next.recommendedReading.length,
    collectionAssignments: assignments,
    collectionBooks: uniqueBooks.size,
  };
  return next;
}

export function organizerCollections(paths: PathsFile): OrganizerCollection[] {
  return COLLECTION_BUCKETS.flatMap(sourceBucket => {
    const groups = paths[sourceBucket] || [];
    return groups.map(group => ({
      id: group.id,
      title: group.title,
      description: group.description,
      sourceBucket,
      books: group.books,
    }));
  });
}

export function mapCollections(
  paths: PathsFile,
  transform: (collection: ReadingPath, sourceBucket: OrganizerCollection["sourceBucket"]) => ReadingPath,
) {
  const next = clonePathsFile(paths);
  for (const bucket of COLLECTION_BUCKETS) {
    next[bucket] = (next[bucket] || []).map(group => transform(group, bucket));
  }
  return preparePathsForSave(next);
}

export function collectionAssignments(paths: PathsFile) {
  const assignments = new Map<string, string[]>();
  for (const collection of organizerCollections(paths)) {
    for (const book of collection.books) {
      assignments.set(book.id, [...(assignments.get(book.id) || []), collection.id]);
    }
  }
  return assignments;
}

export function diagnoseOrganizerPaths(paths: PathsFile, validBookIds: ReadonlySet<string>): OrganizerDiagnostic[] {
  const collections = organizerCollections(paths);
  const seenCollectionIds = new Set<string>();
  const duplicateCollectionIds = new Set<string>();
  const duplicateBookRefs: string[] = [];
  const missingBookRefs: string[] = [];
  const badOrder: string[] = [];
  const staleCounts: string[] = [];
  const emptyCollections: string[] = [];

  for (const collection of collections) {
    if (seenCollectionIds.has(collection.id)) duplicateCollectionIds.add(collection.id);
    seenCollectionIds.add(collection.id);
    if (!collection.books.length) emptyCollections.push(collection.title);
    const seenBookIds = new Set<string>();
    collection.books.forEach((book, index) => {
      if (seenBookIds.has(book.id)) duplicateBookRefs.push(`${collection.title}: ${book.id}`);
      seenBookIds.add(book.id);
      if (!validBookIds.has(book.id)) missingBookRefs.push(`${collection.title}: ${book.id}`);
      if (book.order !== index + 1) badOrder.push(`${collection.title}: ${book.id}`);
    });
    const sourceGroup = [...(paths.series || []), ...(paths.paths || []), ...(paths.tagPaths || []), ...(paths.recommendedReading || [])]
      .find(group => group.id === collection.id);
    if (Number(sourceGroup?.bookCount || 0) !== collection.books.length) staleCounts.push(collection.title);
  }

  const assignments = collectionAssignments(paths);
  const overlaps = [...assignments.entries()].filter(([, ids]) => ids.length > 1);
  const expectedAssignments = collections.reduce((sum, collection) => sum + collection.books.length, 0);
  const expectedUnique = assignments.size;
  const storedAssignments = Number(paths.counts?.collectionAssignments);
  const storedUnique = Number(paths.counts?.collectionBooks);
  const topCountsMatch = storedAssignments === expectedAssignments && storedUnique === expectedUnique;

  return [
    {
      id: "collections",
      label: "Collection IDs are unique",
      detail: duplicateCollectionIds.size ? [...duplicateCollectionIds].join(", ") : `${collections.length} unique Collection IDs`,
      passed: duplicateCollectionIds.size === 0,
      blocking: true,
    },
    {
      id: "empty",
      label: "No Collection is empty",
      detail: emptyCollections.length ? emptyCollections.join(", ") : "Every Collection has at least one book",
      passed: emptyCollections.length === 0,
      blocking: true,
    },
    {
      id: "duplicates",
      label: "No duplicate book inside a Collection",
      detail: duplicateBookRefs.length ? duplicateBookRefs.slice(0, 8).join("; ") : "Every member appears once inside its Collection",
      passed: duplicateBookRefs.length === 0,
      blocking: true,
    },
    {
      id: "overlap",
      label: "Books belong to at most one Collection",
      detail: overlaps.length ? overlaps.slice(0, 8).map(([id, ids]) => `${id}: ${ids.join(", ")}`).join("; ") : "Zero Collection overlaps",
      passed: overlaps.length === 0,
      blocking: true,
    },
    {
      id: "missing",
      label: "Every member is a real catalog book",
      detail: missingBookRefs.length ? missingBookRefs.slice(0, 8).join("; ") : "Zero missing catalog IDs",
      passed: missingBookRefs.length === 0,
      blocking: true,
    },
    {
      id: "order",
      label: "Authored order is contiguous",
      detail: badOrder.length ? badOrder.slice(0, 8).join("; ") : "Every Collection is numbered 1 through its final book",
      passed: badOrder.length === 0,
      blocking: true,
    },
    {
      id: "group-counts",
      label: "Collection member counts are exact",
      detail: staleCounts.length ? staleCounts.join(", ") : "Every Collection count matches its ordered member list",
      passed: staleCounts.length === 0,
      blocking: true,
    },
    {
      id: "file-counts",
      label: "File totals match the Collection lists",
      detail: topCountsMatch
        ? `${expectedAssignments} assignments, ${expectedUnique} unique books`
        : `Expected ${expectedAssignments}/${expectedUnique}; stored ${String(paths.counts?.collectionAssignments)}/${String(paths.counts?.collectionBooks)}`,
      passed: topCountsMatch,
      blocking: true,
    },
  ];
}

export function diffOrganizerPaths(before: PathsFile, after: PathsFile): CollectionDiff[] {
  const beforeCollections = new Map(organizerCollections(before).map(collection => [collection.id, collection]));
  const afterCollections = new Map(organizerCollections(after).map(collection => [collection.id, collection]));
  const ids = [...new Set([...beforeCollections.keys(), ...afterCollections.keys()])];

  return ids.flatMap(id => {
    const previous = beforeCollections.get(id);
    const current = afterCollections.get(id);
    const beforeIds = previous?.books.map(book => book.id) || [];
    const afterIds = current?.books.map(book => book.id) || [];
    if (JSON.stringify(beforeIds) === JSON.stringify(afterIds)) return [];
    const beforePositions = new Map(beforeIds.map((bookId, index) => [bookId, index + 1]));
    const afterPositions = new Map(afterIds.map((bookId, index) => [bookId, index + 1]));
    return [{
      id,
      title: current?.title || previous?.title || id,
      sourceBucket: current?.sourceBucket || previous?.sourceBucket || "series",
      beforeIds,
      afterIds,
      added: afterIds.filter(bookId => !beforePositions.has(bookId)).map(bookId => ({ id: bookId, position: afterPositions.get(bookId) || 0 })),
      removed: beforeIds.filter(bookId => !afterPositions.has(bookId)).map(bookId => ({ id: bookId, position: beforePositions.get(bookId) || 0 })),
      moved: afterIds
        .filter(bookId => beforePositions.has(bookId) && beforePositions.get(bookId) !== afterPositions.get(bookId))
        .map(bookId => ({ id: bookId, from: beforePositions.get(bookId) || 0, to: afterPositions.get(bookId) || 0 })),
    }];
  });
}

const COLLECTION_ISSUES: OrganizerIssue[] = [
  {
    id: "ruler-collection",
    title: "Does the library need a ruler Collection?",
    question: "Should Wu Zetian, Wilhelm II, and Mansa Musa form a new ruler or monarchy Collection?",
    context: "All three are intentionally uncollected. A new Collection needs a name, a clear boundary, and a print scope before any of them move.",
    recommendation: "Leave them uncollected until the name and physical-volume idea are clear.",
    links: [
      { kind: "book", id: "wu" },
      { kind: "book", id: "kaiser" },
      { kind: "book", id: "mansu" },
    ],
  },
  {
    id: "mapmakers-edges",
    title: "Where does Mapmakers stop?",
    question: "Should Congo, Syria, or a future Israel/Palestine book count as country portraits in The Mapmakers?",
    context: "Rubber and Blood is about the Congo Free State, while Syria is coming soon. No Israel/Palestine catalog record exists yet.",
    recommendation: "Keep unfinished books out of print packages even if editorial Collection membership is allowed.",
    links: [
      { kind: "collection", id: "the-mapmakers" },
      { kind: "book", id: "congo" },
      { kind: "book", id: "syria" },
    ],
  },
  {
    id: "business-boundary",
    title: "Company histories or whole industries?",
    question: "Should The House join Business as Usual even though it covers the casino industry rather than one company?",
    context: "The House remains uncollected until Business as Usual has a written boundary.",
    links: [
      { kind: "collection", id: "business-as-usual" },
      { kind: "book", id: "casinos" },
    ],
  },
  {
    id: "pantheon-sequence",
    title: "Do Pantheon I and II need their own sequence?",
    question: "Should the two Pantheon books stay in The Big Picture or become a deliberately ordered two-book Collection?",
    context: "This is a reading-order and physical-volume decision, not a topic-tag decision.",
    links: [
      { kind: "collection", id: "the-big-picture" },
      { kind: "book", id: "pantheon" },
      { kind: "book", id: "pantheon2" },
    ],
  },
  {
    id: "system-rwb-boundary",
    title: "The System versus Red, White, and Bruised",
    question: "What is the written rule separating institutional systems from specifically American political history?",
    context: "The current high-confidence assignments are intact. The boundary still needs one sentence James can use consistently.",
    links: [
      { kind: "collection", id: "the-system" },
      { kind: "collection", id: "red-white-and-bruised" },
    ],
  },
  {
    id: "working-names",
    title: "Three Collection names are still working names",
    question: "Are The Belief Map, The Noisemakers, and The System good enough to lock as public and print names?",
    context: "Membership can stay intact even if a final naming pass changes the labels later.",
    links: [
      { kind: "collection", id: "world-religions" },
      { kind: "collection", id: "the-noisemakers" },
      { kind: "collection", id: "the-system" },
    ],
  },
  {
    id: "pending-membership",
    title: "Can unfinished books belong to editorial Collections?",
    question: "Should coming-soon or hidden books stay in Collections before their manuscripts are approved?",
    context: "The current file has valid non-ready memberships. Print packaging must still exclude books without an approved manuscript.",
    recommendation: "Allow editorial membership, but keep print eligibility as a separate hard gate.",
    links: [
      { kind: "collection", id: "the-code-breakers" },
      { kind: "collection", id: "under-the-hood" },
      { kind: "collection", id: "the-system" },
    ],
  },
  {
    id: "legacy-series-strings",
    title: "Four old Series labels disagree with Collections",
    question: "After the Collection decisions settle, should the old free-text Series field be retired or synchronized?",
    context: "Lunchtime, Mansa Musa, The Last Kaiser, and Wu Zetian still carry legacy labels that do not match paths.json.",
    recommendation: "Make Collections authoritative and retire free-text Series after a reviewed migration.",
    links: [
      { kind: "book", id: "lunchtime" },
      { kind: "book", id: "mansu" },
      { kind: "book", id: "kaiser" },
      { kind: "book", id: "wu" },
    ],
  },
];

const SHELF_ISSUES: OrganizerIssue[] = [
  {
    id: "shelf-policy",
    title: "Choose the Shelf rule once",
    question: "Does every ready public book get exactly one primary Shelf, or may the broad Shelves overlap?",
    context: "The written plan says one primary Shelf, but the current public code derives overlapping Shelves from Topics. Nearly every ready book therefore appears in more than one.",
    recommendation: "Use exactly one approved primary Shelf. Keep overlap in Topics and optional secondary discovery lenses.",
    links: [],
  },
];

const TOPIC_CASES = [
  ["biochemical", "Biochemical Romance", "Should the primary reading be food addiction and brain chemistry, or corporate food systems?"],
  ["bure", "BUREAUCRACY", "Should bureaucracy live primarily under government power, or under work and institutional systems?"],
  ["cancer", "CANCER", "The book explains cancer and critiques the oncology industry. Should corporate medicine remain a secondary Topic?"],
  ["color", "COLOR", "Should perception and science history remain Topics, or should this be presented only as cultural and art history?"],
  ["foreskin", "Foresaken", "Is the main promise medical anatomy, or the cultural and religious history of circumcision?"],
  ["haile", "The Lion of Judah", "Should Haile Selassie be framed primarily as Ethiopian history, political power, or religious influence?"],
  ["hiddenhand", "The Hidden Hand", "Should secret societies be presented primarily as power and institutions, or belief and esotericism?"],
  ["materialism", "OOPS, ALL ATOMS", "Should this be Philosophy first, or Minds because it focuses on consciousness and the self?"],
  ["myths", "They Don't Want You to Know", "Is the primary subject conspiracy psychology, mythology, or religion?"],
  ["pantheon2", "Pantheon II", "Should the public Topics emphasize mythology, ancient history, or the book's conspiracy lens?"],
  ["poker", "POKER", "Should the primary promise be decision psychology and probability, or money and gambling systems?"],
  ["rock", "This Is a Rock", "Should language history remain Culture first, or Minds because cognition and naming drive the argument?"],
  ["saudi", "The Mirage", "Should Saudi Arabia be framed primarily as monarchy and state power, or oil and political economy?"],
  ["schooled", "Schooled", "Should education be framed as institutional power and propaganda, or as American cultural history?"],
  ["tmk", "Mushroom Man", "Should Terence McKenna be framed primarily through psychedelics and psychology, spirituality, or Biography?"],
] as const;

const TOPIC_ISSUES: OrganizerIssue[] = TOPIC_CASES.map(([id, title, question]) => ({
  id: `topic-${id}`,
  title,
  question,
  context: "This is one of the 15 bounded Topic questions from the reviewed taxonomy audit. The organizer shows it without pretending to auto-decide it.",
  links: [{ kind: "book", id }],
}));

const DUPLICATE_PAIRS = [
  ["videogames", "games", "Insert Coin"],
  ["nic", "nicotine", "Nicotine"],
  ["field", "fields", "Quantum Fields"],
  ["vangogh", "van", "Vincent van Gogh"],
  ["music", "vibes", "Music"],
  ["odd", "odds", "What Are the Odds?"],
  ["prenancy", "pregnancy", "Pregnancy"],
] as const;

const DUPLICATE_ISSUES: OrganizerIssue[] = DUPLICATE_PAIRS.map(([legacyId, canonicalId, title]) => ({
  id: `duplicate-${legacyId}`,
  title,
  question: `Confirm ${canonicalId} as the canonical book and preserve ${legacyId} only as an alias or redirect?`,
  context: "The older record is a non-ready duplicate. It is excluded from add-book choices so it cannot accidentally re-enter a Collection.",
  recommendation: "Keep the ready canonical record and preserve old links through the existing alias.",
  links: [
    { kind: "book", id: canonicalId, label: `Canonical: ${canonicalId}` },
    { kind: "book", id: legacyId, label: `Old record: ${legacyId}` },
  ],
}));

const COVER_ISSUES: OrganizerIssue[] = [
  {
    id: "cover-watchtower",
    title: "Watchtower needs an approved WebP source",
    question: "Is the generated fallback acceptable, or should Watchtower get a real approved cover asset?",
    context: "The expected watchtower.webp file is missing. The public fallback prevents a broken image but is not a final art approval.",
    links: [{ kind: "book", id: "watchtower" }],
  },
  {
    id: "cover-kojiki",
    title: "Kojiki cover is a dimension outlier",
    question: "Does the 420 by 608 cover crop correctly in the standard two-by-three frame?",
    context: "Most ready covers are 420 by 630. This one includes the author line but needs a visual crop check.",
    links: [{ kind: "book", id: "kojiki" }],
  },
  {
    id: "cover-astral",
    title: "Unbound cover needs a visual approval",
    question: "Approve the 420 by 544 composition and the cover's missing byline, or request a corrected source?",
    context: "The organizer shows the real cover so this remains a human art decision.",
    links: [{ kind: "book", id: "astral" }],
  },
  {
    id: "cover-crust",
    title: "In Crust We Trust needs a visual approval",
    question: "Approve the 420 by 531 composition and missing byline, or request a corrected source?",
    context: "This is a substantial aspect-ratio outlier, not a metadata-only warning.",
    links: [{ kind: "book", id: "crust" }],
  },
  {
    id: "cover-rome",
    title: "Imperium Romanum needs a visual approval",
    question: "Approve the 420 by 585 composition and missing byline, or request a corrected source?",
    context: "The cover is usable but does not match the standard source dimensions.",
    links: [{ kind: "book", id: "rome" }],
  },
  {
    id: "cover-scisim",
    title: "Science Simplified needs a visual approval",
    question: "Approve the 420 by 566 composition and missing byline, or request a corrected source?",
    context: "The image needs James's eyes; an automated crop check cannot approve the design.",
    links: [{ kind: "book", id: "scisim" }],
  },
];

export const ORGANIZER_NEEDS_YOU_QUEUES: OrganizerIssueQueue[] = [
  {
    id: "collections",
    title: "Collection calls",
    shortTitle: "Collections",
    description: "The eight boundaries and naming choices deliberately left for James.",
    issues: COLLECTION_ISSUES,
  },
  {
    id: "shelf",
    title: "Shelf policy",
    shortTitle: "Shelf",
    description: "One policy decision stops hundreds of repeated book-by-book arguments.",
    issues: SHELF_ISSUES,
  },
  {
    id: "topics",
    title: "Topic edge cases",
    shortTitle: "Topics",
    description: "Fifteen named books with a real framing question.",
    issues: TOPIC_ISSUES,
  },
  {
    id: "duplicates",
    title: "Duplicate records",
    shortTitle: "Duplicates",
    description: "Seven canonical-ID confirmations; the old IDs stay as redirects.",
    issues: DUPLICATE_ISSUES,
  },
  {
    id: "covers",
    title: "Cover checks",
    shortTitle: "Covers",
    description: "Six covers that need a real visual decision instead of another automated guess.",
    issues: COVER_ISSUES,
  },
];
