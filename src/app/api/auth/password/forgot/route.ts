import { sendPasswordReset } from "@/lib/auth-actions";
import { prisma } from "@/lib/db";
import { json, parseJson, requestIp } from "@/lib/http";
import { MINUTE, rateLimit } from "@/lib/rate-limit";
import { forgotBody } from "@/lib/schemas";

// Always answers the same way, so it never reveals whether an account exists.
export async function POST(request: Request) {
  const body = await parseJson(request, forgotBody, "Enter a valid email.");
  if (!body.ok) return body.response;
  const { email } = body.data;
  const limit = await rateLimit(
    { key: `forgot:acct:${email}`, limit: 3, windowMs: 60 * MINUTE },
    { key: `forgot:ip:${requestIp(request)}`, limit: 10, windowMs: 60 * MINUTE },
  );
  if (!limit.ok) return json({ error: "Too many requests. Try again later." }, 429);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) await sendPasswordReset(user);
  return json({ ok: true });
}
