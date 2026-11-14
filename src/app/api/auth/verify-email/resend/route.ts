import { sendVerification } from "@/lib/auth-actions";
import { json, requireUser } from "@/lib/http";
import { MINUTE, rateLimit } from "@/lib/rate-limit";

export async function POST() {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  if (user.emailVerifiedAt) return json({ ok: true, alreadyVerified: true });
  const limit = await rateLimit({ key: `verify:${user.id}`, limit: 3, windowMs: 60 * MINUTE });
  if (!limit.ok) return json({ error: "Too many emails. Try again later." }, 429);
  const sent = await sendVerification(user);
  return sent ? json({ ok: true }) : json({ error: "Could not send the email. Try again later." }, 502);
}
