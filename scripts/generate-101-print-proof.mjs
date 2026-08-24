import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  bookDisclaimerConfigPath,
  printDisclaimerConfigPath,
  resolvePrintProductDisclaimerPlan,
} from "./print-disclaimer-system.mjs";

const root = process.cwd();
const tempRoot = resolve(root, "tmp", "pdfs", "jju-101-proof");
const outputRoot = resolve(root, "output", "pdf");
const publicProofRoot = resolve(root, "public", "print-proofs");
const productPath = resolve(root, "public", "print-products.json");
const booksPath = resolve(root, "public", "books.json");
const manifestPath = resolve(root, "public", "book-content", "manifest.json");
const toolsPath = resolve(root, "scripts", "print-proof-pdf-tools.py");
const generatorPath = resolve(root, "scripts", "generate-101-print-proof.mjs");
const disclaimerModulePath = resolve(root, "scripts", "print-disclaimer-system.mjs");
const legalProofsOnly = process.argv.includes("--legal-proofs-only");
const books = readJson(booksPath).map(normalizeBook);
const products = readJson(productPath).filter(item => item.slug === "101-volume-1" || item.slug === "101-volume-2");
const contentManifest = readJson(manifestPath);

const PRINT_DESCRIPTIONS = {
  math: "A history of numbers, algebra, geometry, probability, and calculus from early counting systems to modern mathematics.",
  calculus: "A history of how mathematicians developed derivatives and integrals to describe motion, change, area, and risk.",
  science: "A history of methods people built to observe, test, and explain the natural world.",
  physics: "A history of physical law from Galileo and Newton through relativity, thermodynamics, and quantum mechanics.",
  quantum: "A history of quantum mechanics from Planck's constant and wave mechanics to fields, entanglement, and quantum computing.",
  chemistry: "A history of how the study of matter moved from fire and alchemy to atoms, reactions, industry, and modern materials.",
  electricity: "A history of electricity from early static experiments to batteries, circuits, electromagnetism, and the modern grid.",
  biology: "A history of biological study from taxonomy and microscopy to evolution, genetics, and molecular biology.",
  anatomy: "A history of how people learned to map, study, and interpret the human body, from early dissection to imaging and prosthetics.",
  psychology: "A history of psychology from early theories of mind through psychoanalysis, behaviorism, humanism, and digital life.",
  philosophy: "A chronological introduction to major philosophical questions, schools, and arguments from antiquity to the present.",
  ethics: "A history of moral reasoning from customary and religious rules to rights, law, political power, markets, and algorithms.",
  history: "A history of how people recorded, interpreted, organized, and used the past.",
  religion: "A history of religious belief, ritual, institutions, reform, and secular challenge across human societies.",
  government: "A history of organized political power from chiefs and kings to states, constitutions, bureaucracy, and democracy.",
  economics: "A history of money, trade, markets, industrialization, economic policy, and the modern global system.",
};

const PRODUCT_METADATA = {
  "101-volume-1": {
    series: "JJ University 101",
    subject: "The Natural World",
    volume: "Volume I",
    shortVolume: "Vol. I",
    backHeadline: "Eight foundations for understanding the natural world.",
    backDescription: "Numbers, matter, energy, and life are presented as one connected sequence, from mathematics and physical law to chemistry, electricity, and biology.",
  },
  "101-volume-2": {
    series: "JJ University 101",
    subject: "The Human World",
    volume: "Volume II",
    shortVolume: "Vol. II",
    backHeadline: "Eight foundations for understanding the human world.",
    backDescription: "Body, mind, meaning, institutions, and money are presented as one connected sequence, from anatomy and psychology to religion, government, and economics.",
  },
};

mkdirSync(tempRoot, { recursive: true });
mkdirSync(outputRoot, { recursive: true });
mkdirSync(publicProofRoot, { recursive: true });
loadLocalEnv(".env.local");
loadLocalEnv(".env");

const sourceEvidence = [];
const outputs = [];
const volumeResults = [];

