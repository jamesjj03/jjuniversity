import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getTaxonomyReviewCatalog } from "@/lib/taxonomyReviewCatalog";
import {
  readTaxonomyReviewDraft,
  saveTaxonomyReviewDraft,
  TaxonomyReviewConflictError,
  TaxonomyReviewValidationError,
} from "@/lib/taxonomyReviewStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET(request: NextRequest) {
  const accessError = assertAdminRequest(request);
  if (accessError) return accessError;

  const catalog = getTaxonomyReviewCatalog();
  const validBookIds = new Set(catalog.books.map(book => book.id));
  const state = await readTaxonomyReviewDraft(catalog.draft, validBookIds);
  return NextResponse.json(state, { headers: NO_STORE_HEADERS });
}

export async function PUT(request: NextRequest) {
  const accessError = assertAdminRequest(request);
  if (accessError) return accessError;
  if (process.env.VERCEL === "1") {
    return failure("File backups are available in the local JJ University workspace. This browser is still autosaving; export JSON when the review is finished.", 409);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 2_000_000) return failure("The draft is too large.", 413);

  try {
    const catalog = getTaxonomyReviewCatalog();
    const validBookIds = new Set(catalog.books.map(book => book.id));
    const result = await saveTaxonomyReviewDraft(await request.json(), catalog.draft.catalogFingerprint, validBookIds);
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof TaxonomyReviewConflictError) return failure(error.message, 409);
    if (error instanceof TaxonomyReviewValidationError || error instanceof SyntaxError) {
      return failure(error instanceof Error ? error.message : "The draft is invalid.", 400);
    }
    console.error("Taxonomy review save failed", error);
    return failure("The local draft could not be saved.", 500);
  }
}

function assertAdminRequest(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return process.env.NODE_ENV === "development" ? null : failure("Not found.", 404);

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Basic ")) return unauthorized();

  const decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  const username = separator >= 0 ? decoded.slice(0, separator) : "";
  const provided = separator >= 0 ? decoded.slice(separator + 1) : decoded;
  const requiredUser = process.env.ADMIN_USERNAME;
  if ((requiredUser && !equalSecret(username, requiredUser)) || !equalSecret(provided, password)) return unauthorized();
  return null;
}

function equalSecret(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function unauthorized() {
  return NextResponse.json({ error: "Admin access required." }, {
    status: 401,
    headers: { ...NO_STORE_HEADERS, "WWW-Authenticate": 'Basic realm="JJ University Admin", charset="UTF-8"' },
  });
}

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}
