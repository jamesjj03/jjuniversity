import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const pathsFile = path.join(projectRoot, "public", "paths.json");
const booksFile = path.join(projectRoot, "private", "catalog", "books.json");
const printProductsFile = path.join(projectRoot, "public", "print-products.json");
const data = JSON.parse(fs.readFileSync(pathsFile, "utf8"));
const originalData = structuredClone(data);
const books = JSON.parse(fs.readFileSync(booksFile, "utf8"));
const printProducts = JSON.parse(fs.readFileSync(printProductsFile, "utf8"));
const knownBookIds = new Set(books.map((book) => String(book.id || "").trim().toLowerCase()).filter(Boolean));

function group(id) {
  const item = data.series.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing collection: ${id}`);
  return item;
}

function setBooks(id, ids) {
  const item = group(id);
  item.books = ids.map((bookId, index) => ({ id: bookId, order: index + 1, note: "" }));
  item.bookCount = item.books.length;
}

function setPathBooks(id, ids) {
  const item = data.paths.find(candidate => candidate.id === id);
  if (!item) throw new Error(`Missing collection: ${id}`);
  item.books = ids.map((bookId, index) => ({ id: bookId, order: index + 1, note: "" }));
  item.bookCount = item.books.length;
}

function setAliases(item, aliases) {
  item.aliases = [...new Set(aliases.map(alias => String(alias || "").trim().toLowerCase()).filter(Boolean))];
}

function slug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u02bc]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function upsertSeries(item, afterId) {
  const existingIndex = data.series.findIndex((candidate) => candidate.id === item.id);
  if (existingIndex >= 0) data.series.splice(existingIndex, 1);
  const afterIndex = data.series.findIndex((candidate) => candidate.id === afterId);
  const next = {
    ...item,
    kind: "series",
    type: "series",
    level: item.level || "intermediate",
    tags: item.tags || [],
    books: item.bookIds.map((id, index) => ({ id, order: index + 1, note: "" })),
    bookCount: item.bookIds.length,
    deleted: false,
  };
  delete next.bookIds;
  data.series.splice(afterIndex >= 0 ? afterIndex + 1 : data.series.length, 0, next);
}

const hitsAndHooks = group("high-society");
hitsAndHooks.title = "Hits and Hooks";
setAliases(hitsAndHooks, ["high-society"]);
hitsAndHooks.description = "Addiction, substances, dopamine loops, engineered cravings, and the products built to keep people coming back.";

const beliefMap = group("world-religions");
beliefMap.title = "The Belief Map";
setAliases(beliefMap, ["world-religions"]);
beliefMap.description = "Religious histories, movements, traditions, and the different maps people have used to explain existence.";

const questioners = group("the-philosophers");
questioners.title = "The Questioners";
setAliases(questioners, ["the-philosophers", "the-great-questions"]);
questioners.description = "Questions about ethics, mind, meaning, and reality, along with the people who refused easy answers.";

upsertSeries({
  id: "eyes-everywhere",
  title: "Eyes Everywhere",
  description: "The intelligence agencies built to watch, infiltrate, investigate, and operate beyond public view.",
  tags: ["Espionage & Intelligence", "Government & Politics", "Conspiracy & Cover-ups"],
  bookIds: ["cia", "fbi", "nsa", "mossad"],
}, "red-white-and-bruised");

upsertSeries({
  id: "the-mapmakers",
  title: "The Mapmakers",
  description: "Country and civilization portraits about how places are built, governed, remembered, and understood from the inside.",
  tags: ["World History", "Government & Politics", "Cultural History", "Geography"],
  bookIds: ["borders", "egypt", "rome", "germany", "japan", "insidechina", "northkorea", "cuba", "saudi", "antarctica"],
}, "eyes-everywhere");

const collectionMemberships = {
  "the-architects": ["thiel", "zuck", "musk", "jobs", "gates", "google", "bezos"],
  "the-code-breakers": ["franklin", "darwin", "galileo", "isaac", "tesla", "marie", "einstein", "planck", "feynman", "hawking", "freud", "jung"],
  "the-conquerors": ["ramses", "alexander", "caesar", "august", "charlemagne", "genghis", "tamerlane", "napoleon"],
  "the-tyrants": ["adolf", "mussolini", "stalin", "putin", "kim", "nero"],
  "god-struck": ["watts", "messiah", "muhammad", "lron", "buddha", "haile", "woke", "tmk"],
  "the-disruptors": ["luther", "malcolm", "king", "harriet", "gandhi", "voltaire", "lenin", "joan"],
  "world-religions": ["believe", "believers", "christianity", "buddhism", "islam", "jewish", "sikhism", "bahai", "zoro", "gods", "branches", "howbible", "popes", "reincarnation", "veil"],
  "the-philosophers": ["socrates", "plato", "aristotle", "niet", "spinoza", "aquinas", "confucius", "agency", "materialism", "descartes"],
  "red-white-and-bruised": ["1776", "columbus", "lobbied", "campus", "mkultra", "coups", "race", "rvb", "rewrite", "georgism", "elections", "electoral", "jesse"],
  "eyes-everywhere": ["cia", "fbi", "nsa", "mossad"],
  "the-mapmakers": ["borders", "egypt", "rome", "germany", "japan", "insidechina", "northkorea", "cuba", "saudi", "antarctica"],
  "the-system": ["gig", "insurance", "credit", "web", "bure", "audit", "pyramid", "corps", "fantasy", "aitakeover", "tiktok", "steam", "phone", "schooled", "dollar", "insideasylum"],
  "the-big-picture": ["pantheon", "pantheon2", "thinkers", "cult", "money", "condition", "presidents"],
  "the-noisemakers": ["kanye", "lennon", "mozart", "mike", "taylor", "vibes"],
  "the-creatives": ["burton", "fresco", "leonardo", "shake", "van", "theboys", "houdini", "orwell", "color", "lee"],
  "business-as-usual": ["nike", "nestle", "ford", "disney", "kfc", "nintendo", "purdue"],
  "under-the-hood": ["goo", "hardest", "cancer", "nuclear", "burgers", "bang", "relativity", "bees", "plants", "sleep", "pregnancy"],
  "the-social-code": ["imagination", "love", "rock", "cn", "hat", "heroes", "intelligence", "soaps", "sitcoms", "foreskin"],
  "high-society": ["addiction", "alcohol", "nicotine", "dietpop", "weed", "drugs", "caffeine", "biochemical", "dopamine"],
};
for (const [id, ids] of Object.entries(collectionMemberships)) setBooks(id, ids);

const orderedCollectionMemberships = {
  "101-the-core-courses": ["anatomy", "biology", "calculus", "chemistry", "economics", "electricity", "ethics", "government", "history", "math", "philosophy", "physics", "psychology", "quantum", "religion", "science"],
  "what-the-book-actually-says": ["bible", "bom", "dianetics", "gita", "guru", "kojiki", "quran", "talmud", "tao", "watchtower"],
  "exe-power-as-code": ["cyrus", "ham", "hochi", "humans", "mao", "marx", "nebu", "sargon", "tsar"],
  "commanders-in-chief": ["fdr", "george", "gwb", "jefferson", "jfk", "lincoln", "nixon", "obama", "reagan", "teddy", "jackson"],
  "calendar-chronicles": ["halloween", "xmas", "thanksgiving", "time", "holidays"],
};
for (const [id, ids] of Object.entries(orderedCollectionMemberships)) setPathBooks(id, ids);

const coreCourses = data.paths.find(item => item.id === "101-the-core-courses");
if (!coreCourses) throw new Error("Missing collection: 101-the-core-courses");

for (const item of [...data.series, ...(data.paths || [])]) {
  const ids = item.books.map((book) => String(book.id || "").trim().toLowerCase()).filter(Boolean);
  item.books = ids.map((id, index) => ({ id, order: index + 1, note: "" }));
  item.bookCount = item.books.length;
}

const errors = [];
const allCollections = [...data.series, ...(data.paths || [])];
const memberships = new Map();
const routeOwners = new Map();
for (const item of allCollections) {
  const ids = item.books.map((book) => book.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const missing = ids.filter((id) => !knownBookIds.has(id));
  const badOrder = item.books.filter((book, index) => Number(book.order) !== index + 1);
  if (item.bookCount !== ids.length) errors.push(`${item.id}: stored count mismatch`);
  if (duplicates.length) errors.push(`${item.id}: duplicate IDs ${[...new Set(duplicates)].join(", ")}`);
  if (missing.length) errors.push(`${item.id}: missing IDs ${missing.join(", ")}`);
  if (badOrder.length) errors.push(`${item.id}: non-contiguous order`);
  for (const id of ids) memberships.set(id, [...(memberships.get(id) || []), item.id]);

  const id = slug(item.id);
  const aliases = (item.aliases || []).map(slug).filter(Boolean);
  const is101 = id.includes("101") || /\b101\b/.test(item.title);
  const currentSlug = is101 ? "101" : aliases.length ? slug(item.title) : id;
  for (const key of new Set([currentSlug, id, ...aliases])) {
    const existingOwner = routeOwners.get(key);
    if (existingOwner && existingOwner !== item.id) errors.push(`${item.id}: route key ${key} collides with ${existingOwner}`);
    routeOwners.set(key, item.id);
  }
}
for (const [id, collectionIds] of memberships) {
  if (collectionIds.length > 1) errors.push(`${id}: belongs to multiple collections ${collectionIds.join(", ")}`);
}

const expectedRouteOwners = {
  "the-questioners": "the-philosophers",
  "the-great-questions": "the-philosophers",
  "the-philosophers": "the-philosophers",
  "hits-and-hooks": "high-society",
  "high-society": "high-society",
  "the-belief-map": "world-religions",
  "world-religions": "world-religions",
  "the-mapmakers": "the-mapmakers",
  "101": "101-the-core-courses",
};
for (const [key, expectedOwner] of Object.entries(expectedRouteOwners)) {
  if (routeOwners.get(key) !== expectedOwner) errors.push(`${key}: expected route owner ${expectedOwner}, found ${routeOwners.get(key) || "none"}`);
}

const printSet = printProducts.find(product => product.slug === "101-set");
const coreCourseIds = new Set(coreCourses.books.map(book => book.id));
const printSetIds = new Set((printSet?.bookIds || []).map(id => String(id).trim().toLowerCase()).filter(Boolean));
if (!printSet || coreCourseIds.size !== printSetIds.size || [...coreCourseIds].some(id => !printSetIds.has(id))) {
  errors.push("101-the-core-courses: membership no longer matches the unchanged 101-set print product");
}
if (errors.length) throw new Error(errors.join("\n"));

data.counts.series = data.series.length;
data.counts.paths = (data.paths || []).length;
data.counts.collectionAssignments = [...memberships.values()].reduce((sum, items) => sum + items.length, 0);
data.counts.collectionBooks = memberships.size;
const comparable = (value) => {
  const copy = structuredClone(value);
  delete copy.correctionsAppliedAt;
  return JSON.stringify(copy);
};
const changed = comparable(data) !== comparable(originalData);
data.correctionsAppliedAt = changed
  ? new Date().toISOString()
  : originalData.correctionsAppliedAt;

if (!process.argv.includes("--check")) {
  fs.writeFileSync(pathsFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const assignments = allCollections.reduce((sum, item) => sum + item.books.length, 0);
console.log(JSON.stringify({
  collections: data.series.length,
  readingPaths: (data.paths || []).length,
  groups: data.series.length + (data.paths || []).length,
  assignments,
  uniqueBooks: memberships.size,
  overlappingBooks: 0,
  validationErrors: errors.length,
  changed,
  checkOnly: process.argv.includes("--check"),
}, null, 2));
