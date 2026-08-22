import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  bookDisclaimerConfigPath,
  coveredDisclaimerSignals,
  listBookDisclaimerReviews,
  listPrintDisclaimerProfiles,
  printDisclaimerConfigPath,
  resolvePrintProductDisclaimerPlan,
} from "./print-disclaimer-system.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const strict = args.includes("--strict");
const requestedProduct = valueArg("--product");
const books = readJson(resolve(root, "public", "books.json")).map(normalizeBook).filter(book => book.id);
const products = readJson(resolve(root, "public", "print-products.json"));
const contentManifest = readJson(resolve(root, "public", "book-content", "manifest.json"));

const signalRules = [
  {
    id: "accuracy",
    source: "all",
    pattern: /\b(accuracy|accurate|errors?|omissions?|outdated|attribution|interpretation|completeness|factual|historical records?)\b/i,
  },
  {
    id: "general-education",
    source: "all",
    pattern: /\b(educational|informational|general audiences?|academic|professional advice|formal textbook|instruction)\b/i,
  },
  {
    id: "science-technical-safety",
    source: "all",
    pattern: /\b(chemistry|chemical|electricity|electrical|physics|laboratory|experiment|explosion|injury|technical manual|engineering|equipment)\b/i,
  },
  {
    id: "health-mental-health",
    source: "all",
    pattern: /\b(medical|medicine|health|doctor|diagnos(?:is|e)|treat(?:ment)?|therapy|mental health|psycholog|anatomy|pregnan|cancer|clinical)\b/i,
  },
  {
    id: "legal-financial",
    source: "metadata",
    pattern: /\b(legal advice|financial advice|investment|investor|tax(?:es)?|economics|markets?|gambling|government|law|policy)\b/i,
  },
  {
    id: "affiliation-trademark",
    source: "all",
    pattern: /\b(not affiliated|not associated|not authorized|not endorsed|trademarks?|brands?|companies?|corporations?|organizations?|institutions?)\b/i,
  },
  {
    id: "public-person-commentary",
    source: "all",
    pattern: /\b(unauthorized biography|public figures?|living persons?|real people|not intended to defame|defamation|allegations?)\b/i,
  },
  {
    id: "historical-interpretive",
    source: "all",
    pattern: /\b(historical|history|religion|religious|philosoph|ethics|politic|interpretation|perspective|commentary|critique|analysis)\b/i,
  },
  {
    id: "satire-fiction-dramatization",
    source: "all",
    pattern: /\b(satire|satirical|parody|fiction|fictional|dramatiz|composite scenes?|resemblance|creative nonfiction|interior thoughts?)\b/i,
  },
  {
    id: "substances-risky-activity",
    source: "all",
    pattern: /\b(drugs?|substances?|alcohol|weapons?|crime|illegal activity|self-harm|dangerous activity)\b/i,
  },
  {
    id: "religion-spirituality",
    source: "all",
    pattern: /\b(religion|religious|spiritual|theolog|faith|church|denomination|doctrine)\b/i,
  },
  {
    id: "third-party-materials",
    source: "disclaimer",
    pattern: /\b(fair use|public domain|third-party|lyrics?|images?|photographs?|quoted material|citations?)\b/i,
  },
];

const unsupportedLegalClaimRules = [
  {
    id: "blanket-fair-use-claim",
    pattern: /\bfair use\b/i,
  },
  {
    id: "no-infringement-slogan",
    pattern: /\bno copyright infringement intended\b/i,
  },
  {
    id: "blanket-first-amendment-claim",
    pattern: /\bprotected (?:under|by) the first amendment\b/i,
  },
];

const bookAudits = books.map(auditBook);
const manifestBookAudits = (contentManifest.books || []).map(auditManifestBook);
const booksById = new Map(bookAudits.map(item => [item.bookId, item]));
const readyMainBooks = books.filter(book => book.status === "ready" && book.visibility === "main" && !book.archive);
const explicitBookReviews = listBookDisclaimerReviews();
const explicitlyReviewedBookIds = new Set(explicitBookReviews.map(review => review.bookId));
const selectedProducts = products.filter(product => !requestedProduct || product.slug === requestedProduct);

if (requestedProduct && selectedProducts.length === 0) {
  fail(`Unknown print product "${requestedProduct}".`);
}

const productAudits = selectedProducts.map(auditProduct);
const errors = productAudits.flatMap(item => item.errors.map(message => `${item.slug}: ${message}`));
const warnings = productAudits.flatMap(item => item.warnings.map(message => `${item.slug}: ${message}`));
const riskyCorpusBooks = manifestBookAudits.filter(item => item.unsupportedLegalClaims.length);
const corpusSignalCounts = Object.fromEntries(signalRules.map(rule => [
  rule.id,
  manifestBookAudits.filter(book => book.signals.includes(rule.id)).length,
]));

