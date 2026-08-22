import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const printDisclaimerConfigPath = resolve(moduleDirectory, "..", "config", "print-disclaimer-profiles.json");
export const bookDisclaimerConfigPath = resolve(moduleDirectory, "..", "config", "book-disclaimer-profiles.json");

const config = JSON.parse(readFileSync(printDisclaimerConfigPath, "utf8"));
const bookConfig = JSON.parse(readFileSync(bookDisclaimerConfigPath, "utf8"));

if (config.schemaVersion !== 1 || !Array.isArray(config.profiles) || bookConfig.schemaVersion !== 1 || !bookConfig.books) {
  throw new Error("Unsupported or malformed print disclaimer profile configuration.");
}

const profilesById = new Map();

for (const rawProfile of config.profiles) {
  const profile = normalizeProfile(rawProfile);
  if (profilesById.has(profile.id)) {
    throw new Error(`Duplicate print disclaimer profile "${profile.id}".`);
  }
  profilesById.set(profile.id, profile);
}

export function listPrintDisclaimerProfiles() {
  return [...profilesById.values()].map(cloneProfile);
}

export function listBookDisclaimerReviews() {
  return Object.entries(bookConfig.books).map(([bookId, rawReview]) => ({
    bookId: String(bookId || "").trim().toLowerCase(),
    reviewStatus: String(rawReview?.reviewStatus || "").trim(),
    profileIds: resolvePrintDisclaimerProfiles(rawReview?.profileIds, { productSlug: `book review ${bookId}` }).map(profile => profile.id),
  }));
}

export function resolvePrintDisclaimerProfiles(profileIds, { productSlug = "print product" } = {}) {
  if (!Array.isArray(profileIds) || profileIds.length === 0) {
    throw new Error(`${productSlug} must declare at least one disclaimerProfileId.`);
  }

  const normalizedIds = profileIds.map(value => String(value || "").trim()).filter(Boolean);
  const duplicateIds = normalizedIds.filter((id, index) => normalizedIds.indexOf(id) !== index);

  if (duplicateIds.length) {
    throw new Error(`${productSlug} repeats disclaimer profile(s): ${[...new Set(duplicateIds)].join(", ")}.`);
  }

  const unknownIds = normalizedIds.filter(id => !profilesById.has(id));
  if (unknownIds.length) {
    throw new Error(`${productSlug} declares unknown disclaimer profile(s): ${unknownIds.join(", ")}.`);
  }

  return normalizedIds.map(id => cloneProfile(profilesById.get(id)));
}

export function coveredDisclaimerSignals(profileIds, options) {
  return new Set(resolvePrintDisclaimerProfiles(profileIds, options).flatMap(profile => profile.coversSignals));
}

export function resolvePrintProductDisclaimerPlan(product, productBooks) {
  const productSlug = String(product?.slug || "print product").trim();
  const productWideProfiles = resolvePrintDisclaimerProfiles(product?.disclaimerProfileIds, { productSlug });
  const normalizedBooks = Array.isArray(productBooks)
    ? productBooks.map(book => ({
      id: String(book?.id || "").trim().toLowerCase(),
      title: String(book?.title || book?.id || "Untitled").trim(),
    })).filter(book => book.id)
    : [];

  if (!normalizedBooks.length) {
    throw new Error(`${productSlug} has no books for disclaimer planning.`);
  }

  const bookReviews = normalizedBooks.map(book => {
    const rawReview = bookConfig.books[book.id];
    if (!rawReview) {
      throw new Error(`${productSlug} includes ${book.id}, which has no explicit book disclaimer profile review.`);
    }

    const profiles = resolvePrintDisclaimerProfiles(rawReview.profileIds, { productSlug: `${productSlug}/${book.id}` });
    const reviewStatus = String(rawReview.reviewStatus || "").trim();
    if (!reviewStatus) {
      throw new Error(`${productSlug}/${book.id} has no disclaimer reviewStatus.`);
    }

    return { ...book, reviewStatus, profiles };
  });

  const salesStatus = String(product?.salesStatus || "").trim();
  const saleEnabled = !["", "not-for-sale", "disabled"].includes(salesStatus);
  const publicationReviewStatus = String(product?.publicationReview?.status || "").trim();

  if (saleEnabled && publicationReviewStatus !== "approved") {
    throw new Error(`${productSlug} cannot enable sales without publicationReview.status=approved.`);
  }

  const unapprovedBooks = bookReviews.filter(book => book.reviewStatus !== "approved");
  if (saleEnabled && unapprovedBooks.length) {
    throw new Error(`${productSlug} cannot enable sales while book disclaimer reviews remain unapproved: ${unapprovedBooks.map(book => book.id).join(", ")}.`);
  }

  const blocks = productWideProfiles.map(profile => ({
    ...profile,
    scope: "publication",
    appliesToBookIds: [],
    appliesToTitles: [],
  }));
  const publicationProfileIds = new Set(productWideProfiles.map(profile => profile.id));

  for (const book of bookReviews) {
    for (const profile of book.profiles) {
      if (publicationProfileIds.has(profile.id)) continue;
      let block = blocks.find(item => item.id === profile.id);
      if (!block) {
        block = {
          ...profile,
          scope: "work-specific",
          appliesToBookIds: [],
          appliesToTitles: [],
        };
        blocks.push(block);
      }
      block.appliesToBookIds.push(book.id);
      block.appliesToTitles.push(book.title);
    }
  }

  return {
    productSlug,
    salesStatus,
    publicationReviewStatus,
    profileIds: blocks.map(block => block.id),
    blocks,
    bookReviews: bookReviews.map(book => ({
      id: book.id,
      title: book.title,
      reviewStatus: book.reviewStatus,
      profileIds: book.profiles.map(profile => profile.id),
    })),
  };
}

function normalizeProfile(rawProfile) {
  const id = String(rawProfile?.id || "").trim();
  const heading = String(rawProfile?.heading || "").trim();
  const paragraphs = Array.isArray(rawProfile?.paragraphs)
    ? rawProfile.paragraphs.map(value => String(value || "").trim()).filter(Boolean)
    : [];
  const coversSignals = Array.isArray(rawProfile?.coversSignals)
    ? rawProfile.coversSignals.map(value => String(value || "").trim()).filter(Boolean)
    : [];

  if (!id || !heading || !paragraphs.length || !coversSignals.length) {
    throw new Error(`Malformed print disclaimer profile "${id || "unknown"}".`);
  }

  return { id, heading, paragraphs, coversSignals };
}

function cloneProfile(profile) {
  return {
    ...profile,
    paragraphs: [...profile.paragraphs],
    coversSignals: [...profile.coversSignals],
  };
}
