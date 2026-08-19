import "server-only";

import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

const AUDIT_PATH = path.join(
  process.cwd(),
  "tmp",
  "manuscript-quality-audit",
  "20260818T212052Z",
  "report.json",
);
const REVIEW_DIR = path.join(process.cwd(), "tmp", "manuscript-case-review");
const DECISIONS_PATH = path.join(REVIEW_DIR, "decisions.json");
const PREVIOUS_DECISIONS_PATH = path.join(REVIEW_DIR, "decisions.previous.json");

export type CaseReference = {
  token: string;
  position: number;
  variants: Array<{ value: string; count: number }>;
};

export type CaseReviewRow = {
  acronymTokens: string[];
  bookId: string;
  bookTitle: string;
  firstParagraphText: string;
  index: number;
  kind: string;
  mechanism: string;
  prefixText: string;
  prefixWordCount: number;
  properNounTokens: string[];
  referenceSuggestions: CaseReference[];
  riskFlags: string[];
  riskLevel: string;
  safeCssOnly: boolean;
  sectionId: string;
  sectionTitle: string;
  sourceCasing: string;
  unresolvedTokens: string[];
};

export type CaseReviewDecision = {
  bookId: string;
  sectionId: string;
  original: string;
  replacement: string;
  status: "accepted" | "skipped";
  updatedAt: string;
};

type CaseAuditReport = {
  initialCaps?: {
    sections?: CaseReviewRow[];
  };
};

type DecisionFile = {
  schemaVersion: 1;
  updatedAt: string;
  decisions: Record<string, CaseReviewDecision>;
};

export type CaseReviewAvailability = {
  available: boolean;
  reason: "available" | "deployed" | "local-mode-disabled" | "audit-missing" | "audit-unreadable";
  message: string;
};

let cachedAudit: { mtimeMs: number; rows: CaseReviewRow[] } | null = null;
let decisionWriteQueue: Promise<void> = Promise.resolve();

export function caseReviewKey(bookId: string, sectionId: string) {
  return `${bookId}::${sectionId}`;
}

export async function getCaseReviewAvailability(): Promise<CaseReviewAvailability> {
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) {
    return {
      available: false,
      reason: "deployed",
      message: "Opening Case Review is a local-workspace tool and is intentionally unavailable on the deployed site.",
    };
  }

  if (process.env.NODE_ENV !== "development" && process.env.JJU_LOCAL_EDITORIAL !== "1") {
    return {
      available: false,
      reason: "local-mode-disabled",
      message: "Opening Case Review is disabled outside the local development workspace.",
    };
  }

  try {
    const stat = await fs.stat(AUDIT_PATH);
    if (!stat.isFile()) {
      return {
        available: false,
        reason: "audit-missing",
        message: "The local manuscript quality audit is not available. Run the audit before opening this review desk.",
      };
    }
    await fs.access(AUDIT_PATH, fsConstants.R_OK);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return {
      available: false,
      reason: code === "ENOENT" ? "audit-missing" : "audit-unreadable",
      message: code === "ENOENT"
        ? "The local manuscript quality audit is not available. Run the audit before opening this review desk."
        : "The local manuscript quality audit cannot be read. Check the audit output before opening this review desk.",
    };
  }

  return {
    available: true,
    reason: "available",
    message: "The local audit and decision workspace are available.",
  };
}

export function proposeCaseReplacement(row: CaseReviewRow) {
  if (row.safeCssOnly) return row.prefixText;

  let proposal = row.prefixText.toLocaleLowerCase("en-US");
  proposal = proposal.replace(/[A-Za-z]/, character => character.toLocaleUpperCase("en-US"));

  for (const acronym of row.acronymTokens) {
    const escaped = acronym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    proposal = proposal.replace(new RegExp(`\\b${escaped}\\b`, "gi"), acronym.toLocaleUpperCase("en-US"));
  }

  return proposal;
}

export async function readCaseReviewRows() {
  const stat = await fs.stat(AUDIT_PATH);
  if (cachedAudit?.mtimeMs === stat.mtimeMs) return cachedAudit.rows;

  const report = JSON.parse(await fs.readFile(AUDIT_PATH, "utf8")) as CaseAuditReport;
  const rows = Array.isArray(report.initialCaps?.sections) ? report.initialCaps.sections : [];
  cachedAudit = { mtimeMs: stat.mtimeMs, rows };
  return rows;
}

export async function readCaseReviewDecisions(): Promise<DecisionFile> {
  try {
    return parseDecisionFile(await fs.readFile(DECISIONS_PATH, "utf8"));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT") throw error;
    return { schemaVersion: 1, updatedAt: "", decisions: {} };
  }
}

export async function writeCaseReviewDecision(decision: CaseReviewDecision) {
  return serializeDecisionWrite(async () => {
    const current = await readCaseReviewDecisions();
    const next: DecisionFile = {
      schemaVersion: 1,
      updatedAt: decision.updatedAt,
      decisions: {
        ...current.decisions,
        [caseReviewKey(decision.bookId, decision.sectionId)]: decision,
      },
    };

    await persistDecisionFile(next);
    return next;
  });
}

export async function removeCaseReviewDecision(bookId: string, sectionId: string) {
  return serializeDecisionWrite(async () => {
    const current = await readCaseReviewDecisions();
    const key = caseReviewKey(bookId, sectionId);
    if (!(key in current.decisions)) return current;

    const decisions = { ...current.decisions };
    delete decisions[key];
    const next: DecisionFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      decisions,
    };

    await persistDecisionFile(next);
    return next;
  });
}

function parseDecisionFile(raw: string): DecisionFile {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.updatedAt !== "string") {
    throw new Error("The manuscript case decision file has an unsupported format.");
  }
  if (!isRecord(parsed.decisions)) {
    throw new Error("The manuscript case decision file does not contain a decision map.");
  }

  const decisions: Record<string, CaseReviewDecision> = {};
  for (const [key, value] of Object.entries(parsed.decisions)) {
    if (
      !isRecord(value) ||
      typeof value.bookId !== "string" ||
      typeof value.sectionId !== "string" ||
      typeof value.original !== "string" ||
      typeof value.replacement !== "string" ||
      (value.status !== "accepted" && value.status !== "skipped") ||
      typeof value.updatedAt !== "string" ||
      key !== caseReviewKey(value.bookId, value.sectionId)
    ) {
      throw new Error(`The manuscript case decision ${key} is malformed.`);
    }
    decisions[key] = value as CaseReviewDecision;
  }

  return {
    schemaVersion: 1,
    updatedAt: parsed.updatedAt,
    decisions,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function serializeDecisionWrite<T>(operation: () => Promise<T>) {
  const result = decisionWriteQueue.then(operation, operation);
  decisionWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function persistDecisionFile(next: DecisionFile) {
  const availability = await getCaseReviewAvailability();
  if (!availability.available) {
    throw new Error(availability.message);
  }

  await fs.mkdir(REVIEW_DIR, { recursive: true });
  const temporaryPath = path.join(REVIEW_DIR, `decisions.${process.pid}.${randomUUID()}.tmp`);
  await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  try {
    try {
      await fs.copyFile(DECISIONS_PATH, PREVIOUS_DECISIONS_PATH);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT") throw error;
    }
    await fs.rename(temporaryPath, DECISIONS_PATH);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
