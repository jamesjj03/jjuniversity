import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const toolDir = __dirname;
const bookDir = path.join(rootDir, "private", "book-content");
const outputDir = path.join(toolDir, "gold-output");
const styleGuidePath = path.join(toolDir, "gold-style-guide.md");
const envLocalPath = path.join(rootDir, ".env.local");
const port = Number(process.env.GOLD_CLEANER_PORT || 4343);

const AI_RULES = `You are cleaning a James Johnson book into Gold Edition style.

Rules:
- Preserve meaning and facts.
- Do not add new facts.
- Do not fact-check.
- Remove all em dashes.
- Replace AI-like phrasing with natural, clean prose.
- Preserve chapter structure, paragraph intent, and HTML formatting.
- Return valid section HTML when the input is HTML.
- Keep paragraph tags, headings, italics, lists, links, blockquotes, and title/subtitle structure.
- Remove bold/strong formatting unless it is inside a chapter heading, chapter title, book title, subtitle, or other heading tag.
- Preserve real quoted passages. Do not invent quotes, speakers, or citations.
- Fix broken quote/apostrophe punctuation only when it is obvious mojibake or typography cleanup.
- Keep James Johnson's direct, readable voice.
- Do not make it ornate, academic, poetic, corporate, or fake-professional.
- Output only the cleaned HTML/text, with no explanation.`;

async function loadEnvFile(file) {
  if (!(await exists(file))) return;
  const text = await readFile(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function readEnvFile(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  const lines = text ? text.split(/\r?\n/) : [];
  const values = new Map();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    values.set(trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, ""));
  }

  return { text, lines, values };
}

