import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = process.argv.slice(2);
const requestedSlug = slugify(args.find(arg => !arg.startsWith("--")) || "101-volume-1");
const htmlOnly = args.includes("--html-only");
const coverOnly = args.includes("--cover-only");
const interiorOnly = args.includes("--interior-only");
const pageCountOverride = numberArg("--page-count");

const books = readJson("public/books.json").map(normalizeBook).filter(book => book.id);
const manifest = readJson("public/book-content/manifest.json");
const products = readJson("public/print-products.json").map(normalizeProduct);
const approvedBrandMark = readFileSync(
  resolve(root, "public", "branding", "jju", "jju-mark-gold.svg"),
  "utf8",
).replace(/<\?xml[\s\S]*?\?>/i, "").trim();
const requestedProduct = products.find(item => item.slug === requestedSlug);

if (!requestedProduct) {
  fail(`Unknown print product "${requestedSlug}".`);
}

const renderProducts = resolveRenderableProducts(requestedProduct);

for (const product of renderProducts) {
  generateProduct(product);
}

function generateProduct(product) {
  const productBooks = product.bookIds
    .map(bookId => books.find(book => book.id === String(bookId).toLowerCase()))
    .filter(Boolean);

  if (!productBooks.length) {
    fail(`No books found for "${product.slug}".`);
  }

  const outputRoot = join(root, "generated", "paperbacks", product.slug);
  const interiorHtmlPath = join(outputRoot, "interior.html");
  const interiorPdfPath = join(outputRoot, "interior.pdf");
  const coverHtmlPath = join(outputRoot, "cover-wrap.html");
  const coverPdfPath = join(outputRoot, "cover-wrap.pdf");
  let interiorPageCount = pageCountOverride || estimateInteriorPages(productBooks);

  mkdirSync(outputRoot, { recursive: true });

  if (!coverOnly) {
    writeFileSync(interiorHtmlPath, renderInterior(product, productBooks), "utf8");
    if (!htmlOnly) {
      renderPdf(interiorHtmlPath, interiorPdfPath);
      interiorPageCount = countPdfPages(interiorPdfPath) || interiorPageCount;
    }
  }

  if (!interiorOnly) {
    writeFileSync(coverHtmlPath, renderCoverWrap(product, productBooks, interiorPageCount), "utf8");
    if (!htmlOnly) {
      renderPdf(coverHtmlPath, coverPdfPath);
    }
  }

  console.log(`Paperback output: ${outputRoot}`);
  if (!coverOnly) console.log(`  Interior: ${interiorHtmlPath}${htmlOnly ? "" : ` / ${interiorPdfPath}`}`);
  if (!interiorOnly) console.log(`  Cover:    ${coverHtmlPath}${htmlOnly ? "" : ` / ${coverPdfPath}`}`);
  console.log(`  ${productBooks.length} books / ${interiorPageCount} interior pages / ${product.title}`);
}

