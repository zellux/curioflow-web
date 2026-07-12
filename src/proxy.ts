import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "curioflow_session";
const PROTECTED_PREFIXES = [
  "/app",
  "/home",
  "/api",
  "/add",
  "/archive",
  "/ask",
  "/briefing",
  "/item",
  "/read",
  "/recent-posts",
  "/settings",
  "/source",
  "/status"
];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isPublicTokenEndpoint(pathname: string) {
  return pathname === "/api/account/export/download";
}

function isInfrastructureProbe(pathname: string) {
  return pathname === "/api/health/live" || pathname === "/api/health/ready";
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/app") {
    return NextResponse.redirect(new URL(`/home${search}`, request.url));
  }

  if (isPublicTokenEndpoint(pathname) || isInfrastructureProbe(pathname)) return NextResponse.next();
  if (!isProtectedPath(pathname)) return NextResponse.next();

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionCookie) return NextResponse.next();

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("returnTo", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}
