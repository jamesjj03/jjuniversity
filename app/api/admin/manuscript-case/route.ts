import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  caseReviewKey,
  getCaseReviewAvailability,
  proposeCaseReplacement,
  readCaseReviewDecisions,
  readCaseReviewRows,
  removeCaseReviewDecision,
  writeCaseReviewDecision,
  type CaseReviewAvailability,
  type CaseReviewDecision,
} from "@/lib/manuscriptCaseReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

function protectedResponse(message: string, status: number, authenticate = false) {
  return NextResponse.json({ error: message }, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      ...(authenticate ? { "WWW-Authenticate": 'Basic realm="JJ University Admin", charset="UTF-8"' } : {}),
    },
  });
}

function equalSecret(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function assertAdminRequest(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return process.env.NODE_ENV === "development"
      ? null
      : protectedResponse("Not found.", 404);
  }

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Basic ")) {
    return protectedResponse("Admin access required.", 401, true);
  }

  const decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  const username = separator >= 0 ? decoded.slice(0, separator) : "";
  const provided = separator >= 0 ? decoded.slice(separator + 1) : decoded;
  const requiredUser = process.env.ADMIN_USERNAME;

  if ((requiredUser && !equalSecret(username, requiredUser)) || !equalSecret(provided, password)) {
    return protectedResponse("Admin access required.", 401, true);
  }
  return null;
}

function routeFailure(error: unknown) {
  console.error("Manuscript case review failed", error);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const missingAudit = code === "ENOENT";
  return NextResponse.json({
    error: missingAudit
      ? "Review data is unavailable. Run the manuscript quality audit first."
      : "The manuscript review tool could not read or save its local data.",
  }, {
    status: missingAudit ? 503 : 500,
    headers: NO_STORE_HEADERS,
  });
}