for (const product of products) {
  const metadata = PRODUCT_METADATA[product.slug];
  const productBooks = product.bookIds.map(id => books.find(book => book.id === String(id).toLowerCase())).filter(Boolean);
  if (productBooks.length !== product.bookIds.length) fail(`Missing a source book for ${product.slug}.`);
  const payloads = productBooks.map(book => {
    const contentPath = resolveContentPath(book);
    const content = readJson(contentPath);
    const sections = bodySections(content.sections || [], book);
    sourceEvidence.push({ product: product.slug, bookId: book.id, path: relativePath(contentPath), sha256: sha256File(contentPath), retainedSections: sections.length });
    return { book, sections, description: PRINT_DESCRIPTIONS[book.id] || book.description };
  });
  assertDescriptions(payloads);
  const disclaimerPlan = resolvePrintProductDisclaimerPlan(product, productBooks);

  const legalProofSpec = resolve(tempRoot, `${product.slug}-copyright-disclaimer.json`);
  const legalProofPdf = resolve(outputRoot, `JJ-University-101-${metadata.volume.replace("Volume ", "Volume-")}-copyright-disclaimer-one-page-proof.pdf`);
  const publicLegalProofPdf = resolve(publicProofRoot, `${product.slug}-copyright-disclaimer-proof-not-for-sale.pdf`);
  writeFileSync(legalProofSpec, `${JSON.stringify({
    output: legalProofPdf,
    title: `${metadata.series} ${metadata.volume} Copyright and Disclaimer`,
    subject: metadata.subject,
    volume: metadata.volume,
    series: metadata.series,
    copyrightYear: 2026,
    blocks: disclaimerPlan.blocks,
  }, null, 2)}\n`, "utf8");
  runPython(["legal-proof", legalProofSpec]);
  const legalProofAudit = readPageAudit(legalProofPdf);
  if (legalProofAudit.pageCount !== 1) fail(`${product.slug} copyright and disclaimer proof must be exactly one page.`);
  copyFileSync(legalProofPdf, publicLegalProofPdf);
  outputs.push(outputRecord(publicLegalProofPdf, { kind: "copyright-disclaimer-proof", product: product.slug, pages: 1, widthIn: 6, heightIn: 9 }));
  if (legalProofsOnly) continue;

  const rawPdf = resolve(tempRoot, `${product.slug}-raw.pdf`);
  const draftPdf = resolve(tempRoot, `${product.slug}-draft.pdf`);
  const htmlPath = resolve(tempRoot, `${product.slug}.html`);
  const finalPdf = resolve(outputRoot, `JJ-University-101-${metadata.volume.replace("Volume ", "Volume-")}-${slug(metadata.subject)}-interior-proof.pdf`);
  const pads = new Set();
  let markerData = null;

  for (let pass = 0; pass < 10; pass += 1) {
    const html = renderInterior(product, metadata, payloads, { pads, pageMap: {}, includeEndBlank: false, disclaimerPlan });
    writeFileSync(htmlPath, html, "utf8");
    renderPdf(htmlPath, draftPdf);
    markerData = readMarkers(draftPdf);
    if (Object.keys(markerData.books).length !== payloads.length) {
      fail(`Expected ${payloads.length} book markers in ${product.slug}, found ${Object.keys(markerData.books).length}.`);
    }
    const evenStart = payloads.find(({ book }) => Number(markerData.books[book.id]) % 2 === 0);
    if (!evenStart) break;
    pads.add(evenStart.book.id);
    if (pass === 9) fail(`Could not establish recto starts for ${product.slug}.`);
  }

  let pageMap = markerData.books;
  let includeEndBlank = Number(markerData.pageCount) % 2 === 1;
  writeFileSync(htmlPath, renderInterior(product, metadata, payloads, { pads, pageMap, includeEndBlank, disclaimerPlan }), "utf8");
  renderPdf(htmlPath, rawPdf);
  markerData = readMarkers(rawPdf);
  pageMap = markerData.books;
  if (Object.keys(pageMap).length !== payloads.length) fail(`Final divider marker count failed for ${product.slug}.`);
  if (Object.values(pageMap).some(page => Number(page) % 2 === 0)) fail(`A divider is not recto in ${product.slug}.`);
  if (Number(markerData.pageCount) % 2 !== 0) fail(`${product.slug} has an odd final page count.`);

  runPython(["normalize", rawPdf, finalPdf, "--title", `${metadata.series}: ${metadata.subject}, ${metadata.volume}`]);
  const finalMarkers = readMarkers(finalPdf);
  const pageAudit = readPageAudit(finalPdf);
  const dimensions = await fetchCoverDimensions(finalMarkers.pageCount);
  volumeResults.push({ product, metadata, payloads, disclaimerPlan, finalPdf, pageCount: finalMarkers.pageCount, pageMap: finalMarkers.books, cleanPages: finalMarkers.cleanPages, pageAudit, dimensions });
  outputs.push(outputRecord(finalPdf, { kind: "interior", product: product.slug, pages: finalMarkers.pageCount, widthIn: 6, heightIn: 9 }));
}

