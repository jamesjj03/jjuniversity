export type ReviewBlock = {
  blockId: number;
  kind: "factual" | "interpretive" | "opinion" | "metaphor" | "narrative" | "style" | "other";
  risk: "low" | "medium" | "high";
  needsSource: boolean;
  text: string;
  chapterPath?: string;
  bookName?: string;
};

export type ReviewNote = {
  id?: string;
  bookName?: string;
  chapterPath?: string;
  type: "error" | "source" | "review";
  status: "open" | "resolved" | "ignored";
  line: string;
  issue: string;
  fix?: string;
  source?: string;
  sourceTitle?: string;
  sourceRelationship?: "supports" | "contradicts" | "context" | "";
  confidence?: "low" | "medium" | "high" | "";
  claim?: string;
  category?: string;
  risk?: "low" | "medium" | "high";
  needsSource?: boolean;
};

export function htmlToText(html: string) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractReviewBlocks(html: string) {
  const source = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const matches = [...source.matchAll(/<(p|h[1-6]|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  const rawBlocks = matches.length ? matches.map(match => match[2]) : source.split(/\n{2,}/);

  return rawBlocks
    .map(block => htmlToText(block))
    .filter(block => block.length > 20)
    .map((block, index) => ({
      blockId: index,
      text: block.slice(0, 2200),
    }));
}

export function normalizeReviewNote(item: Partial<ReviewNote> & Record<string, unknown>, importName = ""): ReviewNote {
  const source = item.source && typeof item.source === "object" ? item.source as Record<string, unknown> : null;
  return {
    id: String(item.id || crypto.randomUUID()),
    bookName: String(item.bookName || item.book || item.fileName || importName.replace(/\.json$/i, "") || ""),
    chapterPath: String(item.chapterPath || item.file || item.path || item.chapter || ""),
    type: normalizeType(item.type || item.category || item.kind),
    status: normalizeStatus(item.status),
    line: String(item.line || item.highlightedLine || item.highlight || item.quote || item.claim || ""),
    issue: String(item.issue || item.explanation || item.reason || item.problem || item.why || ""),
    fix: String(item.fix || item.recommendation || item.suggestedFix || item.lineFix || item.replacement || ""),
    source: String(source?.url || item.sourceUrl || item.citation || item.url || (typeof item.source === "string" ? item.source : "") || ""),
    sourceTitle: String(source?.title || item.sourceTitle || ""),
    sourceRelationship: normalizeRelationship(source?.relationship || item.sourceRelationship),
    confidence: normalizeConfidence(item.confidence),
    claim: item.claim ? String(item.claim) : undefined,
    category: item.category ? String(item.category) : undefined,
    risk: normalizeRisk(item.risk),
    needsSource: Boolean(item.needsSource),
  };
}

function normalizeType(type: unknown): ReviewNote["type"] {
  const clean = String(type || "").toLowerCase();
  if (clean.includes("source") || clean.includes("citation")) return "source";
  if (clean.includes("review") || clean.includes("check")) return "review";
  return "error";
}

function normalizeStatus(status: unknown): ReviewNote["status"] {
  const clean = String(status || "").toLowerCase();
  if (clean === "resolved" || clean === "ignored") return clean;
  return "open";
}

function normalizeConfidence(confidence: unknown): ReviewNote["confidence"] {
  const clean = String(confidence || "").toLowerCase();
  if (clean === "low" || clean === "medium" || clean === "high") return clean;
  return "";
}

function normalizeRisk(risk: unknown): ReviewNote["risk"] | undefined {
  const clean = String(risk || "").toLowerCase();
  if (clean === "low" || clean === "medium" || clean === "high") return clean;
  return undefined;
}

function normalizeRelationship(value: unknown): ReviewNote["sourceRelationship"] {
  const clean = String(value || "").toLowerCase();
  if (clean === "supports" || clean === "contradicts" || clean === "context") return clean;
  return "";
}
