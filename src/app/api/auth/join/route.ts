import { sessionFor } from "@/lib/auth-actions";
import { acceptInvite } from "@/lib/early-access";
import { json, parseJson, requestIp } from "@/lib/http";
import { MINUTE, rateLimit } from "@/lib/rate-limit";
import { joinBody } from "@/lib/schemas";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

// Finishes an approved early-access invite: sets the password, creates the
// account and signs the person in.
export async function POST(request: Request) {
  const limit = await rateLimit({ key: `join:ip:${requestIp(request)}`, limit: 10, windowMs: 15 * MINUTE });
  if (!limit.ok) return json({ error: "Too many attempts. Wait a few minutes." }, 429);
  const body = await parseJson(request, joinBody);
  if (!body.ok) return body.response;
  const user = await acceptInvite(body.data.token, body.data.password);
  if (!user) return json({ error: "This invite is invalid, expired, or already used." }, 400);
  const token = await sessionFor(user, request);
  const response = json({ ok: true, next: "/onboarding" });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
