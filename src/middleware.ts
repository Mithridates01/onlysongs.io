import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "./lib/session";

const PUBLIC_PAGES = new Set(["/", "/login", "/signup", "/join", "/forgot-password", "/reset-password", "/verify-email"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/callback/") ||
    pathname === "/api/health" ||
    pathname === "/api/health/worker" ||
    pathname === "/api/early-access" ||
    pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.next();
  }

  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
