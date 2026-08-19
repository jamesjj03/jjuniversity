export const TAXONOMY_REVIEW_SCHEMA_VERSION = 2 as const;

export type TaxonomyReviewGroup = {
  id: string;
  name: string;
  bookIds: string[];
  description?: string;
  sourceBucket?: "series" | "paths" | "new";
};

export type TaxonomyReviewDraft = {
  schemaVersion: typeof TAXONOMY_REVIEW_SCHEMA_VERSION;
  catalogFingerprint: string;
  collections: TaxonomyReviewGroup[];
  shelves: TaxonomyReviewGroup[];
  topics: TaxonomyReviewGroup[];
  reviewBookIds: string[];
};

export type TaxonomyReviewBook = {
  id: string;
  title: string;
  subtitle: string;
  coverSrc: string;
  fallbackCoverSrc: string;
};

function sortText(left: string, right: string) {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function canonicalGroups(groups: TaxonomyReviewGroup[]) {
  const seenGroupIds = new Set<string>();

  return groups
    .map(group => ({
      id: String(group.id || "").trim(),
      name: String(group.name || "").trim(),
      ...(String(group.description || "").trim() ? { description: String(group.description).trim() } : {}),
      ...(group.sourceBucket ? { sourceBucket: group.sourceBucket } : {}),
      bookIds: [...new Set((group.bookIds || []).map(id => String(id).trim()).filter(Boolean))]
        .sort(sortText),
    }))
    .filter(group => {
      if (!group.id || !group.name || seenGroupIds.has(group.id)) return false;
      seenGroupIds.add(group.id);
      return true;
    })
    .sort((left, right) => sortText(left.name, right.name) || sortText(left.id, right.id));
}

/** Stable output for diffs, review, and eventual application by a separate step. */
export function canonicalizeTaxonomyReviewDraft(draft: TaxonomyReviewDraft): TaxonomyReviewDraft {
  return {
    schemaVersion: TAXONOMY_REVIEW_SCHEMA_VERSION,
    catalogFingerprint: String(draft.catalogFingerprint || "").trim(),
    // Keep collection overlap visible. The desk prevents new overlap by
    // default, but imported drift must never be silently discarded.
    collections: canonicalGroups(draft.collections || []),
    shelves: canonicalGroups(draft.shelves || []),
    topics: canonicalGroups(draft.topics || []),
    reviewBookIds: [...new Set((draft.reviewBookIds || []).map(id => String(id).trim()).filter(Boolean))]
      .sort(sortText),
  };
}

export function taxonomyGroupId(name: string, existingIds: Iterable<string>) {
  const base = String(name || "group")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "group";
  const used = new Set(existingIds);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