async function writeEnvValue(file, updates) {
  const current = await readEnvFile(file);
  const updatedKeys = new Set(Object.keys(updates));
  const nextLines = [];

  for (const line of current.lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      nextLines.push(line);
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    if (updatedKeys.has(key)) {
      nextLines.push(`${key}=${updates[key]}`);
      updatedKeys.delete(key);
    } else {
      nextLines.push(line);
    }
  }

  for (const key of updatedKeys) nextLines.push(`${key}=${updates[key]}`);

  await writeFile(file, `${nextLines.filter((line, index, arr) => line || index < arr.length - 1).join("\n")}\n`, "utf8");
  Object.entries(updates).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

function send(res, status, body, type = "application/json") {
  const payload = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function plainText(html = "") {
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function textFromHtml(html = "") {
  return plainText(html)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function countMatches(text, pattern) {
  return (String(text).match(pattern) || []).length;
}

function residueFor(text) {
  const raw = String(text || "");
  const emDash = countMatches(raw, /—|â€”/g);
  const filler =
    countMatches(raw, /\bin many ways\b/gi) +
    countMatches(raw, /\bnot only\b/gi) +
    countMatches(raw, /\bbut also\b/gi) +
    countMatches(raw, /\bit was not just\b/gi) +
    countMatches(raw, /\bmore than just\b/gi) +
    countMatches(raw, /\bin essence\b/gi);
  return {
    emDash,
    score: emDash + filler * 5,
  };
}

function splitIntoWordChunks(text, maxWords = 3200) {
  const normalized = String(text || "");
  const htmlBlocks = normalized.includes("<p") || normalized.includes("<h")
    ? normalized
      .replace(/(<\/(?:p|h[1-6]|li|blockquote|div|nav|ol|ul)>)/gi, "$1\n\n")
      .split(/\n{2,}/)
    : normalized.split(/\n{2,}/);
  const paragraphs = htmlBlocks.map(item => item.trim()).filter(Boolean);
  const chunks = [];
  let current = [];
  let currentWords = 0;

  for (const paragraph of paragraphs) {
    const wordCount = paragraph.split(/\s+/).filter(Boolean).length;
    if (wordCount > maxWords) {
      if (current.length) chunks.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
      const words = paragraph.split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords).join(" "));
      continue;
    }
    if (currentWords + wordCount > maxWords && current.length) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }
    current.push(paragraph);
    currentWords += wordCount;
  }

  if (current.length) chunks.push(current.join("\n\n"));
  return chunks.length ? chunks : [String(text || "")];
}

function stripNonTitleBold(html = "") {
  const protectedBlocks = [];
  const tokenized = String(html).replace(/<(h[1-6])\b[\s\S]*?<\/\1>|<(p|div|section)\b(?=[^>]*(?:class|id)=["'][^"']*(?:chapter|title|subtitle|heading|ps1|ps2|bordered-title|titled-section)[^"']*["'])[\s\S]*?<\/\2>/gi, block => {
    const token = `%%GOLD_HEADING_${protectedBlocks.length}%%`;
    protectedBlocks.push(block);
    return token;
  });

  const stripped = tokenized
    .replace(/<\/?(?:strong|b)\b[^>]*>/gi, "")
    .replace(/%%GOLD_HEADING_(\d+)%%/g, (_match, index) => protectedBlocks[Number(index)] || "");

  return stripped;
}

function normalizeAnthropicModel(model = "") {
  const requested = String(model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6").trim();
  const aliases = new Map([
    ["claude-sonnet-4-20250514", "claude-sonnet-4-6"],
    ["claude-4-sonnet", "claude-sonnet-4-6"],
    ["claude-sonnet", "claude-sonnet-4-6"],
  ]);
  return aliases.get(requested) || requested;
}

function wordCountFor(book) {
  if (Number(book.wordCount) > 0) return Number(book.wordCount);
  return (book.sections || []).reduce((sum, section) => {
    if (Number(section.wordCount) > 0) return sum + Number(section.wordCount);
    return sum + String(section.text || plainText(section.html)).split(/\s+/).filter(Boolean).length;
  }, 0);
}

function normalizeAuditEntry(entry) {
  const rawId = String(entry.id || entry.bookId || entry.slug || entry.file || entry.filename || "");
  const id = path.basename(rawId).replace(/\.json$/i, "");
  return {
    id,
    title: entry.title || entry.name || id,
    emDash: Number(entry.emDash ?? entry.emDashes ?? entry.emDashCount ?? entry.counts?.emDash ?? 0),
    score: Number(entry.score ?? entry.residueScore ?? entry.aiResidueScore ?? entry.totalScore ?? 0),
    wordCount: Number(entry.wordCount ?? entry.words ?? 0),
  };
}

async function loadAudit() {
  const candidates = [
    process.env.GOLD_AUDIT_FILE,
    path.join(rootDir, "jju-gold-audit.json"),
    path.join(rootDir, "gold-audit.json"),
    path.join(rootDir, "public", "jju-gold-audit.json"),
    path.join(rootDir, "public", "gold-audit.json"),
    path.join(toolDir, "jju-gold-audit.json"),
    path.join(toolDir, "gold-audit.json"),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Downloads", "jju-gold-audit.json") : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    const data = await readJson(candidate);
    const rows = Array.isArray(data) ? data : data.books || data.results || data.items || [];
    return {
      source: path.relative(rootDir, candidate),
      rows: rows.map(normalizeAuditEntry).filter(row => row.id),
    };
  }
  return { source: "computed from private/book-content", rows: [] };
}

async function listBooks() {
  const files = (await readdir(bookDir)).filter(file => file.endsWith(".json"));
  const audit = await loadAudit();
  const auditMap = new Map(audit.rows.map(row => [row.id.toLowerCase(), row]));
  const books = [];

  for (const file of files) {
    const book = await readJson(path.join(bookDir, file));
    const id = String(book.id || file.replace(/\.json$/i, ""));
    const text = (book.sections || []).map(section => section.text || plainText(section.html)).join("\n\n");
    const computed = residueFor(text);
    const auditRow = auditMap.get(id.toLowerCase()) || auditMap.get(file.replace(/\.json$/i, "").toLowerCase());
    const emDash = Number.isFinite(auditRow?.emDash) ? auditRow.emDash : computed.emDash;
    const score = Number.isFinite(auditRow?.score) ? auditRow.score : computed.score;
    const wordCount = auditRow?.wordCount || wordCountFor(book);

    books.push({
      id,
      file,
      title: book.title || auditRow?.title || id,
      creator: book.creator || "",
      wordCount,
      sectionCount: (book.sections || []).length,
      emDash,
      score,
      status: emDash <= 10 ? "Gold sample" : emDash <= 50 ? "Light pass" : emDash <= 200 ? "Medium pass" : "Heavy pass",
    });
  }

  books.sort((a, b) => b.emDash - a.emDash || b.score - a.score || a.wordCount - b.wordCount || a.title.localeCompare(b.title));
  return { auditSource: audit.source, books };
}

async function findBookFile(id) {
  const files = (await readdir(bookDir)).filter(file => file.endsWith(".json"));
  const file = files.find(item => item.replace(/\.json$/i, "").toLowerCase() === id.toLowerCase())
    || files.find(item => item.toLowerCase() === `${id.toLowerCase()}.json`);
  if (!file) throw new Error(`Book not found: ${id}`);
  const fullPath = path.join(bookDir, file);
  return { file, fullPath };
}

async function loadBook(id) {
  const found = await findBookFile(id);
  return readJson(found.fullPath);
}

async function callAnthropic({ model, prompt, maxTokens }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY before using Anthropic cleanup.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: normalizeAnthropicModel(model),
      max_tokens: maxTokens || 6000,
      system: AI_RULES,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message || "Anthropic request failed.");
  return (json.content || []).filter(item => item.type === "text").map(item => item.text).join("\n").trim();
}

async function callOpenAI({ model, prompt, maxTokens }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY before using OpenAI cleanup.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model || process.env.OPENAI_MODEL || "gpt-5.1",
      instructions: AI_RULES,
      input: prompt,
      max_output_tokens: maxTokens || 6000,
      store: false,
    }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message || "OpenAI request failed.");
  if (json.output_text) return String(json.output_text).trim();
  return (json.output || [])
    .flatMap(item => item.content || [])
    .map(item => item.text || "")
    .join("\n")
    .trim();
}

