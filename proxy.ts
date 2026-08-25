import { NextResponse, type NextRequest } from "next/server";
import { decodeBasicCredentials } from "@/lib/basicAuth";

const ADMIN_PATHS = ["/admin", "/api/admin", "/fiber-qr"];
const TACOS_PREVIEW_SLUG = "everything-i-touch-turns-to-tacos";
const TACOS_PREVIEW_EDITION_ID = "4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46";

function isAdminPath(pathname: string) {
  return ADMIN_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`));
}

function isProtectedTacosPreviewPath(pathname: string) {
  if (process.env.VERCEL_ENV !== "preview" || process.env.JJU_AUDIO_CATALOG_ENABLED !== "1") return false;
  let normalizedPath = pathname.toLowerCase();
  try {
    normalizedPath = decodeURIComponent(pathname).toLowerCase();
  } catch {
    // A malformed escape cannot match the protected canonical routes.
  }
  const protectedListenPaths = [
    `/listen/${TACOS_PREVIEW_SLUG}`,
    "/listen/tacos",
    `/site-v2/listen/${TACOS_PREVIEW_SLUG}`,
    "/site-v2/listen/tacos",
  ];
  return protectedListenPaths.includes(normalizedPath)
    || normalizedPath.startsWith(`/api/audio/editions/${TACOS_PREVIEW_EDITION_ID}/`);
}

function cleanAdminPath(value: string | undefined) {
  if (!value) return "/admin";
  const path = value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  const firstSegment = path.split("/")[0].toLowerCase();
  if (
    !path
    || !/^[a-z0-9/_-]+$/i.test(path)
    || path === "api"
    || path.startsWith("api/")
    || firstSegment === "_next"
  ) return "/admin";
  return `/${path}`;
}

function notFound() {
  return new NextResponse("Not found.", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function unauthorized() {
  return new NextResponse("Admin access required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="JJ University Admin", charset="UTF-8"',
      "Cache-Control": "no-store",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function forbidden() {
  return new NextResponse("Forbidden.", {
    status: 403,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function isUnsafeMethod(method: string) {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function isInvalidAdminMutationOrigin(request: NextRequest) {
  if (!isUnsafeMethod(request.method)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const forwardedHost = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
    const forwardedProto = (request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(/:$/, "")).split(",")[0].trim();
    if (!forwardedHost || (forwardedProto !== "http" && forwardedProto !== "https")) return true;
    const requestOrigin = new URL(`${forwardedProto}://${forwardedHost}`).origin;
    return new URL(origin).origin !== requestOrigin;
  } catch {
    return true;
  }
}

function protectResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  return response;
}

export function proxy(request: NextRequest) {
  const adminPath = cleanAdminPath(process.env.ADMIN_PATH);
  const isCustomAdminPath = request.nextUrl.pathname === adminPath || request.nextUrl.pathname.startsWith(`${adminPath}/`);
  const isDefaultAdminPath = request.nextUrl.pathname === "/admin" || request.nextUrl.pathname.startsWith("/admin/");
  const isAdminApiPath = request.nextUrl.pathname === "/api/admin" || request.nextUrl.pathname.startsWith("/api/admin/");
  const isProtectedAudioPreview = isProtectedTacosPreviewPath(request.nextUrl.pathname);

  if (!isAdminPath(request.nextUrl.pathname) && !isCustomAdminPath && !isProtectedAudioPreview) return NextResponse.next();
  if (adminPath !== "/admin" && isDefaultAdminPath) return notFound();
  if (isAdminApiPath && isInvalidAdminMutationOrigin(request)) return forbidden();

  const password = process.env.ADMIN_PASSWORD;
  if (!password) return notFound();

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized();

  const credentials = decodeBasicCredentials(auth);
  if (!credentials) return unauthorized();
  const { username, password: provided } = credentials;
  const requiredUser = process.env.ADMIN_USERNAME;

  if (requiredUser && username !== requiredUser) return unauthorized();
  if (provided !== password) return unauthorized();

  if (isCustomAdminPath && !isAdminApiPath && adminPath !== "/admin") {
    const url = request.nextUrl.clone();
    url.pathname = url.pathname.replace(adminPath, "/admin");
    return protectResponse(NextResponse.rewrite(url));
  }

  return protectResponse(NextResponse.next());
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
