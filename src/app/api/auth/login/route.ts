import { nextPath, normalizeEmail, sessionFor, verifyLogin } from "@/lib/auth-actions";
import { json, requestIp } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export async function POST(request: Request) {
  const limit = rateLimit(`login:${requestIp(request)}`, 10, 15 * 60 * 1000);
  if (!limit.ok) return json({ error: "Too many sign-in attempts. Wait a few minutes." }, 429);

  let body: { email?: unknown; password?: unknown } | null = null;
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    body = null;
  }
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || password.length < 8) {
    return json({ error: "Email or password is wrong." }, 401);
  }

  const user = await verifyLogin(email, password);
  if (!user) return json({ error: "Email or password is wrong." }, 401);

  const token = await sessionFor(user);
  const response = json({ ok: true, next: await nextPath(user.id) });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
