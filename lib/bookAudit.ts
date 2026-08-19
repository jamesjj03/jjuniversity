import { readFile } from "fs/promises";
import path from "path";
import { canonicalBookId } from "@/lib/bookAliases";

export type BookAuditSource = {
  url: string;
  title: string;
  publisher?: string;
  accessedAt?: string;
};

export type BookAuditReceipt = {
  claimId: string;
  sectionId: string;
  sectionTitle: string;
  verdict: "supported" | "contradicted" | "outdated" | "contested";
  sources: BookAuditSource[];
};

export type BookAuditSummary = {
  status: "not_started" | "in_progress" | "verified";
  generatedAt?: string;
  campaignId?: string;
  verifiedClaimCount: number;
  receipts: BookAuditReceipt[];
};

type Ledger = {
  generatedAt?: string;
  campaignId?: string;
  books?: Record<string, Array<{
    claimId?: string;
    sectionId?: string;
    sectionTitle?: string;
    verdict?: string;
    sources?: Array<{ url?: string; title?: string; publisher?: string; accessedAt?: string }>;
  }>>;
};

const LEDGER_PATH = path.join(process.cwd(), "public", "book-audit", "verified-sources.json");

function validUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export async function readBookAudit(bookId: string): Promise<BookAuditSummary> {
  try {
    const ledger = JSON.parse(await readFile(LEDGER_PATH, "utf8")) as Ledger;
    const canonicalId = canonicalBookId(bookId);
    const rows = Object.entries(ledger.books || {})
      .filter(([id]) => canonicalBookId(id) === canonicalId)
      .flatMap(([, receipts]) => receipts || []);
    const receipts: BookAuditReceipt[] = rows
      .filter(row => ["supported", "contradicted", "outdated", "contested"].includes(String(row.verdict)))
      .map(row => ({
        claimId: String(row.claimId || ""),
        sectionId: String(row.sectionId || ""),
        sectionTitle: String(row.sectionTitle || "Section"),
        verdict: row.verdict as BookAuditReceipt["verdict"],
        sources: (row.sources || [])
          .filter(source => validUrl(String(source.url || "")))
          .map(source => ({
            url: String(source.url),
            title: String(source.title || source.url),
            publisher: source.publisher ? String(source.publisher) : undefined,
            accessedAt: source.accessedAt ? String(source.accessedAt) : undefined,
          })),
      }))
      .filter(row => row.claimId && row.sectionId && row.sources.length);
    return {
      status: receipts.length ? "verified" : ledger.campaignId ? "in_progress" : "not_started",
      generatedAt: ledger.generatedAt,
      campaignId: ledger.campaignId,
      verifiedClaimCount: receipts.length,
      receipts,
    };
  } catch {
    return { status: "not_started", verifiedClaimCount: 0, receipts: [] };
  }
}