if (legalProofsOnly) {
  console.log(JSON.stringify({ status: "proof-only-not-for-sale", outputs }, null, 2));
  process.exit(0);
}

const coverPayload = { covers: [] };
for (const result of volumeResults) {
  const common = {
    subject: result.metadata.subject,
    volume: result.metadata.volume,
    backHeadline: result.metadata.backHeadline,
    backDescription: result.metadata.backDescription,
    books: result.payloads.map(item => item.book.title),
  };
  for (const binding of ["paperback", "casewrap"]) {
    const dims = result.dimensions[binding];
    const output = resolve(outputRoot, `JJ-University-101-${result.metadata.volume.replace("Volume ", "Volume-")}-${binding}-cover-direction-system-proof.pdf`);
    coverPayload.covers.push({ ...common, binding, widthIn: dims.width, heightIn: dims.height, output });
  }
}
const coverSpecPath = resolve(tempRoot, "cover-spec.json");
writeFileSync(coverSpecPath, `${JSON.stringify(coverPayload, null, 2)}\n`, "utf8");
runPython(["covers", coverSpecPath]);
for (const cover of coverPayload.covers) {
  const result = volumeResults.find(item => item.metadata.volume === cover.volume);
  const packageId = cover.binding === "paperback" ? result.dimensions.paperback.packageId : result.dimensions.casewrap.packageId;
  outputs.push(outputRecord(cover.output, { kind: "cover", binding: cover.binding, packageId, pages: 1, widthIn: cover.widthIn, heightIn: cover.heightIn }));
}

const conceptSpecPath = resolve(tempRoot, "concept-spec.json");
writeFileSync(conceptSpecPath, `${JSON.stringify({ volumes: volumeResults.map(result => ({ subject: result.metadata.subject, volume: result.metadata.volume })) }, null, 2)}\n`, "utf8");
const conceptPdf = resolve(outputRoot, "JJ-University-101-cover-directions-proof.pdf");
runPython(["concepts", conceptSpecPath, conceptPdf]);
outputs.push(outputRecord(conceptPdf, { kind: "cover-directions", pages: 3, widthIn: 16, heightIn: 9 }));

for (const result of volumeResults) {
  result.covers = coverPayload.covers.filter(item => item.volume === result.metadata.volume).map(item => ({
    binding: item.binding,
    path: relativePath(item.output),
    sha256: sha256File(item.output),
  }));
}

