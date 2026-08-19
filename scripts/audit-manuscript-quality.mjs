import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

const { loadEnvConfig } = nextEnv;
const root = process.cwd();
const batchId = argValue("--batch") || "20260818T201302Z-547f3c7dfb14";
const batchDir = resolve(root, "tmp", "manuscript-bold-removal", batchId);
const outputRoot = resolve(root, "tmp", "manuscript-quality-audit");
const proseTags = new Set(["p", "li", "blockquote", "td", "th", "dd", "dt", "figcaption"]);
const voidTags = new Set(["br", "hr", "img", "meta", "link", "input", "source", "wbr"]);
const exactBackPattern = /^(acknowledg(e)?ments?|about( the)? author|copyright( disclaimer)?|back matter)$/;
const standardBodyTitlePattern = /^(chapter\b|part\b|book\b|section\b|introduction\b|prologue\b|interlude\b|epilogue\b|conclusion\b|afterword\b|appendix\b)/;
const knownAcronyms = new Set([
  "ADHD", "AI", "AIDS", "AR", "CEO", "CIA", "COVID", "DNA", "EU", "FBI", "FDA", "GDP", "GPS",
  "HIV", "IQ", "IRS", "KGB", "ML", "NASA", "NATO", "NSA", "PC", "PTSD", "RNA", "TV", "UFO",
  "UK", "UN", "US", "USA", "USSR", "VR", "WWI", "WWII",
]);

await main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  loadEnvConfig(root);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Supabase admin configuration is unavailable.");

  const seal = await verifySealedBatch(batchDir);
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const liveRows = await fetchAllRows(supabase, "book_content_live", "book_id");
  const historyRows = await fetchAllRows(supabase, "book_content_versions", "book_id");
  const originalRows = await readJsonDirectory(join(batchDir, "backup", "live-current"));
  const candidateRows = await readJsonDirectory(join(batchDir, "dry-run", "transformed-live-current"));
  const fallback = await readLocalFallback();

  if (liveRows.length !== 287 || originalRows.length !== 287 || candidateRows.length !== 287 || fallback.rows.length !== 287) {
    throw new Error(`Unexpected corpus size: live=${liveRows.length}, original=${originalRows.length}, candidates=${candidateRows.length}, fallback=${fallback.rows.length}`);
  }

  const corpus = buildCorpus(liveRows);
  const caseReferences = buildCaseReferences(corpus.bodySections);
  const caps = auditInitialCaps(corpus.bodySections, caseReferences);
  const lists = auditLists(corpus.bodySections);
  const formatting = auditFormatting(corpus.bodySections);
  const preservation = auditPreservation({ liveRows, originalRows, candidateRows, fallback, historyRows });

  if (preservation.validationFailureCount) {
    throw new Error(`Cleanup preservation validation failed in ${preservation.validationFailureCount} place(s).`);
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      projectRef: projectRefFromUrl(url),
      liveRows: liveRows.length,
      fallbackBooks: fallback.rows.length,
      sections: corpus.allSections.length,
      bodySections: corpus.bodySections.length,
      frontSections: corpus.frontSections.length,
      backSections: corpus.backSections.length,
      sourceFingerprintSha256: computeSourceFingerprint(liveRows),
      sealedBaselineBatchId: batchId,
      sealedBaselineManifestSha256: seal.manifestSha256,
      readOnly: true,
    },
    initialCaps: caps,
    lists,
    formatting,
    cleanupPreservation: preservation,
    recommendations: {
      caps: [
        "Do not sentence-case every uppercase prefix blindly. The source case is absent in most styled prefixes, and acronyms, names, numerals, apostrophes, and hyphenated forms create real ambiguity.",
        "Auto-approve only CSS-uppercase prefixes whose underlying text already contains lowercase and therefore preserves its intended case when the CSS declaration is removed.",
        "For literal uppercase prefixes, generate proposed replacements from section context and corpus case references, then require human approval for every section before a write.",
      ],
      lists: [
        "Keep semantic ul, ol, and li structures by default. Review visual density, labels, and pseudo-list paragraphs separately.",
        "Prioritize sections with nested lists, very high item counts, bullet-character paragraphs, numbered pseudo-lists, tables, and multi-line br-delimited blocks.",
        "Do not flatten lists globally. List semantics are useful for accessibility and print generation, while some pseudo-lists may need conversion after visual review.",
      ],
    },
  };

  const outputDir = join(outputRoot, timestampId());
  await mkdir(outputRoot, { recursive: true });
  await mkdir(outputDir, { recursive: false });
  const reportPath = join(outputDir, "report.json");
  const capsCsvPath = join(outputDir, "caps-review.csv");
  const listsCsvPath = join(outputDir, "lists-review.csv");
  const outliersCsvPath = join(outputDir, "formatting-outliers.csv");
  await writeOnce(reportPath, stableJson(report));
  await writeOnce(capsCsvPath, makeCsv(caps.sections, [
    "bookId", "bookTitle", "sectionId", "index", "sectionTitle", "kind", "mechanism", "sourceCasing",
    "prefixWordCount", "prefixText", "safeCssOnly", "riskLevel", "riskFlags", "referenceSuggestions",
    "acronymTokens", "properNounTokens", "unresolvedTokens",
  ]));
  await writeOnce(listsCsvPath, makeCsv(lists.sections, [
    "bookId", "bookTitle", "sectionId", "index", "sectionTitle", "ul", "ol", "li", "maxDepth",
    "bulletParagraphs", "dashParagraphs", "numberedParagraphs", "brDelimitedBlocks", "tables", "definitionLists",
    "fontWeight3200", "flags",
  ]));
  await writeOnce(outliersCsvPath, makeCsv(formatting.outlierSections, [
    "bookId", "bookTitle", "sectionId", "index", "sectionTitle", "kind", "wordCount", "htmlLength",
    "headingCount", "paragraphCount", "listItems", "flags",
  ]));

  const files = [reportPath, capsCsvPath, listsCsvPath, outliersCsvPath];
  const hashes = [];
  for (const file of files) {
    const bytes = await readFile(file);
    hashes.push({ path: basename(file), bytes: bytes.length, sha256: sha256(bytes) });
  }
  const hashesPath = join(outputDir, "SHA256SUMS.json");
  await writeOnce(hashesPath, stableJson({ schemaVersion: 1, algorithm: "SHA-256", entries: hashes }));
  const sealPath = join(outputDir, "SHA256SUMS.sha256");
  const sumsBytes = await readFile(hashesPath);
  await writeOnce(sealPath, `${sha256(sumsBytes)}  SHA256SUMS.json\n`);
  for (const file of [...files, hashesPath, sealPath]) {
    try { await chmod(file, 0o444); } catch { /* hashes remain authoritative */ }
  }

  console.log(JSON.stringify({
    status: "READ_ONLY_MANUSCRIPT_QUALITY_AUDIT_COMPLETE",
    outputDirectory: outputDir,
    reportSha256: hashes.find(item => item.path === "report.json")?.sha256,
    liveRows: liveRows.length,
    sections: corpus.allSections.length,
    bodySections: corpus.bodySections.length,
    initialCapsSections: caps.summary.affectedSections,
    semanticListSections: lists.summary.sectionsWithSemanticLists,
    anyListLikeSections: lists.summary.sectionsWithAnyListLikeStructure,
    formattingOutlierSections: formatting.summary.outlierSections,
    cleanupPreservationFailures: preservation.validationFailureCount,
    liveWritesPerformed: false,
    localManuscriptsChanged: false,
  }, null, 2));
}

