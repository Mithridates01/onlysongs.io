import { requestEarlyAccess } from "@/lib/early-access";
import { json, parseJson, requestIp } from "@/lib/http";
import { MINUTE, rateLimit } from "@/lib/rate-limit";
import { earlyAccessBody } from "@/lib/schemas";

// Public. Always answers the same way, so it never reveals who has asked or
// who already has an account.
export async function POST(request: Request) {
  const body = await parseJson(request, earlyAccessBody, "Enter a valid email.");
  if (!body.ok) return body.response;
  const limit = await rateLimit(
    { key: `early:ip:${requestIp(request)}`, limit: 10, windowMs: 60 * MINUTE },
    { key: `early:acct:${body.data.email}`, limit: 3, windowMs: 60 * MINUTE },
  );
  if (!limit.ok) return json({ error: "Too many requests. Try again later." }, 429);
  await requestEarlyAccess(body.data.email);
  return json({ ok: true });
}