const manifest = {
  schemaVersion: 1,
  generatedAtUtc: "2026-08-19T00:00:00Z",
  status: "proof-only-not-for-sale",
  sourceModel: "checked-in public/books.json plus checked-in public/book-content JSON",
  metadataModel: {
    series: "JJ University 101",
    titles: ["The Natural World", "The Human World"],
    volumeDesignations: ["Volume I", "Volume II"],
    author: "James Johnson",
  },
  packageCandidates: {
    paperback: "0600X0900.BW.STD.PB.060UC444.MXX",
    casewrap: "0600X0900.BW.STD.CW.060UC444.MXX",
  },
  inputs: [
    { path: relativePath(booksPath), sha256: sha256File(booksPath) },
    { path: relativePath(productPath), sha256: sha256File(productPath) },
    { path: relativePath(manifestPath), sha256: sha256File(manifestPath) },
    { path: relativePath(generatorPath), sha256: sha256File(generatorPath) },
    { path: relativePath(toolsPath), sha256: sha256File(toolsPath) },
    { path: relativePath(disclaimerModulePath), sha256: sha256File(disclaimerModulePath) },
    { path: relativePath(printDisclaimerConfigPath), sha256: sha256File(printDisclaimerConfigPath) },
    { path: relativePath(bookDisclaimerConfigPath), sha256: sha256File(bookDisclaimerConfigPath) },
    ...sourceEvidence,
  ],
  volumes: volumeResults.map(result => ({
    productSlug: result.product.slug,
    title: result.metadata.subject,
    volume: result.metadata.volume,
    disclaimerProfileIds: result.disclaimerPlan.profileIds,
    bookDisclaimerReviews: result.disclaimerPlan.bookReviews,
    pageCount: result.pageCount,
    dividerPages: result.pageMap,
    cleanPagesWithoutFolios: result.cleanPages,
    paginationAudit: {
      intentionalBlankPages: result.pageAudit.intentionalBlankPages,
      emptyUnmarkedPages: result.pageAudit.emptyUnmarkedPages,
      sparseNarrativePages: result.pageAudit.sparseNarrativePages,
    },
    interior: { path: relativePath(result.finalPdf), sha256: sha256File(result.finalPdf) },
    covers: result.covers,
    luluCoverDimensions: result.dimensions,
  })),
  outputs,
};
const proofManifestPath = resolve(outputRoot, "JJ-University-101-proof-manifest.json");
writeFileSync(proofManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ manifest: proofManifestPath, outputs, volumes: manifest.volumes }, null, 2));

function renderInterior(product, metadata, payloads, { pads, pageMap, includeEndBlank, disclaimerPlan }) {
  const copyrightYear = 2026;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(metadata.series)}: ${escapeHtml(metadata.subject)} ${escapeHtml(metadata.volume)}</title>
