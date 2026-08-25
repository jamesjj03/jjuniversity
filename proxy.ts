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
  if (!path || path === "api" || path.startsWith("api/")) return "/admin";
  return `/${path}`;
}

function notFound() {
  return new NextResponse("Not found.", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
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
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export function proxy(request: NextRequest) {
  const adminPath = cleanAdminPath(process.env.ADMIN_PATH);
  const isCustomAdminPath = request.nextUrl.pathname === adminPath || request.nextUrl.pathname.startsWith(`${adminPath}/`);
  const isDefaultAdminPath = request.nextUrl.pathname === "/admin" || request.nextUrl.pathname.startsWith("/admin/");
  const isAdminApiPath = request.nextUrl.pathname === "/api/admin" || request.nextUrl.pathname.startsWith("/api/admin/");
  const isProtectedAudioPreview = isProtectedTacosPreviewPath(request.nextUrl.pathname);

  if (!isAdminPath(request.nextUrl.pathname) && !isCustomAdminPath && !isProtectedAudioPreview) return NextResponse.next();
  if (adminPath !== "/admin" && isDefaultAdminPath) return notFound();

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === "development") return NextResponse.next();
    return notFound();
  }

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
    const response = NextResponse.rewrite(url);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
