import { normalizeEmail, sendPasswordReset } from "@/lib/auth-actions";
import { prisma } from "@/lib/db";
import { json, requestIp } from "@/lib/http";
import { MINUTE, rateLimit } from "@/lib/rate-limit";

// Always answers the same way, so it never reveals whether an account exists.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = normalizeEmail(body?.email);
  if (!email) return json({ error: "Enter a valid email." }, 400);
  const limit = await rateLimit(
    { key: `forgot:acct:${email}`, limit: 3, windowMs: 60 * MINUTE },
    { key: `forgot:ip:${requestIp(request)}`, limit: 10, windowMs: 60 * MINUTE },
  );
  if (!limit.ok) return json({ error: "Too many requests. Try again later." }, 429);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) await sendPasswordReset(user);
  return json({ ok: true });
}
