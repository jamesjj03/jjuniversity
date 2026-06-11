import { NextResponse, type NextRequest } from "next/server";

const ADMIN_PATHS = ["/admin", "/api/admin", "/fiber-qr"];

function isAdminPath(pathname: string) {
  return ADMIN_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`));
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

  if (!isAdminPath(request.nextUrl.pathname) && !isCustomAdminPath) return NextResponse.next();
  if (adminPath !== "/admin" && isDefaultAdminPath) return notFound();

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === "development") return NextResponse.next();
    return notFound();
  }

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized();

  const decoded = atob(auth.slice("Basic ".length));
  const separator = decoded.indexOf(":");
  const username = separator >= 0 ? decoded.slice(0, separator) : "";
  const provided = separator >= 0 ? decoded.slice(separator + 1) : decoded;
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