<style>
  @page { size: 6in 9in; margin-top: .70in; margin-bottom: .72in; }
  @page :right { margin-left: .95in; margin-right: .62in; }
  @page :left { margin-left: .62in; margin-right: .95in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { color: #171511; background: #fff; font-family: Georgia, "Times New Roman", serif; font-size: 10.8pt; line-height: 1.47; text-rendering: optimizeLegibility; hyphens: auto; }
  p, ol, ul, h1, h2, h3 { margin-top: 0; }
  .page { break-before: page; page-break-before: always; }
  .titleLeaf:first-child { break-before: auto; page-break-before: auto; }
  .cleanPage { min-height: 7.58in; }
  .proofMarker { display: block; width: 1px; height: 0; overflow: visible; color: #fff; font-size: 1pt; line-height: 0; white-space: nowrap; }
  .titleLeaf { min-height: 7.58in; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; }
  .series { margin-bottom: .34in; font: 700 8.5pt/1.2 Arial, sans-serif; letter-spacing: .16em; text-transform: uppercase; }
  .titleLeaf h1 { max-width: 4.15in; margin: 0; font: 700 34pt/.92 Arial, sans-serif; letter-spacing: -.035em; text-transform: uppercase; }
  .titleLeaf .volume { margin: .22in 0 .60in; font: 700 11pt/1.2 Arial, sans-serif; letter-spacing: .14em; text-transform: uppercase; }
  .goldRule { width: .82in; height: 2px; margin-bottom: .18in; background: #8d6b2d; }
  .author { font: 700 9pt/1.2 Arial, sans-serif; letter-spacing: .14em; text-transform: uppercase; }
  .legal { min-height: 7.58in; padding-top: .04in; color: #2c2924; font-size: 8.5pt; line-height: 1.259; }
  .legal p { margin-bottom: .055in; }
  .legal .legalIdentity { margin: 0 0 .14in; text-align: center; }
  .legal .legalSubject { display: block; margin-bottom: .015in; font-size: 12.5pt; line-height: 14.5pt; }
  .legal .legalMeta { display: block; font-size: 8.5pt; line-height: 10.7pt; }
  .legal .legalAuthor { font-style: italic; }
  .legal .noticeLead { margin: .09in 0 .065in; color: #5c554c; font-style: italic; }
  .disclaimerBlock { break-inside: avoid; page-break-inside: avoid; }
  .disclaimerBlock em { color: #2c2924; font-family: Georgia, "Times New Roman", serif; font-style: italic; }
  .toc { min-height: 7.58in; padding-top: .05in; }
  .toc h2, .about h2 { margin: 0 0 .32in; font: 700 24pt/1 Arial, sans-serif; letter-spacing: -.025em; }
  .toc ol { margin: 0; padding: 0; list-style: none; }
  .toc li { display: grid; grid-template-columns: .38in 1fr auto; gap: .11in; padding: .12in 0; border-bottom: .5px solid #c9c4ba; font-size: 10.5pt; }
  .toc .n, .toc .p { font: 700 8.5pt/1.5 Arial, sans-serif; letter-spacing: .08em; }
  .toc .work strong { display: block; font-family: Arial, sans-serif; font-size: 10pt; }
  .blank { height: 1pt; min-height: 1pt; }
  .bookDivider { min-height: 7.58in; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; border-top: 2px solid #171511; border-bottom: 1px solid #171511; }
  .bookDivider .bookNumber { margin-bottom: .28in; font: 700 8.5pt/1.2 Arial, sans-serif; letter-spacing: .16em; text-transform: uppercase; }
  .bookDivider h2 { max-width: 4.2in; margin: 0; font: 700 29pt/.94 Arial, sans-serif; letter-spacing: -.035em; }
  .bookDivider .subtitle { max-width: 3.9in; margin: .16in 0 0; color: #4c473f; font-size: 11pt; font-style: italic; }
  .bookDivider .description { max-width: 4.05in; margin: .40in 0 0; font-size: 10.2pt; line-height: 1.45; }
  .bookDivider .sectionCount { margin: .34in 0 0; font: 700 8pt/1.2 Arial, sans-serif; letter-spacing: .11em; text-transform: uppercase; }
  .section { break-before: page; page-break-before: always; padding-top: .04in; }
  .section h2 { margin: 0 0 .27in; text-align: left; font: 700 18pt/1.08 Arial, sans-serif; letter-spacing: -.015em; }
  .chapterLabel { display: block; margin-bottom: .08in; font: 700 7.8pt/1.2 Arial, sans-serif; letter-spacing: .13em; text-transform: uppercase; }
  .sectionBody { orphans: 3; widows: 3; }
  .sectionBody p { margin: 0 0 .125in; text-align: justify; orphans: 3; widows: 3; }
  .sectionBody > div > :nth-last-child(4), .sectionBody > :not(div):nth-last-child(4),
  .sectionBody > div > :nth-last-child(3), .sectionBody > :not(div):nth-last-child(3),
  .sectionBody > div > :nth-last-child(2), .sectionBody > :not(div):nth-last-child(2) { break-after: avoid-page; page-break-after: avoid; }
  .sectionBody > div > :last-child, .sectionBody > :not(div):last-child { break-inside: avoid; page-break-inside: avoid; }
  .section-philosophy-0 .sectionBody > div > :nth-last-child(-n+4) { break-inside: avoid; page-break-inside: avoid; }
  .section-biology-8 .sectionBody > div > :nth-last-child(-n+4) { break-inside: avoid; page-break-inside: avoid; }
  .sectionBody p:first-of-type::first-letter { float: left; padding: .04in .06in 0 0; font-size: 2.6em; line-height: .78; }
  .sectionBody ul, .sectionBody ol { margin: .06in 0 .15in; padding-left: .24in; }
  .sectionBody li { margin-bottom: .04in; }
  .sectionBody h2, .sectionBody h3 { margin: .18in 0 .12in; font-family: Arial, sans-serif; }
  .sectionBody img, .sectionBody iframe, .sectionBody video, .sectionBody audio { display: none !important; }
  .about { min-height: 7.58in; display: flex; flex-direction: column; justify-content: center; }
  .about p { max-width: 4in; }
</style>
</head>
<body>
  <section class="titleLeaf cleanPage"><span class="proofMarker">PAGETYPE:CLEAN</span><p class="series">${escapeHtml(metadata.series)}</p><h1>${escapeHtml(metadata.subject)}</h1><p class="volume">${escapeHtml(metadata.volume)}</p><div class="goldRule"></div><p class="author">James Johnson</p></section>
  <section class="legal cleanPage page"><span class="proofMarker">PAGETYPE:CLEAN</span>${renderLegalPageContent(metadata, disclaimerPlan, copyrightYear)}</section>
  <section class="toc cleanPage page"><span class="proofMarker">PAGETYPE:CLEAN</span><h2>Contents</h2><ol>${payloads.map(({ book }, index) => `<li><span class="n">${String(index + 1).padStart(2, "0")}</span><span class="work"><strong>${escapeHtml(book.title)}</strong></span><span class="p">${String(pageMap[book.id] || "000").padStart(3, "0")}</span></li>`).join("")}</ol></section>
  ${payloads.map((payload, index) => renderBook(payload, index + 1, pads.has(payload.book.id))).join("\n")}
  <section class="about page"><h2>About JJ University</h2><p>JJ University is a free digital library of short books about science, history, religion, psychology, power, money, and the systems underneath ordinary life.</p><p>Read the complete digital library free at JJUniversity.com.</p></section>
  ${includeEndBlank ? `<section class="blank cleanPage page"><span class="proofMarker">PAGETYPE:CLEAN</span></section>` : ""}
</body>
</html>`;
}

function renderLegalPageContent(metadata, disclaimerPlan, copyrightYear) {
  return `<p class="legalIdentity"><span class="legalSubject">${escapeHtml(metadata.subject)}</span><span class="legalMeta">${escapeHtml(metadata.volume)} of ${escapeHtml(metadata.series)}<br><span class="legalAuthor">James Johnson</span></span></p><p>Copyright &copy; ${copyrightYear} James Johnson. All rights reserved.<br>Published by JJ University. JJUniversity.com</p><p>No part of this publication may be reproduced, distributed, or transmitted without prior written permission, except for brief quotations and other uses permitted by law.</p><p>JJ University books use a human-directed process that can include AI-assisted research and early drafting. James Johnson selects the subjects, directs the structure and scope, and substantially revises and edits the work.</p><p>First JJ University print proof, ${copyrightYear}. Not for sale.</p><p class="noticeLead">The following notes apply where relevant to portions of this volume.</p>${renderDisclaimerBlocks(disclaimerPlan.blocks)}`;
}

function renderDisclaimerBlocks(blocks) {
  return blocks.map(block => `<p class="disclaimerBlock"><em>${escapeHtml(block.heading)}.</em> ${escapeHtml(block.paragraphs.join(" "))}</p>`).join("");
}

function renderBook({ book, sections, description }, position, addPad) {
  return `${addPad ? `<section class="blank cleanPage page"><span class="proofMarker">PAGETYPE:CLEAN</span></section>` : ""}<section class="bookDivider cleanPage page"><span class="proofMarker">PAGETYPE:CLEAN BOOKSTART:${escapeHtml(book.id)}</span><p class="bookNumber">Book ${position}</p><h2>${escapeHtml(book.title)}</h2>${book.subtitle ? `<p class="subtitle">${escapeHtml(book.subtitle)}</p>` : ""}<p class="description">${escapeHtml(description)}</p><p class="sectionCount">${sections.length} sections</p></section>${sections.map((section, index) => renderSection(section, book.id, index)).join("\n")}`;
}

function renderSection(section, bookId, sectionIndex) {
  const title = sectionTitle(section.title);
  const body = cleanSectionHtml(section.html);
  return `<section class="section section-${escapeHtml(bookId)}-${sectionIndex}">${title.label ? `<span class="chapterLabel">${escapeHtml(title.label)}</span>` : ""}<h2>${escapeHtml(title.heading)}</h2><div class="sectionBody">${body}</div></section>`;
}

function bodySections(sections, book) {
  return sections.filter(section => !isNonBodySection(section, book)).map(section => ({ ...section, html: cleanSectionHtml(section.html) })).filter(section => stripHtml(section.html).length > 0);
}

function isNonBodySection(section, book) {
  const title = normalizeTitle(section.title);
  const kind = String(section.kind || "").toLowerCase().trim();
  const nonBodyKinds = new Set(["toc", "dedication", "title", "title-page", "copyright", "acknowledgments", "acknowledgements", "about-author", "about_the_author"]);
  if (nonBodyKinds.has(kind)) return true;
  if (isGeneratedTitlePage(section, book)) return true;
  return /^(contents|table of contents|dedication|copyright|acknowledg(?:e)?ments?|about the author|also by|other books|notes?)$/i.test(title) || /copyright|acknowledg|about the author|table of contents/i.test(title);
}

function isGeneratedTitlePage(section, book) {
  const title = normalizeTitle(section.title).toLowerCase();
  const text = normalizeTitle(section.text).toLowerCase();
  return title === book.title.toLowerCase() && text.length < 220;
}

function sectionTitle(value) {
  const clean = normalizeTitle(value) || "Section";
  const match = clean.match(/^(chapter\s+(.+?))(?:\s+[-\u2013\u2014]\s+|\s*:\s*)(.+)$/i);
  if (!match) return { label: "", heading: clean };
  return { label: normalizeChapterLabel(match[1]), heading: match[3] };
}

function normalizeChapterLabel(value) {
  const match = value.match(/^chapter\s+(.+)$/i);
  if (!match) return value;
  return `Chapter ${match[1]}`;
}

function cleanSectionHtml(value) {
  return String(value || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<iframe[\s\S]*?<\/iframe>/gi, "").replace(/\son[a-z]+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/\s(class|id|style)=(".*?"|'.*?'|[^\s>]+)/gi, "").replace(/<\/?span[^>]*>/gi, "").replace(/<h2><br\s*\/?><\/h2>/gi, "").replace(/<h[23][^>]*>[\s\S]*?<\/h[23]>/gi, "").replace(/<p><br\s*\/?><\/p>/gi, "").replace(/<nav[\s\S]*?<\/nav>/gi, "").trim();
}

function resolveContentPath(book) {
  const wanted = new Set([fileStem(book.id), fileStem(book.bookFile), fileStem(book.title)].filter(Boolean));
  const record = (contentManifest.books || []).find(item => wanted.has(fileStem(item.id)) || wanted.has(fileStem(item.slug)) || wanted.has(fileStem(item.sourceFile)) || wanted.has(fileStem(basename(item.path || ""))));
  if (!record?.path) fail(`No content JSON found for ${book.id}.`);
  return resolve(root, "public", "book-content", basename(record.path));
}

function assertDescriptions(payloads) {
  const banned = /\b(witty|vivid|brilliant|definitive|essential|masterful|sweeping|wild|greatest|captivating|engaging)\b/i;
  const failures = payloads.filter(item => !item.description || banned.test(item.description));
  if (failures.length) fail(`Non-neutral print descriptions: ${failures.map(item => item.book.id).join(", ")}`);
}

async function fetchCoverDimensions(pageCount) {
  const packageIds = {
    paperback: "0600X0900.BW.STD.PB.060UC444.MXX",
    casewrap: "0600X0900.BW.STD.CW.060UC444.MXX",
  };
  const token = await getLuluToken();
  const entries = await Promise.all(Object.entries(packageIds).map(async ([binding, packageId]) => {
    const response = await fetch("https://api.sandbox.lulu.com/cover-dimensions/", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ pod_package_id: packageId, interior_page_count: pageCount, unit: "inch" }),
    });
    const data = await response.json();
    if (!response.ok) fail(`Lulu cover dimensions failed for ${packageId}: ${JSON.stringify(data)}`);
    return [binding, { packageId, width: Number(data.width), height: Number(data.height), unit: data.unit }];
  }));
  return Object.fromEntries(entries);
}

async function getLuluToken() {
  const key = process.env.LULU_CLIENT_KEY;
  const secret = process.env.LULU_CLIENT_SECRET;
  if (!key || !secret) fail("Missing Lulu sandbox credentials.");
  const response = await fetch("https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) fail(`Lulu sandbox auth failed with status ${response.status}.`);
  return data.access_token;
}

function readMarkers(pdfPath) {
  const result = runPython(["markers", pdfPath], true);
  return JSON.parse(result.stdout.trim());
}

function readPageAudit(pdfPath) {
  const result = runPython(["audit", pdfPath], true);
  return JSON.parse(result.stdout.trim());
}

function runPython(args, capture = false) {
  const result = spawnSync("python", [toolsPath, ...args], { cwd: root, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0) fail(`PDF helper failed: python ${args.join(" ")}\n${result.stderr || ""}`);
  return result;
}

function renderPdf(htmlPath, pdfPath) {
  if (existsSync(pdfPath)) rmSync(pdfPath);
  const chrome = findChrome();
  const profileDirectory = mkdtempSync(resolve(tmpdir(), "jju-print-"));
  const result = spawnSync(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-gpu-sandbox", "--disable-software-rasterizer", "--disable-gpu-compositing", "--no-first-run", `--user-data-dir=${profileDirectory}`, "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href], { stdio: "inherit" });
  const outputReady = waitForPdf(pdfPath);
  try { rmSync(profileDirectory, { recursive: true, force: true }); } catch { /* Detached browser helpers can briefly retain the temp profile. */ }
  if (result.status !== 0 || !outputReady) fail(`Chrome PDF generation failed for ${htmlPath}.`);
}

function waitForPdf(pdfPath, timeoutMs = 30000, stableMs = 1200) {
  const deadline = Date.now() + timeoutMs;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let stableFingerprint = "";
  let stableSince = 0;
  while (Date.now() < deadline) {
    if (existsSync(pdfPath)) {
      const bytes = readFileSync(pdfPath);
      const header = bytes.subarray(0, 5).toString("ascii");
      const tail = bytes.subarray(Math.max(0, bytes.length - 1024)).toString("ascii");
      if (header === "%PDF-" && tail.includes("%%EOF")) {
        const fingerprint = `${bytes.length}:${createHash("sha256").update(bytes).digest("hex")}`;
        if (fingerprint !== stableFingerprint) {
          stableFingerprint = fingerprint;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= stableMs) {
          return true;
        }
      }
    }
    Atomics.wait(pause, 0, 0, 100);
  }
  return false;
}

function outputRecord(path, extra) {
  return { path: relativePath(path), sha256: sha256File(path), bytes: readFileSync(path).length, ...extra };
}

function normalizeBook(raw) {
  return { id: String(raw.id || "").trim().toLowerCase(), title: String(raw.title || raw.id || "Untitled").trim(), subtitle: String(raw.subtitle || "").trim(), description: String(raw.description || "").trim(), bookFile: String(raw.bookFile || "").trim() };
}

function loadLocalEnv(fileName) {
  const filePath = resolve(root, fileName);
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function findChrome() {
  const candidates = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].filter(Boolean);
  const selected = candidates.find(existsSync);
  if (!selected) fail("Chrome or Edge is required for proof generation.");
  return selected;
}

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function sha256File(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function relativePath(path) { return resolve(path).replace(`${root}\\`, "").replaceAll("\\", "/"); }
function normalizeTitle(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function stripHtml(value) { return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function fileStem(value) { return String(value || "").replace(/\.(json|epub|jpg|jpeg|png|webp)$/i, "").trim().toLowerCase(); }
function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function fail(message) { console.error(message); process.exit(1); }
