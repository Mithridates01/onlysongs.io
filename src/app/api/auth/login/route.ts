import { nextPath, sessionFor, verifyLogin } from "@/lib/auth-actions";
import { json, requestIp } from "@/lib/http";
import { MINUTE, rateLimit } from "@/lib/rate-limit";
import { loginBody } from "@/lib/schemas";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export async function POST(request: Request) {
  const body = loginBody.safeParse(await request.json().catch(() => undefined));
  if (!body.success) return json({ error: "Email or password is wrong." }, 401);
  const { email, password } = body.data;

  // Per account (any IP), per account and IP, and per IP across accounts.
  const ip = requestIp(request);
  const limit = await rateLimit(
    { key: `login:acct:${email}`, limit: 20, windowMs: 15 * MINUTE },
    { key: `login:acct-ip:${email}:${ip}`, limit: 10, windowMs: 15 * MINUTE },
    { key: `login:ip:${ip}`, limit: 50, windowMs: 15 * MINUTE },
  );
  if (!limit.ok) return json({ error: "Too many sign-in attempts. Wait a few minutes." }, 429);

  const user = await verifyLogin(email, password);
  if (!user) return json({ error: "Email or password is wrong." }, 401);

  const token = await sessionFor(user, request);
  const response = json({ ok: true, next: await nextPath(user.id) });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
