import type { BookContent, BookContentSection } from "@/lib/bookContent";

export type WorkshopDraftSection = Omit<BookContentSection, "text" | "wordCount">;

export type WorkshopManuscriptDraft = {
  contentTitle: string;
  contentCreator: string;
  contentDescription: string;
  selectedSectionId: string;
  sections: WorkshopDraftSection[];
};

export type WorkshopRecoveryEnvelope = {
  schemaVersion: 1 | 2;
  draftId: string;
  bookId: string;
  savedAt: string;
  baseContentVersion: string;
  conflicts: string[];
  baseline: WorkshopManuscriptDraft;
  draft: WorkshopManuscriptDraft;
};

export function normalizeAdminVersion(value: string | null | undefined) {
  return String(value || "").trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

export function bookContentFromAdminPayload(value: unknown, fallback: BookContent): BookContent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.sections) || record.sections.length === 0) return null;

  const ids = new Set<string>();
  const sections: BookContentSection[] = [];
  for (const [position, rawSection] of record.sections.entries()) {
    if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)) return null;
    const section = rawSection as Record<string, unknown>;
    const id = String(section.id || "").trim();
    if (!id || ids.has(id) || typeof section.html !== "string") return null;
    if (section.href !== undefined && typeof section.href !== "string") return null;
    ids.add(id);
    const text = typeof section.text === "string" ? section.text : undefined;
    const rawWordCount = Number(section.wordCount);
    sections.push({
      id,
      index: Number.isFinite(Number(section.index)) ? Number(section.index) : position,
      title: typeof section.title === "string" ? section.title : `Section ${position + 1}`,
      kind: typeof section.kind === "string" ? section.kind : "chapter",
      href: typeof section.href === "string" ? section.href : undefined,
      html: section.html,
      text,
      wordCount: Number.isFinite(rawWordCount) ? rawWordCount : undefined,
    });
  }

  const optionalString = (key: keyof BookContent) => (
    typeof record[key] === "string" ? String(record[key]) : fallback[key]
  );
  const rawSectionCount = Number(record.sectionCount);
  const rawBookWordCount = Number(record.wordCount);
  return {
    id: fallback.id,
    slug: optionalString("slug") as string | undefined,
    sourceFile: optionalString("sourceFile") as string | undefined,
    title: typeof record.title === "string" && record.title.trim() ? record.title : fallback.title,
    creator: optionalString("creator") as string | undefined,
    description: optionalString("description") as string | undefined,
    language: optionalString("language") as string | undefined,
    publisher: optionalString("publisher") as string | undefined,
    generatedAt: optionalString("generatedAt") as string | undefined,
    sectionCount: Number.isFinite(rawSectionCount) ? rawSectionCount : sections.length,
    wordCount: Number.isFinite(rawBookWordCount) ? rawBookWordCount : undefined,
    sections,
  };
}

export type WorkshopRecoveryRead =
  | { envelope: WorkshopRecoveryEnvelope; issue: "" }
  | { envelope: null; issue: string }
  | null;

export type WorkshopDraftMerge = {
  draft: WorkshopManuscriptDraft;
  conflicts: string[];
};

export function manuscriptDraftFromBook(book: BookContent, selectedSectionId = ""): WorkshopManuscriptDraft {
  const sections = book.sections.map((section, index) => ({
    id: section.id,
    index,
    title: section.title,
    kind: section.kind || "chapter",
    href: section.href,
    html: section.html,
  }));

  return {
    contentTitle: book.title,
    contentCreator: book.creator || "",
    contentDescription: book.description || "",
    selectedSectionId: sections.some(section => section.id === selectedSectionId)
      ? selectedSectionId
      : sections[0]?.id || "",
    sections,
  };
}

function comparableDraft(draft: WorkshopManuscriptDraft) {
  return {
    contentTitle: draft.contentTitle,
    contentCreator: draft.contentCreator,
    contentDescription: draft.contentDescription,
    sections: draft.sections,
  };
}