const report = {
  schemaVersion: 1,
  source: {
    profileConfig: relativePath(printDisclaimerConfigPath),
    bookProfileConfig: relativePath(bookDisclaimerConfigPath),
    books: "public/books.json",
    contentManifest: "public/book-content/manifest.json",
    products: "public/print-products.json",
  },
  profiles: listPrintDisclaimerProfiles().map(profile => ({
    id: profile.id,
    coversSignals: profile.coversSignals,
  })),
  corpus: {
    catalogRows: bookAudits.length,
    readyMainBooks: readyMainBooks.length,
    readyMainBooksWithExplicitPrintProfiles: readyMainBooks.filter(book => explicitlyReviewedBookIds.has(book.id)).length,
    readyMainBooksPendingExplicitPrintProfiles: readyMainBooks.filter(book => !explicitlyReviewedBookIds.has(book.id)).map(book => book.id),
    extractedBooksAudited: manifestBookAudits.length,
    catalogRowsWithoutExtractedContent: bookAudits.filter(item => item.missingContent).map(item => item.bookId),
    booksWithDisclaimerSections: manifestBookAudits.filter(item => item.disclaimerSectionCount > 0).length,
    booksWithUnsupportedLegalClaims: riskyCorpusBooks.length,
    signalCounts: corpusSignalCounts,
    unsupportedLegalClaims: riskyCorpusBooks.map(item => ({
      bookId: item.bookId,
      title: item.title,
      claims: item.unsupportedLegalClaims,
    })),
  },
  products: productAudits,
  summary: {
    errors: errors.length,
    warnings: warnings.length,
  },
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Print disclaimer audit: ${report.corpus.extractedBooksAudited} extracted books from ${report.corpus.catalogRows} catalog rows / ${report.corpus.booksWithDisclaimerSections} with disclaimer sections / ${report.corpus.booksWithUnsupportedLegalClaims} with unsupported blanket legal claims`);
  console.log(`Ready-main print profiling: ${report.corpus.readyMainBooksWithExplicitPrintProfiles} of ${report.corpus.readyMainBooks} explicit / ${report.corpus.readyMainBooksPendingExplicitPrintProfiles.length} pending`);
  for (const product of productAudits) {
    console.log(`${product.slug}: ${product.profileIds.length} profiles / ${product.signals.length} source signals / ${product.errors.length} errors / ${product.warnings.length} warnings`);
  }
  for (const message of errors) console.error(`ERROR ${message}`);
  for (const message of warnings) console.warn(`WARN ${message}`);
}

if (errors.length || (strict && warnings.length)) process.exitCode = 1;

function auditBook(book) {
  const contentPath = resolveContentPath(book, { required: false });
  if (!contentPath) {
    return {
      bookId: book.id,
      title: book.title,
      contentPath: "",
      missingContent: true,
      disclaimerSectionCount: 0,
      signals: [],
      unsupportedLegalClaims: [],
    };
  }

  return auditContent({
    bookId: book.id,
    title: book.title,
    subtitle: book.subtitle,
    description: book.description,
    contentPath,
  });
}

function auditManifestBook(record) {
  const contentPath = resolve(root, "public", "book-content", basename(record.path || ""));
  const wanted = new Set([
    fileStem(record.id),
    fileStem(record.slug),
    fileStem(record.sourceFile),
    fileStem(record.title),
    fileStem(basename(record.path || "")),
  ].filter(Boolean));
  const catalogBook = books.find(book => wanted.has(fileStem(book.id))
    || wanted.has(fileStem(book.slug))
    || wanted.has(fileStem(book.bookFile))
    || wanted.has(fileStem(book.title)));

  return auditContent({
    bookId: String(record.slug || record.id || basename(record.path || "")).trim().toLowerCase(),
    title: String(record.title || catalogBook?.title || record.id || "Untitled").trim(),
    subtitle: catalogBook?.subtitle || "",
    description: catalogBook?.description || "",
    contentPath,
  });
}

function auditContent({ bookId, title, subtitle, description, contentPath }) {
  const content = readJson(contentPath);
  const disclaimerSections = (content.sections || []).filter(isDisclaimerSection);
  const disclaimerText = disclaimerSections.map(sectionText).join(" ");
  const metadataText = [title, subtitle, description].join(" ");
  const discoveryText = `${metadataText} ${disclaimerText}`;

  return {
    bookId,
    title,
    contentPath: relativePath(contentPath),
    missingContent: false,
    disclaimerSectionCount: disclaimerSections.length,
    signals: signalRules.filter(rule => {
      const candidate = rule.source === "metadata"
        ? metadataText
        : rule.source === "disclaimer"
          ? disclaimerText
          : discoveryText;
      return rule.pattern.test(candidate);
    }).map(rule => rule.id),
    unsupportedLegalClaims: unsupportedLegalClaimRules
      .filter(rule => rule.pattern.test(disclaimerText))
      .map(rule => rule.id),
  };
}

function auditProduct(product) {
  const errors = [];
  const warnings = [];
  const bookIds = Array.isArray(product.bookIds) ? product.bookIds.map(value => String(value || "").trim().toLowerCase()).filter(Boolean) : [];
  const bookRecords = bookIds.map(bookId => booksById.get(bookId)).filter(Boolean);
  const missingBookIds = bookIds.filter(bookId => !booksById.has(bookId) || booksById.get(bookId).missingContent);
  const declaredProfileIds = Array.isArray(product.disclaimerProfileIds) ? product.disclaimerProfileIds : [];
  let profileIds = [];
  let disclaimerPlan = null;
  let coveredSignals = new Set();

  if (missingBookIds.length) errors.push(`missing source books: ${missingBookIds.join(", ")}`);

  try {
    disclaimerPlan = resolvePrintProductDisclaimerPlan(product, bookRecords.map(book => ({ id: book.bookId, title: book.title })));
    profileIds = disclaimerPlan.profileIds;
    coveredSignals = coveredDisclaimerSignals(profileIds, { productSlug: product.slug });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const signals = [...new Set(bookRecords.flatMap(book => book.signals))].sort();
  const uncoveredSignals = signals.filter(signal => !coveredSignals.has(signal));

  const unsupportedLegalClaims = [...new Set(bookRecords.flatMap(book => book.unsupportedLegalClaims))].sort();
  const reviewStatus = String(product.publicationReview?.status || "").trim();
  const isSaleEnabled = !["not-for-sale", "disabled", ""].includes(String(product.salesStatus || "").trim());

  if (unsupportedLegalClaims.length && reviewStatus !== "approved") {
    const message = `source notices contain ${unsupportedLegalClaims.join(", ")}; final excerpts and rights must be reviewed because a disclaimer does not establish legality`;
    if (isSaleEnabled) errors.push(message);
    else warnings.push(message);
  }

  if (isSaleEnabled && reviewStatus !== "approved") {
    errors.push("sales are enabled without publicationReview.status=approved");
  }

  if (uncoveredSignals.length) {
    const message = `source signals still need explicit profile review: ${uncoveredSignals.join(", ")}`;
    if (isSaleEnabled) errors.push(message);
    else warnings.push(message);
  }

  return {
    slug: String(product.slug || "").trim(),
    kind: String(product.kind || "collection").trim(),
    salesStatus: String(product.salesStatus || "").trim(),
    publicationReviewStatus: reviewStatus,
    bookCount: bookIds.length,
    declaredProfileIds,
    profileIds,
    bookReviews: disclaimerPlan?.bookReviews || [],
    signals,
    uncoveredSignals,
    unsupportedLegalClaims,
    errors,
    warnings,
  };
}

function isDisclaimerSection(section) {
  const title = String(section?.title || "").trim();
  const kind = String(section?.kind || "").trim();
  return /copyright|disclaim|legal notice/i.test(`${title} ${kind}`);
}

function sectionText(section) {
  return String(section?.text || section?.html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveContentPath(book, { required = true } = {}) {
  const wanted = new Set([fileStem(book.id), fileStem(book.bookFile), fileStem(book.title)].filter(Boolean));
  const record = (contentManifest.books || []).find(item => wanted.has(fileStem(item.id))
    || wanted.has(fileStem(item.slug))
    || wanted.has(fileStem(item.sourceFile))
    || wanted.has(fileStem(basename(item.path || ""))));
  if (!record?.path) {
    if (required) fail(`No content JSON found for ${book.id}.`);
    return "";
  }
  return resolve(root, "public", "book-content", basename(record.path));
}

function normalizeBook(raw) {
  return {
    id: String(raw.id || "").trim().toLowerCase(),
    slug: String(raw.slug || "").trim().toLowerCase(),
    title: String(raw.title || raw.id || "Untitled").trim(),
    subtitle: String(raw.subtitle || "").trim(),
    description: String(raw.description || "").trim(),
    bookFile: String(raw.bookFile || "").trim(),
    status: String(raw.status || "").trim().toLowerCase(),
    visibility: String(raw.visibility || "").trim().toLowerCase(),
    archive: Boolean(raw.archive),
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fileStem(value) {
  return String(value || "").replace(/\.(json|epub|jpg|jpeg|png|webp)$/i, "").trim().toLowerCase();
}

function relativePath(path) {
  return resolve(path).replace(`${root}\\`, "").replaceAll("\\", "/");
}

function valueArg(name) {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1).trim() : "";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
