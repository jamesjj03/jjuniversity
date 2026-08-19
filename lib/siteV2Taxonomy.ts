/**
 * Public catalog taxonomy authority.
 *
 * Shelves are the seven broad, single-choice homes used for the primary
 * catalog rail. Topics are the narrower, many-to-many filters. Collections
 * are deliberately not represented here.
 *
 * This layer is explicit so the public catalog does not turn manuscript
 * keyword matches into editorial claims. The legacy `tags` array remains
 * available to old routes, while Site V2 applies the reviewed corrections
 * below and one reviewed primary shelf per ready main-catalog book.
 */

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

export const SITE_V2_SHELF_BY_BOOK: Readonly<Record<string, SiteV2ShelfId>> = Object.freeze(
  Object.fromEntries(
    Object.entries(SITE_V2_SHELF_BOOK_IDS).flatMap(([shelfId, ids]) =>
      ids.map(id => [id, shelfId as SiteV2ShelfId]),
    ),
  ),
);

/**
 * Confirmed corrections from manuscript-title and chapter-structure review.
 * A complete array replaces the suspect record's topic list; it is not merged
 * with the unreliable enrichment output.
 */
export const SITE_V2_TOPIC_OVERRIDES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  astral: ["Psychology & Human Behavior", "Spirituality & Mysticism"],
  burr: ["American History", "American Politics", "Biography"],
  chakras: ["Eastern Philosophy & Religion", "Psychology & Human Behavior", "Religion & Spirituality", "Spirituality & Mysticism"],
  crust: ["Business & Economics", "Consumer Culture", "Cultural History", "Food & Culture"],
  disney: ["American History", "Business & Economics", "Capitalism & Corporations", "Consumer Culture"],
  fields: ["Physics & Cosmology", "Science & Mathematics", "Science History"],
  ford: ["20th Century", "American History", "Capitalism & Corporations", "Consumer Culture", "Technology & Innovation"],
  games: ["Business & Economics", "Consumer Culture", "Cultural History", "Digital Culture & Technology", "Technology & Innovation"],
  germany: ["20th Century", "Cold War", "European History", "War & Conflict", "World War II"],
  jackass: ["20th Century", "Consumer Culture", "Cultural History"],
  jackson: ["American History", "American Politics", "American Presidents", "Biography", "Government & Politics"],
  japan: ["Asian History", "Cultural History", "Military History", "War & Conflict", "World War II"],
  kaiser: ["20th Century", "Biography", "European History", "Government & Politics", "World War I"],
  king: ["American History", "Biography", "Civil Rights & Social Justice", "Social Movements"],
  liberated: ["Art & Music History", "Biography", "Cultural History", "Social Movements"],
  looped: ["Philosophy", "Psychology & Human Behavior"],
  nicotine: ["Addiction & Substance Use", "Biology & Medicine", "Capitalism & Corporations", "Consumer Culture", "Cultural History", "Public Health"],
  odds: ["Psychology & Human Behavior", "Science & Mathematics"],
  off: ["Business & Economics", "Capitalism & Corporations", "Conspiracy & Cover-ups", "Political Economy"],
  pixar: ["Art & Music History", "Cultural History", "Psychology & Human Behavior"],
  pregnancy: ["Biology & Medicine", "Psychology & Human Behavior", "Public Health"],
  psychology: ["Psychology & Human Behavior", "Science History"],
  quantum: ["20th Century", "Physics & Cosmology", "Science History"],
  rome: ["Ancient Civilizations", "Ancient Rome", "Government & Politics", "Military History", "War & Conflict"],
  scientology: ["20th Century", "Business & Economics", "Cults & Extremism", "Religion & Spirituality"],
  scisim: ["Biology & Medicine", "Physics & Cosmology", "Science & Mathematics"],
  tsar: ["Authoritarianism & Dictatorship", "Cold War", "Political Theory", "Russian History"],
  tyrants: ["20th Century", "Authoritarianism & Dictatorship", "Psychology & Human Behavior", "World War II"],
  van: ["Art & Music History", "Biography", "European History", "Psychology & Human Behavior"],
  vibes: ["Art & Music History", "Cultural History", "Digital Culture & Technology", "Psychology & Human Behavior"],
  warrens: ["20th Century", "Conspiracy & Cover-ups", "Psychology & Human Behavior", "Religion & Spirituality"],
  watchtower: ["Christianity", "Cults & Extremism", "Religion & Spirituality"],
  witches: ["American History", "Cultural History", "European History", "Propaganda & Social Control", "Religion & Spirituality"],
});

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
  return [...new Set((SITE_V2_TOPIC_OVERRIDES[book.id] || book.tags).filter(topic => APPROVED_TOPIC_SET.has(topic)))]
    .sort((a, b) => a.localeCompare(b));
}
