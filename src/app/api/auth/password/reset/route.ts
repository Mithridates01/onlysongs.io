import { checkPassword, setPassword } from "@/lib/auth-actions";
import { consumeToken } from "@/lib/auth-tokens";
import { prisma } from "@/lib/db";
import { json, requestIp } from "@/lib/http";
import { MINUTE, rateLimit } from "@/lib/rate-limit";
import { revokeUserSessions } from "@/lib/sessions";

export async function POST(request: Request) {
  const limit = await rateLimit({ key: `reset:ip:${requestIp(request)}`, limit: 10, windowMs: 15 * MINUTE });
  if (!limit.ok) return json({ error: "Too many attempts. Wait a few minutes." }, 429);
  const body = (await request.json().catch(() => null)) as { token?: unknown; password?: unknown } | null;
  const password = checkPassword(body?.password);
  if (!password) return json({ error: "Use a password of at least 8 characters." }, 400);
  const userId = await consumeToken(body?.token, "reset_password");
  if (!userId) return json({ error: "This link is invalid, expired, or already used." }, 400);
  await setPassword(userId, password);
  // A reset signs out every device, and the link proved the inbox is theirs.
  await revokeUserSessions(userId);
  await prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  return json({ ok: true });
}