function buildCorpus(rows) {
  const allSections = [];
  const frontSections = [];
  const bodySections = [];
  const backSections = [];
  for (const row of rows) {
    const book = normalizeContent(row.content, row.book_id);
    for (const item of classifySections(book)) {
      const record = {
        bookId: String(row.book_id),
        bookTitle: String(row.title || book.title || row.book_id),
        contentFile: String(row.content_file || ""),
        sectionId: String(item.section.id || ""),
        index: Number(item.section.index),
        sectionTitle: String(item.section.title || ""),
        kind: String(item.section.kind || ""),
        wordCount: Number(item.section.wordCount || 0),
        html: String(item.section.html || ""),
        text: String(item.section.text || ""),
        category: item.category,
      };
      allSections.push(record);
      if (item.category === "front") frontSections.push(record);
      else if (item.category === "back") backSections.push(record);
      else bodySections.push(record);
    }
  }
  return { allSections, frontSections, bodySections, backSections };
}

function buildCaseReferences(sections) {
  const references = new Map();
  for (const section of sections) {
    const blocks = [...section.html.matchAll(/<(?:p|li|blockquote|dd|dt)\b[^>]*>([\s\S]*?)<\/(?:p|li|blockquote|dd|dt)\s*>/gi)]
      .map(match => decodedText(match[1]).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    for (const block of blocks) {
      const tokenPattern = /[\p{L}\p{N}]+(?:[’'._-][\p{L}\p{N}]+)*/gu;
      for (const match of block.matchAll(tokenPattern)) {
        const token = match[0];
        const letters = token.match(/\p{L}/gu)?.join("") || "";
        if (!letters || !/[a-z]/.test(letters)) continue;
        const key = token.toLocaleUpperCase("en-US");
        if (!references.has(key)) references.set(key, { variants: new Map(), internalTitleCase: 0, mixedCase: 0, lowercase: 0 });
        const reference = references.get(key);
        reference.variants.set(token, (reference.variants.get(token) || 0) + 1);
        const prefix = block.slice(0, match.index).trimEnd();
        const sentenceStart = !prefix || /[.!?…]["'’”)]?$/.test(prefix);
        if (/^[A-Z][a-z]+(?:[’'-][A-Z]?[a-z]+)*$/.test(token) && !sentenceStart) reference.internalTitleCase += 1;
        if (/[a-z][A-Z]|[A-Z].*[A-Z].*[a-z]/.test(token)) reference.mixedCase += 1;
        if (token === token.toLocaleLowerCase("en-US")) reference.lowercase += 1;
      }
    }
  }
  return references;
}

function auditInitialCaps(sections, caseReferences) {
  const records = [];
  const mechanismCounts = {};
  const sourceCasingCounts = {};
  const wordCountDistribution = {};
  const riskFlagCounts = {};
  const wrapperCounts = {};
  const knownAcronymTokens = {};
  const properNounCandidateTokens = {};
  const unresolvedTokens = {};
  let safeCssOnly = 0;
  const unaffectedSections = [];

  for (const section of sections) {
    const first = firstSubstantiveProse(section.html);
    if (!first) {
      unaffectedSections.push({ ...sectionIdentity(section), reason: "no-substantive-prose-block" });
      continue;
    }
    const styled = leadingUppercaseStyledText(first.innerHtml, first.attributes);
    const plain = decodedText(first.innerHtml).replace(/\s+/g, " ").trim();
    const literal = leadingLiteralUppercase(plain);
    const hasCss = Boolean(styled.text.trim());
    const hasLiteral = literal.tokens.length > 0 && (hasCss || literal.tokens.length >= 2 || literal.tokens[0].replace(/[^\p{L}]/gu, "").length >= 4);
    if (!hasCss && !hasLiteral) {
      unaffectedSections.push({ ...sectionIdentity(section), reason: "no-leading-uppercase-artifact", firstParagraphText: plain });
      continue;
    }

    const prefixText = hasCss ? styled.text.replace(/\s+/g, " ").trim() : literal.text;
    const prefixTokens = wordTokens(prefixText);
    const sourceCasing = /[a-z]/.test(prefixText) ? "retains-lowercase" : "literal-uppercase";
    const mechanism = hasCss && hasLiteral ? "css-and-literal-uppercase" : hasCss ? "css-uppercase-only" : "literal-uppercase-only";
    const safe = hasCss && sourceCasing === "retains-lowercase";
    const risk = classifyCapsRisk(prefixTokens, caseReferences, safe);
    const record = {
      bookId: section.bookId,
      bookTitle: section.bookTitle,
      sectionId: section.sectionId,
      index: section.index,
      sectionTitle: section.sectionTitle,
      kind: section.kind,
      mechanism,
      sourceCasing,
      prefixWordCount: prefixTokens.length,
      prefixText,
      firstParagraphText: plain,
      cssWrapper: styled.wrapper,
      safeCssOnly: safe,
      riskLevel: risk.level,
      riskFlags: risk.flags,
      referenceSuggestions: risk.suggestions,
      acronymTokens: risk.acronymTokens,
      properNounTokens: risk.properNounTokens,
      unresolvedTokens: risk.unresolvedTokens,
    };
    records.push(record);
    mechanismCounts[mechanism] = (mechanismCounts[mechanism] || 0) + 1;
    sourceCasingCounts[sourceCasing] = (sourceCasingCounts[sourceCasing] || 0) + 1;
    wrapperCounts[styled.wrapper || "none"] = (wrapperCounts[styled.wrapper || "none"] || 0) + 1;
    wordCountDistribution[prefixTokens.length] = (wordCountDistribution[prefixTokens.length] || 0) + 1;
    if (safe) safeCssOnly += 1;
    for (const flag of risk.flags) riskFlagCounts[flag] = (riskFlagCounts[flag] || 0) + 1;
    for (const token of risk.acronymTokens) knownAcronymTokens[token] = (knownAcronymTokens[token] || 0) + 1;
    for (const token of risk.properNounTokens) properNounCandidateTokens[token] = (properNounCandidateTokens[token] || 0) + 1;
    for (const token of risk.unresolvedTokens) unresolvedTokens[token] = (unresolvedTokens[token] || 0) + 1;
  }

  records.sort(compareSectionRecords);
  const books = new Set(records.map(record => record.bookId));
  const exactRiskCounts = {
    sectionsWithKnownAcronym: riskFlagCounts["known-acronym"] || 0,
    sectionsWithNumber: riskFlagCounts["contains-number"] || 0,
    sectionsWithHyphenOrDashToken: riskFlagCounts["hyphenated-or-dashed-token"] || 0,
    sectionsWithApostropheToken: riskFlagCounts["apostrophe-token"] || 0,
    sectionsWithRomanNumeralCandidate: riskFlagCounts["roman-numeral-candidate"] || 0,
  };
  const heuristicCaseReferenceCounts = {
    sectionsWithProperNounCandidate: riskFlagCounts["proper-noun-risk"] || 0,
    sectionsWithMixedCaseCandidate: riskFlagCounts["mixed-case-name-risk"] || 0,
    sectionsWithMultipleCaseReferences: riskFlagCounts["multiple-case-references"] || 0,
    sectionsWithoutLowercaseReference: riskFlagCounts["no-lowercase-reference"] || 0,
    caveat: "These are review-queue signals, not exact proper-noun counts. Sentence-initial title case and names cannot be separated reliably from corpus casing alone.",
  };
  return {
    summary: {
      totalBodySections: sections.length,
      affectedBooks: books.size,
      affectedSections: records.length,
      unaffectedSections: sections.length - records.length,
      safeCssOnlySections: safeCssOnly,
      humanReviewRequiredSections: records.length - safeCssOnly,
      mechanismCounts,
      sourceCasingCounts,
      wrapperCounts,
      prefixWordCountDistribution: sortNumericObject(wordCountDistribution),
      deterministicAssessment: {
        blindCaseTransformSafe: false,
        cssRemovalOnlySafeSections: safeCssOnly,
        literalUppercaseSourceSections: sourceCasingCounts["literal-uppercase"] || 0,
        humanApprovalRequiredSections: records.length - safeCssOnly,
        reason: "Removing text-transform is sufficient only when lowercase survives in the source. Literal uppercase source text requires case reconstruction, which is ambiguous for names, acronyms, numerals, and punctuation.",
      },
      exactRiskCounts,
      heuristicCaseReferenceCounts,
      riskFlagCounts,
      knownAcronymTokens: sortObjectByCount(knownAcronymTokens),
      properNounCandidateTokens: sortObjectByCount(properNounCandidateTokens),
      unresolvedTokens: sortObjectByCount(unresolvedTokens),
    },
    topLongestPrefixes: [...records].sort((a, b) => b.prefixWordCount - a.prefixWordCount || compareSectionRecords(a, b)).slice(0, 30),
    highRiskSections: records.filter(record => record.riskLevel === "high"),
    unaffectedSections,
    sections: records,
  };
}

function firstSubstantiveProse(html) {
  const pattern = /<(p|li|blockquote|td|th|dd|dt|figcaption)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const text = decodedText(match[3]).replace(/\s+/g, " ").trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    return { tag: match[1].toLowerCase(), attributes: match[2] || "", innerHtml: match[3], text };
  }
  return null;
}

function leadingUppercaseStyledText(innerHtml, containerAttributes) {
  const stack = [{ name: "container", upper: /text-transform\s*:\s*uppercase/i.test(containerAttributes) }];
  let started = false;
  let stopped = false;
  let text = "";
  let wrapper = "";
  for (const token of tokenizeHtml(innerHtml)) {
    if (!token.startsWith("<")) {
      const decoded = decodeEntities(token);
      if (!/[\p{L}\p{N}]/u.test(decoded)) {
        if (started && !stopped) text += decoded;
        continue;
      }
      const upper = stack.some(item => item.upper);
      if (!started) {
        if (!upper) return { text: "", wrapper: "" };
        started = true;
      }
      if (!upper) {
        stopped = true;
        break;
      }
      text += decoded;
      continue;
    }
    if (/^<!--|^<!/i.test(token)) continue;
    const close = token.match(/^<\s*\/\s*([a-z0-9:-]+)/i);
    if (close) {
      const name = close[1].toLowerCase();
      let index = stack.length - 1;
      while (index > 0 && stack[index].name !== name) index -= 1;
      if (index > 0) stack.splice(index);
      continue;
    }
    const open = token.match(/^<\s*([a-z0-9:-]+)([\s\S]*?)\/?\s*>$/i);
    if (!open) continue;
    const name = open[1].toLowerCase();
    const attributes = open[2] || "";
    const upper = /text-transform\s*:\s*uppercase/i.test(styleValue(attributes));
    if (upper && !wrapper) wrapper = `${name}${classValue(attributes) ? `.${classValue(attributes)}` : ""}`;
    stack.push({ name, upper });
    if (/\/\s*>$/.test(token) || voidTags.has(name)) stack.pop();
  }
  return { text: text.trim(), wrapper };
}

function leadingLiteralUppercase(text) {
  const tokens = wordTokens(text);
  const prefix = [];
  for (const token of tokens) {
    const letters = token.match(/\p{L}/gu)?.join("") || "";
    if (!letters) {
      if (prefix.length) prefix.push(token);
      continue;
    }
    if (letters === letters.toLocaleUpperCase("en-US") && letters !== letters.toLocaleLowerCase("en-US")) prefix.push(token);
    else break;
  }
  return { tokens: prefix, text: prefix.join(" ") };
}

function classifyCapsRisk(tokens, caseReferences, safeCssOnly) {
  if (safeCssOnly) return { level: "low", flags: ["source-case-retained"], suggestions: [], acronymTokens: [], properNounTokens: [], unresolvedTokens: [] };
  const flags = new Set();
  const suggestions = [];
  const acronymTokens = new Set();
  const properNounTokens = new Set();
  const unresolvedTokens = new Set();
  for (const [index, token] of tokens.entries()) {
    const upper = token.toLocaleUpperCase("en-US");
    if (knownAcronyms.has(upper)) {
      flags.add("known-acronym");
      acronymTokens.add(upper);
    }
    if (/\d/.test(token)) flags.add("contains-number");
    if (/[-‐‑‒–—]/u.test(token)) flags.add("hyphenated-or-dashed-token");
    if (/[’']/u.test(token)) flags.add("apostrophe-token");
    if (/^(?:[IVXLCDM]+)$/i.test(token) && token.length > 1) flags.add("roman-numeral-candidate");
    const variants = caseReferences.get(upper);
    if (!variants?.variants?.size) {
      flags.add("no-lowercase-reference");
      unresolvedTokens.add(upper);
      continue;
    }
    const sorted = [...variants.variants.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    suggestions.push({ token, position: index, variants: sorted.slice(0, 5).map(([value, count]) => ({ value, count })) });
    if (sorted.length > 1) flags.add("multiple-case-references");
    if (variants.mixedCase > 0) {
      flags.add("mixed-case-name-risk");
      properNounTokens.add(upper);
    }
    if (variants.internalTitleCase > 0) {
      flags.add("proper-noun-risk");
      properNounTokens.add(upper);
    }
  }
  if (!flags.size) flags.add("case-reconstruction-required");
  const high = ["known-acronym", "mixed-case-name-risk", "proper-noun-risk", "contains-number", "roman-numeral-candidate"];
  const level = high.some(flag => flags.has(flag)) ? "high" : flags.has("no-lowercase-reference") || flags.has("multiple-case-references") ? "medium" : "low";
  return {
    level,
    flags: [...flags].sort(),
    suggestions,
    acronymTokens: [...acronymTokens].sort(),
    properNounTokens: [...properNounTokens].sort(),
    unresolvedTokens: [...unresolvedTokens].sort(),
  };
}

function auditLists(sections) {
  const records = [];
  const bookTotals = new Map();
  let totalUl = 0;
  let totalOl = 0;
  let totalLi = 0;
  let totalBulletParagraphs = 0;
  let totalDashParagraphs = 0;
  let totalNumberedParagraphs = 0;
  let totalBrDelimitedBlocks = 0;
  let totalTables = 0;
  let totalDefinitionLists = 0;
  let totalWeight3200 = 0;
  let weight3200InsideLi = 0;
  let emptyListItems = 0;
  let orderedListAttributes = 0;

  for (const section of sections) {
    const html = section.html;
    const ul = countMatches(html, /<ul\b/gi);
    const ol = countMatches(html, /<ol\b/gi);
    const li = countMatches(html, /<li\b/gi);
    const maxDepth = maxListDepth(html);
    const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(match => ({ html: match[1], text: decodedText(match[1]).replace(/\s+/g, " ").trim() }));
    const bulletParagraphs = paragraphs.filter(item => /^[•●▪◦‣]\s*/u.test(item.text)).length;
    const dashParagraphs = paragraphs.filter(item => /^[-‐‑‒–—]\s+\S/u.test(item.text)).length;
    const numberedParagraphs = paragraphs.filter(item => /^(?:\d{1,3}|[A-Z])(?:[.)])\s+\S/.test(item.text)).length;
    const brDelimitedBlocks = paragraphs.filter(item => countMatches(item.html, /<br\b/gi) >= 3).length;
    const tables = countMatches(html, /<table\b/gi);
    const definitionLists = countMatches(html, /<dl\b/gi);
    const fontWeight3200 = countMatches(html, /font-weight\s*:\s*3200\b/gi);
    const weightInsideLi = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)]
      .reduce((sum, match) => sum + countMatches(match[1], /font-weight\s*:\s*3200\b/gi), 0);
    const emptyLi = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)].filter(match => !/[\p{L}\p{N}]/u.test(decodedText(match[1]))).length;
    const olAttributes = [...html.matchAll(/<ol\b([^>]*)>/gi)].filter(match => /\b(start|reversed|type)\s*=/i.test(match[1])).length;
    const balance = listBalance(html);
    const flags = [];
    if (maxDepth > 1) flags.push("nested-list");
    if (li >= 20) flags.push("high-item-count");
    if (bulletParagraphs) flags.push("bullet-character-paragraphs");
    if (dashParagraphs) flags.push("dash-pseudo-list");
    if (numberedParagraphs) flags.push("numbered-pseudo-list");
    if (brDelimitedBlocks) flags.push("br-delimited-block");
    if (tables) flags.push("table");
    if (definitionLists) flags.push("definition-list");
    if (emptyLi) flags.push("empty-list-item");
    if (olAttributes) flags.push("ordered-list-custom-attributes");
    if (!balance.valid) flags.push("unbalanced-list-tags");
    if (fontWeight3200 - weightInsideLi > 0) flags.push("weight-3200-outside-li");
    const any = ul || ol || li || bulletParagraphs || dashParagraphs || numberedParagraphs || brDelimitedBlocks || tables || definitionLists;
    if (!any && !flags.length && !fontWeight3200) continue;

    const record = {
      bookId: section.bookId,
      bookTitle: section.bookTitle,
      sectionId: section.sectionId,
      index: section.index,
      sectionTitle: section.sectionTitle,
      ul,
      ol,
      li,
      maxDepth,
      bulletParagraphs,
      dashParagraphs,
      numberedParagraphs,
      brDelimitedBlocks,
      tables,
      definitionLists,
      fontWeight3200,
      fontWeight3200InsideLi: weightInsideLi,
      emptyListItems: emptyLi,
      orderedListAttributes: olAttributes,
      flags,
    };
    records.push(record);
    if (!bookTotals.has(section.bookId)) bookTotals.set(section.bookId, { bookId: section.bookId, bookTitle: section.bookTitle, sections: 0, ul: 0, ol: 0, li: 0, pseudoListParagraphs: 0, brDelimitedBlocks: 0, tables: 0, maxDepth: 0 });
    const book = bookTotals.get(section.bookId);
    book.sections += 1;
    book.ul += ul;
    book.ol += ol;
    book.li += li;
    book.pseudoListParagraphs += bulletParagraphs + dashParagraphs + numberedParagraphs;
    book.brDelimitedBlocks += brDelimitedBlocks;
    book.tables += tables;
    book.maxDepth = Math.max(book.maxDepth, maxDepth);
    totalUl += ul;
    totalOl += ol;
    totalLi += li;
    totalBulletParagraphs += bulletParagraphs;
    totalDashParagraphs += dashParagraphs;
    totalNumberedParagraphs += numberedParagraphs;
    totalBrDelimitedBlocks += brDelimitedBlocks;
    totalTables += tables;
    totalDefinitionLists += definitionLists;
    totalWeight3200 += fontWeight3200;
    weight3200InsideLi += weightInsideLi;
    emptyListItems += emptyLi;
    orderedListAttributes += olAttributes;
  }

  const semanticSections = records.filter(record => record.ul || record.ol || record.li);
  const explicitPseudoSections = records.filter(record => record.bulletParagraphs || record.dashParagraphs || record.numberedParagraphs);
  const semanticOrExplicitSections = records.filter(record => record.ul || record.ol || record.li || record.bulletParagraphs || record.dashParagraphs || record.numberedParagraphs);
  const brHeavySections = records.filter(record => record.brDelimitedBlocks);
  const anySections = records.filter(record => record.ul || record.ol || record.li || record.bulletParagraphs || record.dashParagraphs || record.numberedParagraphs || record.brDelimitedBlocks || record.tables || record.definitionLists);
  return {
    summary: {
      totalBodySections: sections.length,
      booksWithAnyListLikeStructure: new Set(anySections.map(record => record.bookId)).size,
      sectionsWithAnyListLikeStructure: anySections.length,
      booksWithSemanticLists: new Set(semanticSections.map(record => record.bookId)).size,
      sectionsWithSemanticLists: semanticSections.length,
      booksWithSemanticOrExplicitLists: new Set(semanticOrExplicitSections.map(record => record.bookId)).size,
      sectionsWithSemanticOrExplicitLists: semanticOrExplicitSections.length,
      booksWithExplicitPseudoLists: new Set(explicitPseudoSections.map(record => record.bookId)).size,
      sectionsWithExplicitPseudoLists: explicitPseudoSections.length,
      booksWithBrDelimitedBlocks: new Set(brHeavySections.map(record => record.bookId)).size,
      sectionsWithBrDelimitedBlocks: brHeavySections.length,
      sectionsWithNestedLists: records.filter(record => record.maxDepth > 1).length,
      maximumListDepth: records.reduce((max, record) => Math.max(max, record.maxDepth), 0),
      sectionsWithTwentyOrMoreItems: records.filter(record => record.li >= 20).length,
      sectionsWithUnbalancedListTags: records.filter(record => record.flags.includes("unbalanced-list-tags")).length,
      unorderedLists: totalUl,
      orderedLists: totalOl,
      listItems: totalLi,
      bulletCharacterParagraphs: totalBulletParagraphs,
      dashPseudoListParagraphs: totalDashParagraphs,
      numberedPseudoListParagraphs: totalNumberedParagraphs,
      brDelimitedBlocks: totalBrDelimitedBlocks,
      tables: totalTables,
      definitionLists: totalDefinitionLists,
      emptyListItems,
      orderedListsWithCustomAttributes: orderedListAttributes,
      fontWeight3200: totalWeight3200,
      fontWeight3200InsideLi: weight3200InsideLi,
      fontWeight3200OutsideLi: totalWeight3200 - weight3200InsideLi,
    },
    topBooksByListItems: [...bookTotals.values()].sort((a, b) => b.li - a.li || b.pseudoListParagraphs - a.pseudoListParagraphs || a.bookId.localeCompare(b.bookId)).slice(0, 30),
    topSectionsByListItems: [...records].sort((a, b) => b.li - a.li || b.brDelimitedBlocks - a.brDelimitedBlocks || compareSectionRecords(a, b)).slice(0, 40),
    sections: records.sort(compareSectionRecords),
  };
}

function auditFormatting(sections) {
  const tagCounts = {};
  const fontWeights = {};
  const textTransforms = {};
  const records = [];
  const nonstandardTitles = [];
  for (const section of sections) {
    const html = section.html;
    for (const token of html.matchAll(/<\s*([a-z0-9:-]+)\b/gi)) {
      const tag = token[1].toLowerCase();
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
    for (const match of html.matchAll(/font-weight\s*:\s*([^;"']+)/gi)) {
      const value = match[1].trim().toLowerCase();
      fontWeights[value] = (fontWeights[value] || 0) + 1;
    }
    for (const match of html.matchAll(/text-transform\s*:\s*([^;"']+)/gi)) {
      const value = match[1].trim().toLowerCase();
      textTransforms[value] = (textTransforms[value] || 0) + 1;
    }

    const headingCount = countMatches(html, /<h[1-6]\b/gi);
    const paragraphCount = countMatches(html, /<p\b/gi);
    const listItems = countMatches(html, /<li\b/gi);
    const flags = [];
    if (!headingCount) flags.push("no-heading-element");
    if (headingCount > 3) flags.push("more-than-three-headings");
    if (!paragraphCount && section.wordCount > 0) flags.push("text-without-paragraph");
    if (!/[\p{L}\p{N}]/u.test(decodedText(html))) flags.push("empty-body-section");
    if (/<(?:img|figure|svg)\b/i.test(html)) flags.push("visual-media");
    if (/<table\b/i.test(html)) flags.push("table");
    if (/<blockquote\b/i.test(html)) flags.push("blockquote");
    if (/<(?:pre|code)\b/i.test(html)) flags.push("preformatted-or-code");
    if (/<(?:sup|sub)\b/i.test(html)) flags.push("superscript-or-subscript");
    if (/font-weight\s*:\s*normal\b/i.test(html)) flags.push("explicit-font-weight-normal");
    if (/<i\b/i.test(html)) flags.push("legacy-i-element");
    if (!tagBalance(html).valid) flags.push("unbalanced-tags");
    if (!standardBodyTitlePattern.test(normalizeTitle(section.sectionTitle))) {
      flags.push("nonstandard-section-title");
      nonstandardTitles.push({
        bookId: section.bookId,
        bookTitle: section.bookTitle,
        sectionId: section.sectionId,
        index: section.index,
        sectionTitle: section.sectionTitle,
        kind: section.kind,
      });
    }
    const record = {
      bookId: section.bookId,
      bookTitle: section.bookTitle,
      sectionId: section.sectionId,
      index: section.index,
      sectionTitle: section.sectionTitle,
      kind: section.kind,
      wordCount: section.wordCount,
      htmlLength: html.length,
      headingCount,
      paragraphCount,
      listItems,
      flags,
    };
    records.push(record);
  }

  const wordCounts = records.map(record => record.wordCount).sort((a, b) => a - b);
  const htmlLengths = records.map(record => record.htmlLength).sort((a, b) => a - b);
  const p99Words = percentile(wordCounts, 0.99);
  const p99Html = percentile(htmlLengths, 0.99);
  for (const record of records) {
    if (record.wordCount >= p99Words) record.flags.push("top-one-percent-word-count");
    if (record.htmlLength >= p99Html) record.flags.push("top-one-percent-html-length");
  }
  const outliers = records.filter(record => record.flags.length);
  const flagCounts = {};
  for (const record of outliers) for (const flag of record.flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
  const rareTags = Object.entries(tagCounts).filter(([, count]) => count <= 10).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
  return {
    summary: {
      totalBodySections: sections.length,
      outlierSections: outliers.length,
      nonstandardSectionTitles: nonstandardTitles.length,
      sectionsWithoutHeadingElements: records.filter(record => record.flags.includes("no-heading-element")).length,
      sectionsWithMoreThanThreeHeadings: records.filter(record => record.flags.includes("more-than-three-headings")).length,
      emptyBodySections: records.filter(record => record.flags.includes("empty-body-section")).length,
      unbalancedTagSections: records.filter(record => record.flags.includes("unbalanced-tags")).length,
      sectionsWithVisualMedia: records.filter(record => record.flags.includes("visual-media")).length,
      sectionsWithTables: records.filter(record => record.flags.includes("table")).length,
      sectionsWithBlockquotes: records.filter(record => record.flags.includes("blockquote")).length,
      sectionsWithPreformattedOrCode: records.filter(record => record.flags.includes("preformatted-or-code")).length,
      sectionsWithSuperscriptOrSubscript: records.filter(record => record.flags.includes("superscript-or-subscript")).length,
      explicitFontWeightNormalSections: records.filter(record => record.flags.includes("explicit-font-weight-normal")).length,
      legacyIElementSections: records.filter(record => record.flags.includes("legacy-i-element")).length,
      flagCounts: sortObjectByCount(flagCounts),
      p99WordCount: p99Words,
      p99HtmlLength: p99Html,
      fontWeights,
      textTransforms,
      tagCounts: sortObjectByKey(tagCounts),
      rareTags,
    },
    longestSectionsByWords: [...records].sort((a, b) => b.wordCount - a.wordCount || compareSectionRecords(a, b)).slice(0, 40),
    longestSectionsByHtml: [...records].sort((a, b) => b.htmlLength - a.htmlLength || compareSectionRecords(a, b)).slice(0, 40),
    nonstandardTitles: nonstandardTitles.sort(compareSectionRecords),
    outlierSections: outliers.sort(compareSectionRecords),
  };
}

function auditPreservation({ liveRows, originalRows, candidateRows, fallback, historyRows }) {
  const originalById = new Map(originalRows.map(row => [String(row.book_id), row]));
  const candidateById = new Map(candidateRows.map(row => [String(row.book_id), row]));
  const fallbackByFile = fallback.byFileName;
  const failures = [];
  const counters = {
    liveCandidateContentMismatches: 0,
    liveFallbackFormattingMismatches: 0,
    frontMatterSectionMismatches: 0,
    backMatterSectionMismatches: 0,
    bodyHeadingMarkupMismatches: 0,
    bodyRawTextMismatches: 0,
    bodyRenderedTextMismatches: 0,
    bodyDashMismatches: 0,
    bodySectionMetadataMismatches: 0,
  };
  const beforeBold = makeBoldTotals();
  const afterBold = makeBoldTotals();

  for (const live of liveRows) {
    const bookId = String(live.book_id);
    const original = originalById.get(bookId);
    const candidate = candidateById.get(bookId);
    if (!original || !candidate) {
      failures.push(`${bookId}:missing-sealed-row`);
      continue;
    }
    if (stableJson(live.content) !== stableJson(candidate.content)) {
      counters.liveCandidateContentMismatches += 1;
      failures.push(`${bookId}:live-candidate-content`);
    }
    const fallbackItem = fallbackByFile.get(String(live.content_file || "").toLowerCase());
    if (!fallbackItem || stableJson((live.content.sections || []).map(formattingProjection)) !== stableJson((fallbackItem.content.sections || []).map(formattingProjection))) {
      counters.liveFallbackFormattingMismatches += 1;
      failures.push(`${bookId}:live-fallback-formatting`);
    }

    const originalBook = normalizeContent(original.content, bookId);
    const currentBook = normalizeContent(live.content, bookId);
    const classification = classifySections(originalBook);
    for (const item of classification) {
      const before = item.section;
      const after = currentBook.sections[item.arrayIndex];
      if (!after) {
        failures.push(`${bookId}:${before.id}:missing-current-section`);
        continue;
      }
      addBoldInventory(beforeBold[item.category], before.html);
      addBoldInventory(afterBold[item.category], after.html);
      const key = `${bookId}:${before.id}`;
      if (item.category === "front" && stableJson(before) !== stableJson(after)) {
        counters.frontMatterSectionMismatches += 1;
        failures.push(`${key}:front-matter`);
      }
      if (item.category === "back" && stableJson(before) !== stableJson(after)) {
        counters.backMatterSectionMismatches += 1;
        failures.push(`${key}:back-matter`);
      }
      if (item.category === "body") {
        if (extractHeadingMarkup(before.html) !== extractHeadingMarkup(after.html)) {
          counters.bodyHeadingMarkupMismatches += 1;
          failures.push(`${key}:heading-markup`);
        }
        if (rawTextNodes(before.html) !== rawTextNodes(after.html)) {
          counters.bodyRawTextMismatches += 1;
          failures.push(`${key}:raw-text`);
        }
        if (decodedText(before.html) !== decodedText(after.html)) {
          counters.bodyRenderedTextMismatches += 1;
          failures.push(`${key}:rendered-text`);
        }
        if (dashInventory(before.html).key !== dashInventory(after.html).key) {
          counters.bodyDashMismatches += 1;
          failures.push(`${key}:dashes`);
        }
        if (stableJson(withoutHtml(before)) !== stableJson(withoutHtml(after))) {
          counters.bodySectionMetadataMismatches += 1;
          failures.push(`${key}:section-metadata`);
        }
      }
    }
  }

  const versionCounts = {};
  for (const row of liveRows) versionCounts[row.version_number] = (versionCounts[row.version_number] || 0) + 1;
  const historyVersionCounts = {};
  for (const row of historyRows) historyVersionCounts[row.version_number] = (historyVersionCounts[row.version_number] || 0) + 1;
  const before = summarizeBoldTotals(beforeBold);
  const after = summarizeBoldTotals(afterBold);
  if (after.body.proseBoldRuns !== 0) failures.push("corpus:body-prose-bold-remains");
  if (before.body.headingBoldRuns !== after.body.headingBoldRuns) failures.push("corpus:body-heading-bold-count");
  if (stableJson(before.front) !== stableJson(after.front)) failures.push("corpus:front-bold-inventory");
  if (stableJson(before.back) !== stableJson(after.back)) failures.push("corpus:back-bold-inventory");

  return {
    ...counters,
    validationFailureCount: failures.length,
    failures,
    liveVersionCounts: sortNumericObject(versionCounts),
    historyRows: historyRows.length,
    historyVersionCounts: sortNumericObject(historyVersionCounts),
    beforeBoldInventory: before,
    afterBoldInventory: after,
    exactPreservation: failures.length === 0,
  };
}

function makeBoldTotals() {
  const target = () => ({ sections: 0, rawStrong: 0, rawB: 0, fontWeight5600: 0, fontWeight3200: 0, semanticBoldRuns: 0, proseBoldRuns: 0, headingBoldRuns: 0, otherBoldRuns: 0 });
  return { front: target(), body: target(), back: target() };
}

function addBoldInventory(target, htmlValue) {
  const html = String(htmlValue || "");
  target.sections += 1;
  target.rawStrong += countMatches(html, /<strong\b/gi);
  target.rawB += countMatches(html, /<b\b/gi);
  target.fontWeight5600 += countMatches(html, /font-weight\s*:\s*5600\b/gi);
  target.fontWeight3200 += countMatches(html, /font-weight\s*:\s*3200\b/gi);
  const runs = boldRuns(html);
  target.semanticBoldRuns += runs.length;
  target.proseBoldRuns += runs.filter(run => run.prose.trim()).length;
  target.headingBoldRuns += runs.filter(run => run.heading.trim()).length;
  target.otherBoldRuns += runs.filter(run => run.other.trim()).length;
}

function boldRuns(html) {
  const stack = [];
  let depth = 0;
  let run = null;
  const runs = [];
  const context = () => ({ heading: stack.some(item => /^h[1-6]$/.test(item.name)), prose: stack.some(item => proseTags.has(item.name)) });
  const finish = () => {
    if (run && `${run.prose}${run.heading}${run.other}`.trim()) runs.push(run);
    run = null;
  };
  for (const token of tokenizeHtml(html)) {
    if (!token.startsWith("<")) {
      if (depth > 0 && run) {
        const current = context();
        if (current.heading) run.heading += token;
        else if (current.prose) run.prose += token;
        else run.other += token;
      }
      continue;
    }
    if (/^<!--|^<!/i.test(token)) continue;
    const close = token.match(/^<\s*\/\s*([a-z0-9:-]+)/i);
    if (close) {
      const name = close[1].toLowerCase();
      let index = stack.length - 1;
      while (index >= 0 && stack[index].name !== name) index -= 1;
      if (index < 0) continue;
      for (let cursor = stack.length - 1; cursor >= index; cursor -= 1) {
        const item = stack.pop();
        if (item.bold && --depth === 0) finish();
      }
      continue;
    }
    const open = token.match(/^<\s*([a-z0-9:-]+)([\s\S]*?)\/?\s*>$/i);
    if (!open) continue;
    const name = open[1].toLowerCase();
    const attrs = open[2] || "";
    const bold = name === "strong" || name === "b" || /font-weight\s*:\s*5600/i.test(styleValue(attrs));
    if (bold && depth === 0) run = { prose: "", heading: "", other: "" };
    if (bold) depth += 1;
    stack.push({ name, bold });
    if (/\/\s*>$/.test(token) || voidTags.has(name)) {
      const item = stack.pop();
      if (item.bold && --depth === 0) finish();
    }
  }
  while (stack.length) {
    const item = stack.pop();
    if (item.bold && --depth === 0) finish();
  }
  finish();
  return runs;
}

function summarizeBoldTotals(totals) {
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, { ...value }]));
}

function classifySections(book) {
  const sorted = (book.sections || []).map((section, arrayIndex) => ({ section, arrayIndex })).sort((a, b) => Number(a.section.index) - Number(b.section.index) || a.arrayIndex - b.arrayIndex);
  let backPosition = sorted.findIndex((item, position) => position >= Math.max(0, sorted.length - 8) && exactBackPattern.test(normalizeTitle(item.section.title)));
  if (backPosition < 0) backPosition = sorted.length;
  return sorted.map((item, position) => ({
    ...item,
    category: position >= backPosition ? "back" : isFront(item.section, position) ? "front" : "body",
  }));
}

function isFront(section, position) {
  const title = normalizeTitle(section.title);
  return (position === 0 && /^(contents|table of contents)$/.test(title))
    || (position === 1 && Number(section.wordCount || 0) <= 30 && /\bps1\b/i.test(String(section.html || "")))
    || (position < 5 && /^dedication$/.test(title))
    || (position < 5 && /^(foreword|preface)$/.test(title));
}

function maxListDepth(html) {
  let depth = 0;
  let max = 0;
  for (const token of tokenizeHtml(html)) {
    if (/^<\s*\/?\s*(?:ul|ol)\b/i.test(token)) {
      if (/^<\s*\//.test(token)) depth = Math.max(0, depth - 1);
      else if (!/\/\s*>$/.test(token)) max = Math.max(max, ++depth);
    }
  }
  return max;
}

function listBalance(html) {
  const tags = ["ul", "ol", "li"];
  const counts = Object.fromEntries(tags.map(tag => [tag, { open: countMatches(html, new RegExp(`<${tag}\\b`, "gi")), close: countMatches(html, new RegExp(`<\\/${tag}\\s*>`, "gi")) }]));
  return { counts, valid: Object.values(counts).every(value => value.open === value.close) };
}

function tagBalance(html) {
  const stack = [];
  const errors = [];
  for (const token of tokenizeHtml(html)) {
    if (!token.startsWith("<") || /^<!--|^<!/i.test(token)) continue;
    const close = token.match(/^<\s*\/\s*([a-z0-9:-]+)/i);
    if (close) {
      const name = close[1].toLowerCase();
      let index = stack.length - 1;
      while (index >= 0 && stack[index] !== name) index -= 1;
      if (index < 0) errors.push(`orphan-close:${name}`);
      else stack.splice(index);
      continue;
    }
    const open = token.match(/^<\s*([a-z0-9:-]+)/i);
    if (!open) continue;
    const name = open[1].toLowerCase();
    if (!voidTags.has(name) && !/\/\s*>$/.test(token)) stack.push(name);
  }
  return { valid: !errors.length && !stack.length, errors, unclosed: stack };
}

async function readLocalFallback() {
  const manifest = JSON.parse(await readFile(join(root, "public", "book-content", "manifest.json"), "utf8"));
  const rows = [];
  const byFileName = new Map();
  for (const entry of manifest.books || []) {
    const fileName = basename(String(entry.path || ""));
    const content = JSON.parse(await readFile(join(root, "public", "book-content", fileName), "utf8"));
    const row = { book_id: String(content.id || entry.id), content_file: fileName, content };
    rows.push(row);
    byFileName.set(fileName.toLowerCase(), { fileName, bookId: row.book_id, content });
  }
  return { rows, byFileName };
}

async function verifySealedBatch(directory) {
  const sumsText = await readFile(join(directory, "SHA256SUMS.json"), "utf8");
  const expected = (await readFile(join(directory, "SHA256SUMS.sha256"), "utf8")).trim().split(/\s+/)[0];
  const actual = sha256(sumsText);
  if (actual !== expected) throw new Error("Sealed baseline manifest digest mismatch.");
  const sums = JSON.parse(sumsText);
  for (const entry of sums.entries || []) {
    const bytes = await readFile(join(directory, ...String(entry.path).split("/")));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`Sealed baseline hash mismatch: ${entry.path}`);
  }
  return { manifestSha256: actual, filesVerified: sums.entries.length };
}

async function fetchAllRows(supabase, table, orderColumn) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const result = await supabase.from(table).select("*").order(orderColumn, { ascending: true }).range(start, start + 999);
    if (result.error) throw new Error(`Read-only ${table} query failed: ${result.error.message}`);
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) break;
  }
  return rows;
}

async function readJsonDirectory(directory) {
  const names = (await readdir(directory)).filter(name => name.endsWith(".json")).sort();
  return Promise.all(names.map(async name => JSON.parse(await readFile(join(directory, name), "utf8"))));
}

function normalizeContent(value, fallbackId) {
  const content = typeof value === "string" ? JSON.parse(value) : structuredClone(value || {});
  content.id ||= fallbackId;
  content.sections = Array.isArray(content.sections) ? content.sections : [];
  return content;
}

function formattingProjection(section) {
  return { id: section.id, index: section.index, title: section.title, kind: section.kind, html: section.html, text: section.text, wordCount: section.wordCount };
}

function withoutHtml(section) {
  const copy = { ...section };
  delete copy.html;
  return copy;
}

function extractHeadingMarkup(html) {
  return (String(html || "").match(/<h[1-6]\b[\s\S]*?<\/h[1-6]\s*>/gi) || []).join("\n");
}

function rawTextNodes(html) {
  return tokenizeHtml(html).filter(token => !token.startsWith("<")).join("");
}

function decodedText(html) {
  return decodeEntities(rawTextNodes(html));
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'").replace(/&mdash;/gi, "—").replace(/&ndash;/gi, "–");
}

function dashInventory(html) {
  const text = decodedText(html);
  const em = countMatches(text, /—/g);
  const en = countMatches(text, /–/g);
  return { em, en, key: `${em}:${en}` };
}

function tokenizeHtml(value) {
  return String(value || "").match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) || [];
}

function wordTokens(value) {
  return String(value || "").match(/[\p{L}\p{N}]+(?:[’'._-][\p{L}\p{N}]+)*/gu) || [];
}

function styleValue(attributes) {
  const match = String(attributes || "").match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function classValue(attributes) {
  const match = String(attributes || "").match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "").trim().replace(/\s+/g, ".") : "";
}

function normalizeTitle(value) {
  return String(value || "").trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function countMatches(value, pattern) {
  return (String(value || "").match(pattern) || []).length;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))];
}

function compareSectionRecords(a, b) {
  return String(a.bookId).localeCompare(String(b.bookId)) || Number(a.index) - Number(b.index) || String(a.sectionId).localeCompare(String(b.sectionId));
}

function sectionIdentity(section) {
  return {
    bookId: section.bookId,
    bookTitle: section.bookTitle,
    sectionId: section.sectionId,
    index: section.index,
    sectionTitle: section.sectionTitle,
    kind: section.kind,
  };
}

function sortNumericObject(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => Number(a[0]) - Number(b[0])));
}

function sortObjectByKey(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => a[0].localeCompare(b[0])));
}

function sortObjectByCount(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function makeCsv(rows, columns) {
  const escape = value => {
    const text = Array.isArray(value) || (value && typeof value === "object") ? JSON.stringify(value) : String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${columns.join(",")}\n${rows.map(row => columns.map(column => escape(row[column])).join(",")).join("\n")}\n`;
}

async function writeOnce(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, { flag: "wx" });
}

function stableJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function computeSourceFingerprint(rows) {
  return sha256(stableJson(rows.map(row => ({ book_id: row.book_id, version_number: row.version_number, updated_at: row.updated_at, content_sha256: sha256(stableJson(row.content)) }))));
}

function projectRefFromUrl(value) {
  try { return new URL(value).hostname.split(".")[0] || "unknown"; } catch { return "unknown"; }
}

function timestampId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function argValue(name) {
  const prefix = `${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || "";
}
