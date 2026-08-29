/**
 * Public catalog taxonomy authority.
 *
 * Shelves are seven broad, overlapping discovery lenses used for the primary
 * catalog rail. Topics are the narrower, many-to-many filters. Collections
 * are deliberately not represented here; they are the optional zero-or-one
 * editorial group used for print and authored series.
 *
 * This layer is explicit so the public catalog does not turn manuscript
 * keyword matches into editorial claims. The legacy `tags` array remains
 * available to old routes, while Site V2 reads Topics only from the complete
 * per-book authority document. A book may have any number of overlapping
 * Topics and may appear on every broad Shelf that genuinely fits.
 */

import topicAuthoritySource from "@/private/catalog/topic-authority.json";
import { PRIMARY_CATEGORIES } from "@/lib/taxonomy";

export type SiteV2ShelfId =
  | "history-civilization"
  | "power-politics-war"
  | "science-nature"
  | "mind-behavior"
  | "religion-philosophy"
  | "culture-media-technology"
  | "money-work-systems";

export const SITE_V2_APPROVED_TOPICS = Object.freeze(
  [...new Set(PRIMARY_CATEGORIES.flatMap(category => category.tags))].sort((a, b) => a.localeCompare(b)),
);

const APPROVED_TOPIC_SET = new Set<string>(SITE_V2_APPROVED_TOPICS);

const TOPIC_AUTHORITY_SCHEMA_VERSION = 1;

type TopicAuthorityDocument = {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  topicsByBook: Record<string, string[]>;
};

function loadBundledTopicAuthority(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The bundled Topic authority is not an object.");
  }
  const record = value as Partial<TopicAuthorityDocument>;
  if (record.schemaVersion !== TOPIC_AUTHORITY_SCHEMA_VERSION) {
    throw new Error(`The bundled Topic authority schema is not supported (${String(record.schemaVersion)}).`);
  }
  if (!Number.isSafeInteger(record.revision) || Number(record.revision) < 1) {
    throw new Error("The bundled Topic authority has no valid revision.");
  }
  if (typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) {
    throw new Error("The bundled Topic authority has no valid update timestamp.");
  }
  if (!record.topicsByBook || typeof record.topicsByBook !== "object" || Array.isArray(record.topicsByBook)) {
    throw new Error("The bundled Topic authority has no per-book map.");
  }

  const topicsByBook: Record<string, readonly string[]> = {};
  for (const [rawBookId, rawTopics] of Object.entries(record.topicsByBook)) {
    const bookId = rawBookId.trim().toLowerCase();
    if (!bookId || rawBookId !== bookId || !/^[a-z0-9][a-z0-9_-]*$/.test(bookId)) {
      throw new Error(`The bundled Topic authority has an invalid book id: ${rawBookId}.`);
    }
    if (!Array.isArray(rawTopics)) {
      throw new Error(`The bundled Topic authority entry for ${bookId} is not an array.`);
    }
    const topics = rawTopics.map(topic => String(topic).trim());
    if (topics.some(topic => !APPROVED_TOPIC_SET.has(topic))) {
      throw new Error(`The bundled Topic authority entry for ${bookId} contains an unapproved Topic.`);
    }
    if (new Set(topics).size !== topics.length) {
      throw new Error(`The bundled Topic authority entry for ${bookId} contains duplicate Topics.`);
    }
    topicsByBook[bookId] = Object.freeze([...topics].sort((a, b) => a.localeCompare(b)));
  }

  return Object.freeze({
    revision: record.revision,
    topicsByBook: Object.freeze(topicsByBook),
  });
}

const SITE_V2_TOPIC_AUTHORITY = loadBundledTopicAuthority(topicAuthoritySource);

export const SITE_V2_TOPIC_AUTHORITY_REVISION = SITE_V2_TOPIC_AUTHORITY.revision;

