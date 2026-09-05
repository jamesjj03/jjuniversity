import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { decodeBasicCredentials } from "@/lib/basicAuth";
import { versionedJson } from "@/lib/adminVersionedJson";

export const ADMIN_API_HEADERS = {
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
export function adminApiFailure(message: string, status: number, authenticate = false) {
  return NextResponse.json({ error: message }, {
    status,
    headers: {
      ...ADMIN_API_HEADERS,
      ...(authenticate ? { "WWW-Authenticate": 'Basic realm="JJ University Admin", charset="UTF-8"' } : {}),
    },
  });
}

export function assertAdminApiRequest(request: NextRequest) {
  const requiredPassword = process.env.ADMIN_PASSWORD;
  if (!requiredPassword) return process.env.NODE_ENV === "development" ? null : adminApiFailure("Not found.", 404);
  const credentials = decodeBasicCredentials(request.headers.get("authorization") || "");
  if (!credentials) return adminApiFailure("Admin access required.", 401, true);
  const requiredUser = process.env.ADMIN_USERNAME;
  if ((requiredUser && !equalSecret(credentials.username, requiredUser))
    || !equalSecret(credentials.password, requiredPassword)) {
    return adminApiFailure("Admin access required.", 401, true);
  }
  return null;
}

export function protectedAdminVersionedJson(value: unknown, version: string, status = 200) {
  const response = versionedJson(value, version, { status });
  Object.entries(ADMIN_API_HEADERS).forEach(([name, headerValue]) => response.headers.set(name, headerValue));
  return response;
}