function unavailableResponse(availability: CaseReviewAvailability) {
  return NextResponse.json({
    available: false,
    error: availability.message,
    availability,
  }, {
    status: 409,
    headers: NO_STORE_HEADERS,
  });
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const number = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export async function GET(request: NextRequest) {
  const accessError = assertAdminRequest(request);
  if (accessError) return accessError;

  const availability = await getCaseReviewAvailability();
  if (!availability.available) return unavailableResponse(availability);

  try {
    return await getReviewQueue(request);
  } catch (error) {
    return routeFailure(error);
  }
}

async function getReviewQueue(request: NextRequest) {
  const decisionFile = await readCaseReviewDecisions();
  const search = request.nextUrl.searchParams;

  if (search.get("download") === "1") {
    return new NextResponse(`${JSON.stringify(decisionFile, null, 2)}\n`, {
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Disposition": 'attachment; filename="jju-manuscript-case-decisions.json"',
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  const rows = await readCaseReviewRows();

  const status = search.get("status") || "unreviewed";
  if (!new Set(["unreviewed", "accepted", "skipped", "all"]).has(status)) {
    return NextResponse.json({ error: "Unknown review status." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const book = (search.get("book") || "").trim().toLocaleLowerCase("en-US");
  const query = (search.get("q") || "").trim().toLocaleLowerCase("en-US");
  const risk = (search.get("risk") || "").trim().toLocaleLowerCase("en-US");
  if (query.length > 200) {
    return NextResponse.json({ error: "Search is limited to 200 characters." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (risk && !new Set(["high", "medium", "low"]).has(risk)) {
    return NextResponse.json({ error: "Unknown risk level." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const requestedOffset = boundedInteger(search.get("offset"), 0, 0, Math.max(0, rows.length));
  const limit = boundedInteger(search.get("limit"), 25, 1, 100);

  const filtered = rows.filter(row => {
    const decision = decisionFile.decisions[caseReviewKey(row.bookId, row.sectionId)];
    if (status === "unreviewed" && decision) return false;
    if (status === "accepted" && decision?.status !== "accepted") return false;
    if (status === "skipped" && decision?.status !== "skipped") return false;
    if (book && row.bookId.toLocaleLowerCase("en-US") !== book) return false;
    if (risk && row.riskLevel.toLocaleLowerCase("en-US") !== risk) return false;
    if (
      query &&
      ![row.bookTitle, row.sectionTitle, row.prefixText, row.firstParagraphText]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(query)
    ) return false;
    return true;
  });

  const offset = filtered.length === 0
    ? 0
    : Math.min(requestedOffset, Math.floor((filtered.length - 1) / limit) * limit);
  const rowKeys = new Set(rows.map(row => caseReviewKey(row.bookId, row.sectionId)));
  const decisions = Object.entries(decisionFile.decisions)
    .filter(([key]) => rowKeys.has(key))
    .map(([, decision]) => decision);
  const accepted = decisions.filter(decision => decision.status === "accepted").length;
  const skipped = decisions.filter(decision => decision.status === "skipped").length;
  const bookOptions = [...new Map(rows.map(row => [row.bookId, row.bookTitle])).entries()]
    .map(([id, title]) => ({ id, title }))
    .sort((left, right) => left.title.localeCompare(right.title));

  return NextResponse.json({
    rows: filtered.slice(offset, offset + limit).map(row => ({
      ...row,
      decision: decisionFile.decisions[caseReviewKey(row.bookId, row.sectionId)] || null,
      proposal: proposeCaseReplacement(row),
    })),
    offset,
    limit,
    filteredTotal: filtered.length,
    total: rows.length,
    stats: {
      accepted,
      skipped,
      unreviewed: Math.max(0, rows.length - accepted - skipped),
    },
    bookOptions,
  }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest) {
  const accessError = assertAdminRequest(request);
  if (accessError) return accessError;

  const availability = await getCaseReviewAvailability();
  if (!availability.available) return unavailableResponse(availability);

  try {
    return await saveReviewDecision(request);
  } catch (error) {
    return routeFailure(error);
  }
}

async function saveReviewDecision(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLocaleLowerCase("en-US").startsWith("application/json")) {
    return NextResponse.json({ error: "Expected a JSON request." }, { status: 415, headers: NO_STORE_HEADERS });
  }

  let body: Partial<CaseReviewDecision> & { action?: string };
  try {
    body = await request.json() as Partial<CaseReviewDecision> & { action?: string };
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const bookId = String(body.bookId || "").trim();
  const sectionId = String(body.sectionId || "").trim();
  if (!bookId || !sectionId) {
    return NextResponse.json({ error: "Book and section are required." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const rows = await readCaseReviewRows();
  const row = rows.find(candidate => candidate.bookId === bookId && candidate.sectionId === sectionId);
  if (!row) return NextResponse.json({ error: "Review row not found." }, { status: 404, headers: NO_STORE_HEADERS });

  if (body.action === "reset") {
    const decisions = await removeCaseReviewDecision(bookId, sectionId);
    return NextResponse.json({ ok: true, decisions: Object.keys(decisions.decisions).length }, { headers: NO_STORE_HEADERS });
  }

  const status = body.status === "skipped" ? "skipped" : body.status === "accepted" ? "accepted" : null;
  if (!status) return NextResponse.json({ error: "Status must be accepted or skipped." }, { status: 400, headers: NO_STORE_HEADERS });
  const replacement = String(body.replacement || "").trim();
  if (status === "accepted" && !replacement) {
    return NextResponse.json({ error: "Accepted rows need a replacement." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (status === "accepted" && replacement === row.prefixText && !row.safeCssOnly) {
    return NextResponse.json({ error: "The replacement still matches the all-caps source." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (
    status === "accepted" &&
    replacement.toLocaleLowerCase("en-US") !== row.prefixText.toLocaleLowerCase("en-US")
  ) {
    return NextResponse.json({ error: "Only capitalization can change in this review tool." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const updatedAt = new Date().toISOString();
  await writeCaseReviewDecision({
    bookId,
    sectionId,
    original: row.prefixText,
    replacement: status === "accepted" ? replacement : "",
    status,
    updatedAt,
  });
  return NextResponse.json({ ok: true, updatedAt }, { headers: NO_STORE_HEADERS });
}