export const SITE_V2_SHELF_BOOK_IDS: Record<SiteV2ShelfId, readonly string[]> = {
  "history-civilization": [
    "egypt", "franklin", "germany", "haile", "history", "humans", "japan",
    "mansu", "rome", "thanksgiving", "witches",
  ],
  "power-politics-war": [
    "1776", "adolf", "alexander", "antisem", "banned", "borders", "bure",
    "burr", "caesar", "charlemagne", "churchill", "cia", "columbus",
    "communism", "congo", "control", "coups", "crusades", "cuba", "cyrus",
    "echoes", "elections", "fbi", "fdr", "genghis", "george", "government",
    "ham", "harriet", "heads", "hiddenhand", "hochi", "inquis", "insidechina", "jackson",
    "jeff", "jefferson", "jesse", "jfk", "joan", "kaiser", "kim", "king",
    "lenin", "lincoln", "lobbied", "malcolm", "mao", "mossad", "mussolini",
    "napoleon", "nebu", "nixon", "northkorea", "nsa", "obama", "presidents",
    "putin", "race", "ramses", "rasputin", "reagan", "revolution", "rewrite",
    "rvb", "sargon", "saudi", "schooled", "stalin", "tamerlane", "teddy",
    "tsar", "tyrants", "vic", "ww1", "wu", "nero",
  ],
  "science-nature": [
    "anatomy", "antarctica", "biology", "burgers", "calculus", "cancer",
    "chemistry", "darwin", "dayton", "edison", "einstein", "electricity",
    "fields", "foreskin", "galileo", "goo", "hardest", "hawking", "isaac",
    "math", "nuclear", "odds", "physics", "planck", "plastic", "pregnancy",
    "quantum", "science", "scisim", "tesla", "thinkers", "time", "warming",
  ],
  "mind-behavior": [
    "addiction", "agency", "alcohol", "aliens", "biochemical", "bluecollar", "caffeine",
    "condition", "dietpop", "dopamine", "drugs", "fantasy", "freud", "heroes",
    "imagination", "insideasylum", "intelligence", "jung", "looped", "love", "myths",
    "nicotine", "poker", "psychology", "sleep", "tmk", "weed",
  ],
  "religion-philosophy": [
    "amish", "aquinas", "aristotle", "astral", "bahai", "believe", "believers",
    "bible", "bom", "branches", "buddha", "buddhism", "chakras", "confucius",
    "cult", "descartes", "dianetics", "doubt", "ethics", "gita", "gods",
    "guru", "howbible", "islam", "jewish", "jw", "kabbalah", "kojiki", "lron",
    "luther", "materialism", "messiah", "mormon", "muhammad", "nagham", "niet",
    "pantheon", "pantheon2", "philosophy", "plato", "quran", "reincarnation",
    "religion", "sacredgeo", "scientology", "sikhism", "socrates", "talmud",
    "tao", "tribes", "veil", "voltaire", "warrens", "watchtower", "watts", "woke", "zoro",
  ],
  "culture-media-technology": [
    "ai", "aitakeover", "burton", "cn", "color", "crust", "games", "halloween",
    "holidays", "jackass", "kanye", "lee", "lennon", "leonardo", "liberated",
    "lunchtime", "mike", "mozart", "orwell", "pixar", "rock", "shake", "soaps",
    "steam", "taylor", "theboys", "tiktok", "tom", "van", "vibes", "xmas",
  ],
  "money-work-systems": [
    "bezos", "campus", "corps", "credit", "d2d", "disney", "dollar",
    "economics", "ford", "gates", "georgism", "gig", "google", "insurance",
    "jobs", "kfc", "marx", "money", "musk", "nestle", "nike", "nintendo",
    "off", "purdue", "pyramid", "soros", "thiel", "web", "zuck",
  ],
};

export const SITE_V2_SHELF_IDS_BY_BOOK: Readonly<Record<string, readonly SiteV2ShelfId[]>> = Object.freeze(
  Object.entries(SITE_V2_SHELF_BOOK_IDS).reduce<Record<string, SiteV2ShelfId[]>>((result, [shelfId, ids]) => {
    ids.forEach(id => {
      result[id] = [...(result[id] || []), shelfId as SiteV2ShelfId];
    });
    return result;
  }, {}),
);

/**
 * Book ids that still need human editorial review. The authority document
 * remains the sole source of current assignments while that review happens.
 */
export const SITE_V2_TAXONOMY_REVIEW_IDS = [
  "biochemical",
  "bure",
  "cancer",
  "color",
  "foreskin",
  "haile",
  "hiddenhand",
  "materialism",
  "myths",
  "pantheon2",
  "poker",
  "rock",
  "saudi",
  "schooled",
  "tmk",
] as const;

export function siteV2TopicsForBook(book: { id: string; tags: readonly string[] }) {
  const bookId = String(book.id || "").trim().toLowerCase();
  return [...(SITE_V2_TOPIC_AUTHORITY.topicsByBook[bookId] || [])];
}