export function manuscriptDraftsMatch(left: WorkshopManuscriptDraft, right: WorkshopManuscriptDraft) {
  return JSON.stringify(comparableDraft(left)) === JSON.stringify(comparableDraft(right));
}

function valuesMatch(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeField<T>(label: string, baseline: T, local: T, remote: T, conflicts: string[]) {
  const localChanged = !valuesMatch(local, baseline);
  const remoteChanged = !valuesMatch(remote, baseline);
  if (localChanged && remoteChanged && !valuesMatch(local, remote)) conflicts.push(label);
  return localChanged ? local : remote;
}

export function mergeManuscriptDrafts(
  baseline: WorkshopManuscriptDraft,
  local: WorkshopManuscriptDraft,
  remote: WorkshopManuscriptDraft,
): WorkshopDraftMerge {
  const conflicts: string[] = [];
  const baselineById = new Map(baseline.sections.map(section => [section.id, section]));
  const localById = new Map(local.sections.map(section => [section.id, section]));
  const remoteById = new Map(remote.sections.map(section => [section.id, section]));
  const allIds = new Set([...baselineById.keys(), ...localById.keys(), ...remoteById.keys()]);
  const chosenById = new Map<string, WorkshopDraftSection>();

  for (const id of allIds) {
    const baseSection = baselineById.get(id);
    const localSection = localById.get(id);
    const remoteSection = remoteById.get(id);
    const sectionLabel = localSection?.title || remoteSection?.title || baseSection?.title || id;

    if (!baseSection) {
      if (localSection && remoteSection && !valuesMatch(localSection, remoteSection)) {
        conflicts.push(`New section: ${sectionLabel}`);
      }
      const chosen = localSection || remoteSection;
      if (chosen) chosenById.set(id, chosen);
      continue;
    }

    if (!localSection && !remoteSection) continue;
    if (!localSection) {
      if (remoteSection && !valuesMatch(remoteSection, baseSection)) {
        conflicts.push(`Deleted here but edited elsewhere: ${sectionLabel}`);
      }
      continue;
    }
    if (!remoteSection) {
      if (!valuesMatch(localSection, baseSection)) {
        conflicts.push(`Edited here but deleted elsewhere: ${sectionLabel}`);
        chosenById.set(id, localSection);
      }
      continue;
    }

    chosenById.set(id, {
      id,
      index: localSection.index,
      title: mergeField(`${sectionLabel}: contents label`, baseSection.title, localSection.title, remoteSection.title, conflicts),
      kind: mergeField(`${sectionLabel}: section kind`, baseSection.kind, localSection.kind, remoteSection.kind, conflicts),
      href: mergeField(`${sectionLabel}: section link`, baseSection.href, localSection.href, remoteSection.href, conflicts),
      html: mergeField(`${sectionLabel}: writing`, baseSection.html, localSection.html, remoteSection.html, conflicts),
    });
  }

  const allowedIds = new Set(chosenById.keys());
  const baselineOrder = baseline.sections.map(section => section.id).filter(id => allowedIds.has(id));
  const localOrder = local.sections.map(section => section.id).filter(id => allowedIds.has(id));
  const remoteOrder = remote.sections.map(section => section.id).filter(id => allowedIds.has(id));
  const localOrderChanged = !valuesMatch(localOrder, baselineOrder);
  const remoteOrderChanged = !valuesMatch(remoteOrder, baselineOrder);
  if (localOrderChanged && remoteOrderChanged && !valuesMatch(localOrder, remoteOrder)) {
    conflicts.push("Section order");
  }
  const preferredOrder = localOrderChanged ? localOrder : remoteOrder;
  const completeOrder = [
    ...preferredOrder,
    ...[...chosenById.keys()].filter(id => !preferredOrder.includes(id)),
  ];
  let sections = completeOrder
    .map(id => chosenById.get(id))
    .filter((section): section is WorkshopDraftSection => Boolean(section))
    .map((section, index) => ({ ...section, index }));

  if (sections.length === 0) {
    conflicts.push("Section deletions would leave the manuscript empty");
    const fallbackSections = local.sections.length > 0
      ? local.sections
      : remote.sections.length > 0
        ? remote.sections
        : baseline.sections;
    sections = fallbackSections.map((section, index) => ({ ...section, index }));
  }

  return {
    draft: {
      contentTitle: mergeField("Book title", baseline.contentTitle, local.contentTitle, remote.contentTitle, conflicts),
      contentCreator: mergeField("Author", baseline.contentCreator, local.contentCreator, remote.contentCreator, conflicts),
      contentDescription: mergeField("Description", baseline.contentDescription, local.contentDescription, remote.contentDescription, conflicts),
      selectedSectionId: sections.some(section => section.id === local.selectedSectionId)
        ? local.selectedSectionId
        : sections[0]?.id || "",
      sections,
    },
    conflicts: [...new Set(conflicts)],
  };
}

function parseDraft(value: unknown): WorkshopManuscriptDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.contentTitle !== "string"
    || typeof record.contentCreator !== "string"
    || typeof record.contentDescription !== "string"
    || typeof record.selectedSectionId !== "string"
    || !Array.isArray(record.sections)
    || record.sections.length === 0
  ) return null;

  const ids = new Set<string>();
  const sections: WorkshopDraftSection[] = [];
  for (const [index, rawSection] of record.sections.entries()) {
    if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)) return null;
    const section = rawSection as Record<string, unknown>;
    if (
      typeof section.id !== "string"
      || !section.id
      || ids.has(section.id)
      || typeof section.title !== "string"
      || typeof section.html !== "string"
      || (section.kind !== undefined && typeof section.kind !== "string")
      || (section.href !== undefined && typeof section.href !== "string")
    ) return null;
    ids.add(section.id);
    sections.push({
      id: section.id,
      index,
      title: section.title,
      kind: String(section.kind || "chapter"),
      href: typeof section.href === "string" ? section.href : undefined,
      html: section.html,
    });
  }

  return {
    contentTitle: record.contentTitle,
    contentCreator: record.contentCreator,
    contentDescription: record.contentDescription,
    selectedSectionId: ids.has(record.selectedSectionId) ? record.selectedSectionId : sections[0].id,
    sections,
  };
}

