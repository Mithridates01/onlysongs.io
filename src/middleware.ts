import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "./lib/csp";
import { readSession, SESSION_COOKIE } from "./lib/session";

const PUBLIC_PAGES = new Set(["/", "/login", "/signup", "/join", "/forgot-password", "/reset-password", "/verify-email"]);

// Passes the request on with this request's nonce. Next reads the CSP request
// header and stamps the nonce on the scripts it renders.
function pass(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const csp = buildCsp(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

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
    return pass(request);
  }

  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return pass(request);

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (PUBLIC_PAGES.has(pathname)) return pass(request);

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
