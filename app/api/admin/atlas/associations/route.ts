import { NextRequest } from "next/server";
import {
  adminApiFailure,
  assertAdminApiRequest,
  protectedAdminVersionedJson,
} from "@/lib/adminApiSecurity";
import {
  AdminVersionConflictError,
  AtlasEditorialPersistenceError,
  readAtlasAssociationReviewSnapshot,
  saveAtlasAssociationDecision,
} from "@/lib/atlasEditorialStore";
import { expectedAdminVersion } from "@/lib/adminVersionedJson";
import { AtlasEditorialValidationError, type AtlasAssociationDecision } from "@/lib/atlas-world/editorialReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 20_000;

export async function GET(request: NextRequest) {
  const accessError = assertAdminApiRequest(request);
  if (accessError) return accessError;
  try {
    const snapshot = await readAtlasAssociationReviewSnapshot();
    const { version, ...body } = snapshot;
    return protectedAdminVersionedJson(body, version);
  } catch (error) {
    console.error("Atlas association review read failed", error);
    return adminApiFailure("The Atlas association authority could not be loaded safely.", 500);
  }
}
export async function PUT(request: NextRequest) {
  const accessError = assertAdminApiRequest(request);
  if (accessError) return accessError;
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) return adminApiFailure("The association decision is too large.", 413);
  try {
    const expectedVersion = expectedAdminVersion(request);
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) return adminApiFailure("The association decision is too large.", 413);
    const decision = JSON.parse(rawBody || "{}") as AtlasAssociationDecision;
    const saved = await saveAtlasAssociationDecision(decision, expectedVersion);
    const { version, ...snapshot } = saved.snapshot;
    return protectedAdminVersionedJson({ saved: true, target: saved.target, note: saved.note, snapshot }, version);
  } catch (error) {
    if (error instanceof AdminVersionConflictError) return adminApiFailure(error.message, 409);
    if (error instanceof AtlasEditorialValidationError || error instanceof SyntaxError) {
      return adminApiFailure(error instanceof Error ? error.message : "The association decision is invalid.", 400);
    }
    if (error instanceof AtlasEditorialPersistenceError) return adminApiFailure(error.message, 503);
    console.error("Atlas association review save failed", error);
    return adminApiFailure("The association decision could not be saved. The previous authority remains unchanged.", 500);
  }
}
