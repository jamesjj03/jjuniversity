import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  AdminVersionConflictError,
  expectedAdminVersion,
  versionedJson,
} from "@/lib/adminVersionedJson";
import { decodeBasicCredentials } from "@/lib/basicAuth";
import {
  readTopicAuthoritySnapshot,
  revalidateTopicAuthority,
  saveTopicAuthority,
  TopicAuthorityPersistenceError,
  TopicAuthorityValidationError,
} from "@/lib/topicAuthority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 1_000_000;
const PROTECTED_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
};

function equalSecret(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function failure(message: string, status: number, authenticate = false) {
  return NextResponse.json({ error: message }, {
    status,
    headers: {
      ...PROTECTED_HEADERS,
      ...(authenticate ? { "WWW-Authenticate": 'Basic realm="JJ University Admin", charset="UTF-8"' } : {}),
    },
  });
}

function assertAdminRequest(request: NextRequest) {
  const requiredPassword = process.env.ADMIN_PASSWORD;
  if (!requiredPassword) return process.env.NODE_ENV === "development" ? null : failure("Not found.", 404);
  const credentials = decodeBasicCredentials(request.headers.get("authorization") || "");
  if (!credentials) return failure("Admin access required.", 401, true);
  const requiredUser = process.env.ADMIN_USERNAME;
  if ((requiredUser && !equalSecret(credentials.username, requiredUser))
    || !equalSecret(credentials.password, requiredPassword)) {
    return failure("Admin access required.", 401, true);
  }
  return null;
}

function protectedVersionedJson(value: unknown, version: string, status = 200) {
  const response = versionedJson(value, version, { status });
  Object.entries(PROTECTED_HEADERS).forEach(([name, headerValue]) => response.headers.set(name, headerValue));
  return response;
}

export async function GET(request: NextRequest) {
  const accessError = assertAdminRequest(request);
  if (accessError) return accessError;

  try {
    const snapshot = await readTopicAuthoritySnapshot();
    const { version, ...body } = snapshot;
    return protectedVersionedJson(body, version, snapshot.diagnostics.valid ? 200 : 409);
  } catch (error) {
    console.error("Topic authority read failed", error);
    return failure(
      error instanceof TopicAuthorityValidationError
        ? error.message
        : "The Topic authority failed its integrity checks. No partial or bundled fallback was returned.",
      500,
    );
  }
}

async function save(request: NextRequest) {
  const accessError = assertAdminRequest(request);
  if (accessError) return accessError;

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) return failure("The Topic save is too large.", 413);

  try {
    const expectedVersion = expectedAdminVersion(request);
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) return failure("The Topic save is too large.", 413);
    const parsed = JSON.parse(rawBody || "{}") as unknown;
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
    const submitted = body && Object.hasOwn(body, "authority") ? body.authority : parsed;
    const suppliedMessage = typeof body?.message === "string" ? body.message.trim() : "";
    const message = suppliedMessage.slice(0, 160)
      || `Update JJU Topic authority (${new Date().toISOString().slice(0, 10)})`;
    const saved = await saveTopicAuthority(submitted, expectedVersion, message);
    revalidateTopicAuthority();
    const { version, ...responseBody } = saved;
    return protectedVersionedJson({ saved: true, ...responseBody }, version);
  } catch (error) {
    if (error instanceof AdminVersionConflictError) return failure(error.message, 409);
    if (error instanceof TopicAuthorityValidationError || error instanceof SyntaxError) {
      return failure(error instanceof Error ? error.message : "The Topic save is invalid.", 400);
    }
    if (error instanceof TopicAuthorityPersistenceError) return failure(error.message, 503);
    console.error("Topic authority save failed", error);
    return failure("The Topic authority could not be saved. The previous authority remains unchanged.", 500);
  }
}

export async function POST(request: NextRequest) {
  return save(request);
}

export async function PUT(request: NextRequest) {
  return save(request);
}
