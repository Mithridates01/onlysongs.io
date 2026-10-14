import { setPassword } from "@/lib/auth-actions";
import { consumeToken } from "@/lib/auth-tokens";
import { prisma } from "@/lib/db";
import { json, parseJson, requestIp } from "@/lib/http";
import { MINUTE, rateLimit } from "@/lib/rate-limit";
import { resetBody } from "@/lib/schemas";
import { revokeUserSessions } from "@/lib/sessions";

export async function POST(request: Request) {
  const limit = await rateLimit({ key: `reset:ip:${requestIp(request)}`, limit: 10, windowMs: 15 * MINUTE });
  if (!limit.ok) return json({ error: "Too many attempts. Wait a few minutes." }, 429);
  const body = await parseJson(request, resetBody);
  if (!body.ok) return body.response;
  const { token, password } = body.data;
  const userId = await consumeToken(token, "reset_password");
  if (!userId) return json({ error: "This link is invalid, expired, or already used." }, 400);
  await setPassword(userId, password);
  // A reset signs out every device, and the link proved the inbox is theirs.
  await revokeUserSessions(userId);
  await prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  return json({ ok: true });
}