function renderInterior(printProduct, productBooks) {
  const bookPayloads = productBooks.map(book => ({
    book,
    content: readBook(book),
  })).map(payload => ({
    ...payload,
    sections: bodySections(payload.content.sections, payload.book),
  }));

  const copyrightYear = printProduct.copyrightYear || new Date().getFullYear();
  const isbn = printProduct.isbn.replace(/[^0-9X]/gi, "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(printProduct.title)} Interior</title>
  <style>
    @page {
      size: 6in 9in;
      margin: 0.72in 0.62in 0.78in;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      color: #17120d;
      background: #fff;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 11pt;
      line-height: 1.5;
      text-rendering: optimizeLegibility;
      hyphens: auto;
    }

    h1, h2, h3, p, ol, ul { margin-top: 0; }

    .pageBreak,
    .bookDivider,
    .section,
    .backMatter {
      break-before: page;
      page-break-before: always;
    }

    .titleLeaf:first-child {
      break-before: auto;
      page-break-before: auto;
    }

    .titleLeaf {
      min-height: 7.25in;
      display: grid;
      align-content: center;
      justify-items: center;
      text-align: center;
    }

    .kicker,
    .bookNumber {
      color: #9a742d;
      font: 700 8pt/1.25 Arial, sans-serif;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    .chapterLabel {
      color: #7a5b2a;
      font: italic 11pt/1.25 Georgia, "Times New Roman", serif;
      letter-spacing: 0;
      text-transform: none;
    }

    .titleLeaf h1 {
      max-width: 4.8in;
      margin: 0 0 0.18in;
      font-size: 31pt;
      line-height: 0.96;
    }

    .titleLeaf .subtitle {
      max-width: 4.1in;
      margin-bottom: 0.18in;
      color: #5a4b3a;
      font-size: 13pt;
      font-style: italic;
      line-height: 1.28;
    }

    .titleLeaf .author,
    .titleLeaf .meta {
      color: #3b3025;
      font: 700 8.5pt/1.5 Arial, sans-serif;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .legalPage,
    .volumeNote,
    .tocPage,
    .backMatter {
      min-height: 7.25in;
      padding-top: 0.1in;
    }

    .legalPage h2,
    .volumeNote h2,
    .tocPage h2,
    .backMatter h2 {
      margin-bottom: 0.18in;
      text-align: center;
      font-size: 18pt;
      line-height: 1.1;
    }

    .legalPage p,
    .volumeNote p,
    .backMatter p,
    .backMatter li {
      font-size: 10.5pt;
      line-height: 1.5;
    }

    .legalPage {
      display: grid;
      align-content: end;
      color: #4d4034;
      font-size: 9.5pt;
    }

    .tocPage ol {
      margin: 0;
      padding-left: 0.24in;
    }

    .tocPage > ol > li {
      margin-bottom: 0.13in;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .tocPage strong {
      font-size: 10.5pt;
    }

    .tocPage ol ol {
      margin-top: 0.05in;
      color: #4d4034;
      font-size: 9.2pt;
      line-height: 1.35;
    }

    .bookDivider {
      min-height: 7.25in;
      display: grid;
      align-content: center;
      justify-items: center;
      text-align: center;
      border-top: 1px solid #c2a56d;
      border-bottom: 1px solid #c2a56d;
    }

    .bookDivider h2 {
      max-width: 4.6in;
      margin: 0.12in 0 0.14in;
      font-size: 27pt;
      line-height: 0.98;
    }

    .bookDivider .subtitle {
      max-width: 4.1in;
      margin-bottom: 0.22in;
      color: #5a4b3a;
      font-size: 12.5pt;
      font-style: italic;
    }

    .bookDivider .description {
      max-width: 4.2in;
      color: #4d4034;
      font-size: 10.5pt;
      line-height: 1.45;
    }

    .section {
      padding-top: 0.08in;
    }

    .section h2 {
      margin: 0 0 0.26in;
      text-align: center;
      font-size: 18pt;
      line-height: 1.12;
    }

    .chapterLabel {
      display: block;
      margin-bottom: 0.08in;
      text-align: center;
    }

    .sectionBody {
      orphans: 3;
      widows: 3;
    }

    .sectionBody p {
      margin: 0 0 0.12in;
      text-align: justify;
    }

    .section.chapter .sectionBody p:first-of-type::first-letter {
      float: left;
      padding-right: 0.06in;
      color: #9a742d;
      font-size: 2.65em;
      line-height: 0.84;
    }

    .sectionBody h2,
    .sectionBody h3 {
      margin: 0.18in 0 0.12in;
      text-align: center;
    }

    .sectionBody strong { font-weight: 700; }
    .sectionBody em { font-style: italic; }
    .sectionBody br { line-height: 1.7; }

    .includedList {
      columns: 2;
      column-gap: 0.35in;
      margin: 0;
      padding-left: 0.22in;
    }
  </style>
</head>
<body>
  <section class="titleLeaf">
    <p class="kicker">${escapeHtml(printProduct.kicker)}</p>
    <h1>${escapeHtml(printProduct.title)}</h1>
    <p class="subtitle">${escapeHtml(printProduct.subtitle || printProduct.description || "")}</p>
    <p class="author">James Johnson</p>
    <p class="meta">${escapeHtml(printProduct.includedLine || `${productBooks.length} books`)}</p>
  </section>

  <section class="legalPage pageBreak">
    <p><strong>${escapeHtml(printProduct.title)}</strong>${printProduct.subtitle ? `<br>${escapeHtml(printProduct.subtitle)}` : ""}<br>James Johnson</p>
    <p>Copyright © ${copyrightYear} James Johnson.<br>All rights reserved.</p>
    <p>Published by JJ University.<br>JJUniversity.com</p>
    <p>No part of this publication may be reproduced, distributed, or transmitted in any form without prior written permission, except for brief quotations and other uses permitted by law.</p>
    <p>This publication is intended for general educational purposes. It is not medical, legal, financial, or other professional advice.</p>
    <p>JJ University uses a human-directed editorial process that includes AI-assisted research and early drafting. James Johnson selects each subject, directs the structure and scope, and substantially revises and edits the final work.</p>
    <p>Names, brands, and trademarks belong to their respective owners and are used for identification, commentary, and educational discussion.</p>
    <p>First JJ University print edition, ${copyrightYear}.<br>${isbn ? `ISBN ${escapeHtml(isbn)}<br>` : ""}Internal SKU: ${escapeHtml(printProduct.sku || printProduct.slug)}.</p>
  </section>

  <section class="volumeNote pageBreak">
    <h2>How This Volume Works</h2>
    <p>This book collects separate JJ University short books into one physical curriculum volume. Each included book keeps its own internal chapter structure, but repeated digital front matter has been removed so the collection reads like one continuous paperback.</p>
    <p>The goal is simple: a shelf-ready path through the core ideas, with the free digital library still available for reading, searching, and sharing online.</p>
  </section>

  ${renderToc(bookPayloads)}
  ${bookPayloads.map((payload, index) => renderBookBody(payload, index + 1)).join("\n")}
  ${renderBackMatter(printProduct, productBooks)}
</body>
</html>`;
}

function renderToc(bookPayloads) {
  return `<section class="tocPage pageBreak">
    <h2>Contents</h2>
    <ol>
      ${bookPayloads.map(({ book, sections }, index) => `<li>
        <strong>Book ${index + 1}: ${escapeHtml(book.title)}</strong>
        <ol>
          ${sections.map(section => `<li>${escapeHtml(sectionTitle(section.title).display)}</li>`).join("\n")}
        </ol>
      </li>`).join("\n")}
    </ol>
  </section>`;
}

function renderBookBody({ book, sections }, position) {
  return `<section class="bookDivider">
    <p class="bookNumber">Book ${position}</p>
    <h2>${escapeHtml(book.title)}</h2>
    ${book.subtitle ? `<p class="subtitle">${escapeHtml(book.subtitle)}</p>` : ""}
    ${book.description ? `<p class="description">${escapeHtml(book.description)}</p>` : ""}
  </section>
  ${sections.map(section => renderSection(section)).join("\n")}`;
}

function renderSection(section) {
  const title = sectionTitle(section.title);
  const body = cleanSectionHtml(section.html);
  const sectionClass = title.label ? "section chapter" : "section";

  return `<section class="${sectionClass}">
    ${title.label ? `<span class="chapterLabel">${escapeHtml(title.label)}</span>` : ""}
    <h2>${escapeHtml(title.heading)}</h2>
    <div class="sectionBody">${body}</div>
  </section>`;
}

function renderBackMatter(printProduct, productBooks) {
  return `<section class="backMatter">
    <h2>Included Works</h2>
    <ol class="includedList">
      ${productBooks.map(book => `<li>${escapeHtml(book.title)}</li>`).join("\n")}
    </ol>
  </section>

  <section class="backMatter">
    <h2>About JJ University</h2>
    <p>JJ University is a free digital library of short books about science, history, religion, psychology, power, money, and the systems underneath ordinary life.</p>
    <p>This paperback exists for readers who want the same material as a physical object: something to mark up, keep nearby, lend out, or put on a shelf.</p>
    <p>Read the full digital library free at JJUniversity.com.</p>
  </section>`;
}

function renderCoverWrap(printProduct, productBooks, interiorPageCount) {
  const trim = parseTrimSize(printProduct.format.trimSize);
  const bleed = 0.125;
  const spine = spineWidth(interiorPageCount);
  const spreadWidth = trim.width * 2 + spine + bleed * 2;
  const spreadHeight = trim.height + bleed * 2;
  const theme = printProduct.coverTheme;
  const titleParts = coverTitleParts(printProduct);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(printProduct.title)} Cover Wrap</title>
  <style>
    @page {
      size: ${spreadWidth.toFixed(3)}in ${spreadHeight.toFixed(3)}in;
      margin: 0;
    }

    * { box-sizing: border-box; }

    html,
    body {
      width: ${spreadWidth.toFixed(3)}in;
      height: ${spreadHeight.toFixed(3)}in;
      margin: 0;
      color: #fff8eb;
      background: ${theme.background};
      font-family: Arial, sans-serif;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }

    .spread {
      position: relative;
      width: ${spreadWidth.toFixed(3)}in;
      height: ${spreadHeight.toFixed(3)}in;
      overflow: hidden;
      background:
        radial-gradient(circle at 72% 20%, ${theme.accent}44, transparent 28%),
        radial-gradient(circle at 18% 82%, ${theme.secondary}38, transparent 34%),
        linear-gradient(135deg, ${theme.background}, #050506 76%);
    }

    .spread::before {
      content: "";
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px);
      background-size: .34in .34in;
      opacity: .25;
    }

    .panel {
      position: absolute;
      top: ${bleed}in;
      width: ${trim.width}in;
      height: ${trim.height}in;
      padding: .42in;
      overflow: hidden;
    }

    .back { left: ${bleed}in; }
    .front { left: ${(bleed + trim.width + spine).toFixed(3)}in; }

    .spine {
      position: absolute;
      left: ${(bleed + trim.width).toFixed(3)}in;
      top: ${bleed}in;
      width: ${spine.toFixed(3)}in;
      height: ${trim.height}in;
      border-left: 1px solid rgba(255,255,255,.2);
      border-right: 1px solid rgba(255,255,255,.2);
      background: rgba(0,0,0,.28);
      display: grid;
      place-items: center;
    }

    .spineText {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      color: #fff4d0;
      font-size: 13pt;
      font-weight: 900;
      letter-spacing: .14em;
      text-transform: uppercase;
      text-align: center;
    }

    .kicker,
    .meta {
      color: ${theme.secondary};
      font-size: 9pt;
      font-weight: 900;
      letter-spacing: .18em;
      text-transform: uppercase;
    }

    .front {
      display: grid;
      align-content: center;
      justify-items: start;
      gap: .16in;
    }

    .front h1 {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 52pt;
      line-height: .86;
      letter-spacing: -.01em;
      text-transform: uppercase;
    }

    .front .volume {
      color: ${theme.accent};
      font-size: 18pt;
      font-weight: 900;
      letter-spacing: .1em;
      text-transform: uppercase;
    }

    .front .subtitle {
      max-width: 4.6in;
      margin: .06in 0 .2in;
      color: #f3e7da;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 21pt;
      line-height: 1.05;
    }

    .front .included {
      max-width: 4.7in;
      color: #d9cdbd;
      font-size: 10pt;
      font-weight: 800;
      line-height: 1.45;
    }

    .front .author {
      align-self: end;
      color: #fff4d0;
      font-size: 11pt;
      font-weight: 900;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    .back {
      display: grid;
      align-content: center;
      gap: .18in;
    }

    .back h2 {
      margin: 0;
      color: #fff4d0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 24pt;
      line-height: 1;
    }

    .back p,
    .back li {
      color: #efe4d5;
      font-size: 10.5pt;
      line-height: 1.45;
    }

    .back ul {
      columns: 2;
      margin: 0;
      padding-left: .18in;
    }

    .brandMark {
      display: block;
      width: .62in;
      height: auto;
    }

    .backMark {
      width: .54in;
      margin-top: .06in;
    }
  </style>
</head>
<body>
  <main class="spread">
    <section class="panel back">
      <p class="kicker">JJ University</p>
      <h2>Eight short books in one physical curriculum.</h2>
      <p>${escapeHtml(printProduct.description)}</p>
      <ul>
        ${productBooks.map(book => `<li>${escapeHtml(book.title)}</li>`).join("\n")}
      </ul>
      <p>Read the full digital library free at JJUniversity.com.</p>
      <div class="brandMark backMark">${approvedBrandMark}</div>
    </section>

    <section class="spine">
      <div class="spineText">${escapeHtml(printProduct.title.replace(/^JJ University\s*/i, "JJU "))}</div>
    </section>

    <section class="panel front">
      <div class="brandMark">${approvedBrandMark}</div>
      <p class="kicker">JJ University</p>
      <h1>${escapeHtml(titleParts.main)}</h1>
      <div class="volume">${escapeHtml(titleParts.volume)}</div>
      <p class="subtitle">${escapeHtml(printProduct.kicker)}</p>
      <p class="included">${escapeHtml(printProduct.includedLine)}</p>
      <p class="meta">${interiorPageCount} interior pages / ${printProduct.format.trimSize} / ${printProduct.format.paperType}</p>
      <p class="author">James Johnson</p>
    </section>

  </main>
</body>
</html>`;
}

function resolveRenderableProducts(product) {
  if (product.kind !== "bundle") return [product];

  const components = product.componentProductSlugs
    .map(slug => products.find(item => item.slug === slug))
    .filter(Boolean);

  if (!components.length) {
    fail(`Bundle "${product.slug}" has no renderable component products.`);
  }

  return components;
}

function bodySections(sections, book) {
  return sections
    .filter(section => !isNonBodySection(section, book))
    .filter(section => cleanSectionHtml(section.html).length > 0);
}

function isNonBodySection(section, book) {
  const title = normalizeTitle(section.title);
  const kind = String(section.kind || "").toLowerCase();

  if (kind === "toc" || kind === "dedication") return true;
  if (isGeneratedTitlePage(section, book)) return true;
  if (/^(contents|dedication|copyright|acknowledgments?|about the author)$/i.test(title)) return true;
  if (/copyright|acknowledg|about the author|contents/.test(title)) return true;

  return false;
}

function sectionTitle(title) {
  const clean = normalizeTitle(title) || "Section";
  const match = clean.match(/^(chapter\s+(.+?))(?:\s+[-\u2013\u2014]\s+|\s*:\s*)(.+)$/i);

  if (!match) {
    return { label: "", heading: clean, display: clean };
  }

  const label = normalizeChapterLabel(match[1]);

  return {
    label,
    heading: match[3],
    display: `${label} - ${match[3]}`,
  };
}

function normalizeChapterLabel(label) {
  const match = String(label || "").trim().match(/^chapter\s+(.+)$/i);
  if (!match) return label;

  const chapterNumber = parseChapterNumber(match[1]);
  return chapterNumber ? `Chapter ${chapterNumber}` : label;
}

function parseChapterNumber(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return 0;

  if (/^\d+$/.test(value)) return Number(value);
  if (/^[ivxlcdm]+$/i.test(value)) return parseRomanNumber(value);

  return parseWordNumber(value);
}

function parseWordNumber(raw) {
  const ones = new Map([
    ["one", 1],
    ["two", 2],
    ["three", 3],
    ["four", 4],
    ["five", 5],
    ["six", 6],
    ["seven", 7],
    ["eight", 8],
    ["nine", 9],
    ["ten", 10],
    ["eleven", 11],
    ["twelve", 12],
    ["thirteen", 13],
    ["fourteen", 14],
    ["fifteen", 15],
    ["sixteen", 16],
    ["seventeen", 17],
    ["eighteen", 18],
    ["nineteen", 19],
  ]);
  const tens = new Map([
    ["twenty", 20],
    ["thirty", 30],
    ["forty", 40],
    ["fifty", 50],
    ["sixty", 60],
    ["seventy", 70],
    ["eighty", 80],
    ["ninety", 90],
  ]);
  const words = raw.replace(/-/g, " ").split(/\s+/).filter(Boolean);

  if (words.length === 1) {
    return ones.get(words[0]) || tens.get(words[0]) || 0;
  }

  if (words.length === 2 && tens.has(words[0]) && ones.has(words[1])) {
    return tens.get(words[0]) + ones.get(words[1]);
  }

  return 0;
}

function parseRomanNumber(raw) {
  const values = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  let previous = 0;

  for (const char of raw.toLowerCase().split("").reverse()) {
    const value = values[char] || 0;
    total += value < previous ? -value : value;
    previous = Math.max(previous, value);
  }

  return total;
}

function isGeneratedTitlePage(section, book) {
  const cleanTitle = normalizeTitle(section.title).toLowerCase();
  const text = String(section.text || "").replace(/\s+/g, " ").trim().toLowerCase();
  return cleanTitle === book.title.toLowerCase() && text.length < 180;
}

function cleanSectionHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(class|id|style)=(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/<\/?span[^>]*>/gi, "")
    .replace(/<h2><br\s*\/?><\/h2>/gi, "")
    .replace(/<h[23][^>]*>[\s\S]*?<\/h[23]>/gi, "")
    .replace(/<p><br\s*\/?><\/p>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .trim();
}

function readBook(book) {
  const contentFile = resolveContentFile(book);
  if (!contentFile) fail(`No content JSON found for ${book.id}.`);
  return readJson(join("public", "book-content", contentFile));
}

function resolveContentFile(book) {
  const wanted = new Set([
    fileStem(book.id),
    fileStem(book.bookFile),
    fileStem(book.title),
  ].filter(Boolean));

  const record = (manifest.books || []).find(item => {
    return wanted.has(fileStem(item.id))
      || wanted.has(fileStem(item.slug))
      || wanted.has(fileStem(item.sourceFile))
      || wanted.has(fileStem(basename(item.path || "")));
  });

  return record?.path ? basename(record.path) : "";
}

function normalizeProduct(raw) {
  const slug = slugify(raw.slug || raw.title);
  return {
    slug,
    sku: String(raw.sku || slug).trim(),
    kind: raw.kind === "bundle" ? "bundle" : "collection",
    title: String(raw.title || slug).trim(),
    kicker: String(raw.kicker || "").trim(),
    subtitle: String(raw.subtitle || "").trim(),
    description: String(raw.description || "").trim(),
    priceHint: String(raw.priceHint || "").trim(),
    targetPriceCents: Number.isFinite(Number(raw.targetPriceCents)) ? Number(raw.targetPriceCents) : null,
    status: String(raw.status || "coming-soon").trim(),
    printStatus: String(raw.printStatus || "draft").trim(),
    salesStatus: String(raw.salesStatus || "not-for-sale").trim(),
    componentProductSlugs: Array.isArray(raw.componentProductSlugs) ? raw.componentProductSlugs.map(slugify) : [],
    format: {
      trimSize: raw.format?.trimSize || "6x9",
      binding: raw.format?.binding || "perfect-bound paperback",
      interiorColor: raw.format?.interiorColor || "black-and-white",
      paperType: raw.format?.paperType || "cream",
      coverFinish: raw.format?.coverFinish || "matte",
    },
    coverTheme: {
      background: raw.coverTheme?.background || "#111111",
      accent: raw.coverTheme?.accent || "#d7a640",
      secondary: raw.coverTheme?.secondary || "#7c6df0",
      mood: raw.coverTheme?.mood || "JJ University print edition",
    },
    includedLine: String(raw.includedLine || "").trim(),
    copyrightYear: Number(raw.copyrightYear || 0) || null,
    isbn: String(raw.isbn || "").trim(),
    bookIds: Array.isArray(raw.bookIds) ? raw.bookIds.map(bookId => String(bookId).toLowerCase()) : [],
  };
}

function normalizeBook(raw) {
  return {
    id: String(raw.id || "").trim().toLowerCase(),
    title: String(raw.title || raw.id || "Untitled").trim(),
    subtitle: String(raw.subtitle || "").trim(),
    description: String(raw.description || "").trim(),
    bookFile: String(raw.bookFile || "").trim(),
    coverFile: String(raw.coverFile || "").trim(),
    wordCount: Number(raw.wordCount || 0),
  };
}

function estimateInteriorPages(selectedBooks) {
  const words = selectedBooks.reduce((sum, book) => sum + (book.wordCount || 0), 0);
  const bodyPages = Math.ceil(words / 155);
  const sectionPages = selectedBooks.length * 2;
  return Math.max(32, bodyPages + sectionPages + 8);
}

function spineWidth(pageCount) {
  return Number(pageCount || 32) / 444 + 0.06;
}

function parseTrimSize(value) {
  const match = String(value || "6x9").match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!match) return { width: 6, height: 9 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function coverTitleParts(product) {
  const volumeMatch = product.title.match(/Volume\s+([IVXLCDM]+|\d+)/i);
  return {
    main: "101",
    volume: volumeMatch ? `Volume ${volumeMatch[1]}` : product.kicker || product.title,
  };
}

function countPdfPages(filePath) {
  try {
    const pdf = readFileSync(filePath, "latin1");
    return (pdf.match(/\/Type\s*\/Page\b/g) || []).length;
  } catch {
    return 0;
  }
}

function renderPdf(htmlPath, pdfPath) {
  const chromePath = findChrome();
  if (!chromePath) {
    fail("Could not find Chrome. Re-run with --html-only or set CHROME_PATH.");
  }

  const result = spawnSync(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href,
  ], { stdio: "inherit" });

  if (result.status !== 0) {
    fail(`Chrome PDF generation failed for ${htmlPath} with exit code ${result.status}.`);
  }
}

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fileStem(value) {
  return String(value || "")
    .replace(/\.(json|epub|jpg|jpeg|png|webp)$/i, "")
    .trim()
    .toLowerCase();
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u02bc]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(resolve(root, filePath), "utf8"));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function numberArg(name) {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (!inline) return 0;
  const value = Number(inline.slice(name.length + 1));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);

  return candidates.find(candidate => existsSync(candidate));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