export function parseManuscriptRecovery(raw: string, expectedBookId: string): WorkshopRecoveryRead {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { envelope: null, issue: "The saved phone draft is not readable. It has not been deleted." };
    }
    const record = value as Record<string, unknown>;
    if (
      (record.schemaVersion !== 1 && record.schemaVersion !== 2)
      || record.bookId !== expectedBookId
      || typeof record.savedAt !== "string"
      || !Number.isFinite(Date.parse(record.savedAt))
      || typeof record.baseContentVersion !== "string"
      || (record.schemaVersion === 2 && (typeof record.draftId !== "string" || !record.draftId))
      || (record.conflicts !== undefined && (
        !Array.isArray(record.conflicts)
        || record.conflicts.some(item => typeof item !== "string")
      ))
    ) {
      return { envelope: null, issue: "The saved phone draft uses an unknown or incomplete format. It has not been deleted." };
    }
    const baseline = parseDraft(record.baseline);
    const draft = parseDraft(record.draft);
    if (!baseline || !draft) {
      return { envelope: null, issue: "The saved phone draft is incomplete. It has not been deleted." };
    }

    return {
      envelope: {
        schemaVersion: record.schemaVersion,
        draftId: typeof record.draftId === "string" && record.draftId
          ? record.draftId
          : `legacy-${expectedBookId}`,
        bookId: expectedBookId,
        savedAt: record.savedAt,
        baseContentVersion: record.baseContentVersion,
        conflicts: Array.isArray(record.conflicts) ? record.conflicts as string[] : [],
        baseline,
        draft,
      },
      issue: "",
    };
  } catch {
    return { envelope: null, issue: "The saved phone draft could not be opened safely. It has not been deleted." };
  }
}