async function cleanOneChunk({ provider, model, text, chunkIndex = 0, chunkCount = 1 }) {
  const styleGuide = await readFile(styleGuidePath, "utf8").catch(() => "");
  const prompt = `${AI_RULES}

Gold style guide:
${styleGuide}

Chunk: ${chunkIndex + 1} of ${chunkCount}

Original section HTML:
${text}`;
  if (provider === "openai") return callOpenAI({ model, prompt });
  return callAnthropic({ model, prompt });
}

async function cleanWithAi({ provider, model, text }) {
  const chunks = splitIntoWordChunks(text, 3200);
  const cleaned = [];
  for (let i = 0; i < chunks.length; i += 1) {
    cleaned.push(await cleanOneChunk({
      provider,
      model,
      text: chunks[i],
      chunkIndex: i,
      chunkCount: chunks.length,
    }));
  }
  const cleanedHtml = stripNonTitleBold(cleaned.join("\n\n").trim());
  return {
    cleanedHtml,
    cleanedText: textFromHtml(cleanedHtml),
    chunks: chunks.length,
  };
}

async function saveDraft({ bookId, sectionIndex, cleanedText, cleanedHtml }) {
  await mkdir(outputDir, { recursive: true });
  const book = await loadBook(bookId);
  const section = book.sections?.[Number(sectionIndex)];
  if (!section) throw new Error("Section not found.");
  const out = {
    bookId,
    title: book.title || bookId,
    sectionIndex: Number(sectionIndex),
    sectionId: section.id,
    sectionTitle: section.title,
    cleanedHtml: cleanedHtml || "",
    cleanedText: cleanedText || textFromHtml(cleanedHtml || ""),
    savedAt: new Date().toISOString(),
  };
  const outFile = path.join(outputDir, `${bookId}__section-${String(sectionIndex).padStart(3, "0")}.json`);
  await writeFile(outFile, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  return path.relative(rootDir, outFile);
}

async function readSavedDrafts(bookId) {
  await mkdir(outputDir, { recursive: true });
  const files = await readdir(outputDir).catch(() => []);
  const prefix = `${bookId}__section-`;
  const drafts = [];

  for (const file of files) {
    if (!file.startsWith(prefix) || !/__section-\d+\.json$/i.test(file)) continue;
    const draft = await readJson(path.join(outputDir, file)).catch(() => null);
    if (!draft) continue;
    drafts.push(draft);
  }

  return drafts;
}

async function buildFixedBook({ bookId, drafts }) {
  const book = await loadBook(bookId);
  const next = structuredClone(book);
  const merged = new Map();

  for (const draft of await readSavedDrafts(bookId)) {
    merged.set(Number(draft.sectionIndex), draft);
  }

  for (const draft of drafts || []) {
    merged.set(Number(draft.sectionIndex), draft);
  }

  if (!merged.size) throw new Error("No cleaned drafts found for this book. Clean and save at least one section first.");

  let updatedSections = 0;
  for (const draft of merged.values()) {
    const index = Number(draft.sectionIndex);
    if (!next.sections?.[index]) continue;
    const goldHtml = stripNonTitleBold(draft.cleanedHtml || draft.cleanedText || "");
    const goldText = draft.cleanedText || textFromHtml(goldHtml);
    const original = next.sections[index];
    next.sections[index] = {
      ...original,
      originalHtml: original.originalHtml || original.html || "",
      originalText: original.originalText || original.text || "",
      html: goldHtml,
      text: goldText,
      goldHtml,
      goldText,
      goldCleanedAt: new Date().toISOString(),
    };
    updatedSections += 1;
  }

  return { book, next, updatedSections };
}

async function exportBook({ bookId, drafts }) {
  await mkdir(outputDir, { recursive: true });
  const { next, updatedSections } = await buildFixedBook({ bookId, drafts });
  const outFile = path.join(outputDir, `${bookId}.gold.json`);
  await writeFile(outFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { file: path.relative(rootDir, outFile), updatedSections };
}

async function applyBook({ bookId, drafts }) {
  await mkdir(outputDir, { recursive: true });
  const backupsDir = path.join(outputDir, "backups");
  await mkdir(backupsDir, { recursive: true });
  const found = await findBookFile(bookId);
  const original = await readFile(found.fullPath, "utf8");
  const { next, updatedSections } = await buildFixedBook({ bookId, drafts });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupsDir, `${bookId}-${stamp}.json`);

  await writeFile(backupFile, original, "utf8");
  await writeFile(found.fullPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  return {
    file: path.relative(rootDir, found.fullPath),
    backup: path.relative(rootDir, backupFile),
    updatedSections,
  };
}

async function listDrafts() {
  await mkdir(outputDir, { recursive: true });
  const files = await readdir(outputDir).catch(() => []);
  const drafts = files
    .filter(file => /__section-\d+\.json$/i.test(file))
    .map(file => {
      const match = file.match(/^(.*?)__section-(\d+)\.json$/i);
      return {
        file,
        bookId: match?.[1] || "",
        sectionIndex: Number(match?.[2] || 0),
      };
    });
  const exports = files
    .filter(file => /\.gold\.json$/i.test(file))
    .map(file => ({ file, bookId: file.replace(/\.gold\.json$/i, "") }));
  return { drafts, exports };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/books") return send(res, 200, await listBooks());
  if (url.pathname === "/api/config") {
    return send(res, 200, {
      hasAnthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
      defaultProvider: process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : "anthropic",
      anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      openaiModel: process.env.OPENAI_MODEL || "gpt-5.1",
      outputDir: path.relative(rootDir, outputDir),
    });
  }
  if (url.pathname === "/api/style-guide") {
    const text = await readFile(styleGuidePath, "utf8");
    return send(res, 200, { text });
  }
  if (url.pathname === "/api/drafts") return send(res, 200, await listDrafts());
  if (url.pathname.startsWith("/api/book/")) {
    const book = await loadBook(decodeURIComponent(url.pathname.replace("/api/book/", "")));
    return send(res, 200, book);
  }

  if (req.method !== "POST") return send(res, 404, { error: "Not found" });
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

  if (url.pathname === "/api/clean") {
    return send(res, 200, await cleanWithAi(body));
  }
  if (url.pathname === "/api/score") return send(res, 200, residueFor(body.text || ""));
  if (url.pathname === "/api/save-draft") return send(res, 200, { file: await saveDraft(body) });
  if (url.pathname === "/api/export-book") return send(res, 200, await exportBook(body));
  if (url.pathname === "/api/apply-book") return send(res, 200, await applyBook(body));
  if (url.pathname === "/api/write-style-guide") {
    await writeFile(styleGuidePath, String(body.text || ""), "utf8");
    return send(res, 200, { saved: true });
  }
  if (url.pathname === "/api/save-api-key") {
    const provider = String(body.provider || "").toLowerCase();
    const token = String(body.token || "").trim();
    const model = String(body.model || "").trim();
    if (!["anthropic", "openai"].includes(provider)) throw new Error("Choose Anthropic or OpenAI before saving a token.");
    if (!token) throw new Error("Paste an API token before saving.");

    const normalizedModel = provider === "anthropic" && model ? normalizeAnthropicModel(model) : model;
    const updates = provider === "openai"
      ? { OPENAI_API_KEY: token, ...(normalizedModel ? { OPENAI_MODEL: normalizedModel } : {}) }
      : { ANTHROPIC_API_KEY: token, ...(normalizedModel ? { ANTHROPIC_MODEL: normalizedModel } : {}) };

    await writeEnvValue(envLocalPath, updates);
    return send(res, 200, {
      saved: true,
      provider,
      hasAnthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
    });
  }

  return send(res, 404, { error: "Not found" });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const fullPath = path.resolve(toolDir, file);
    if (!fullPath.startsWith(toolDir)) return send(res, 403, "Forbidden", "text/plain");
    const ext = path.extname(fullPath);
    const type = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "text/html";
    return send(res, 200, await readFile(fullPath, "utf8"), type);
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : "Gold Cleaner failed." });
  }
});

await loadEnvFile(envLocalPath);
await mkdir(outputDir, { recursive: true });
server.listen(port, () => {
  console.log(`JJU Gold Cleaner running at http://localhost:${port}`);
});
