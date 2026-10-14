import { Prisma } from "@prisma/client";
import { createUser, sendVerification, sessionFor } from "@/lib/auth-actions";
import { json, parseJson, requestIp } from "@/lib/http";
import { MINUTE, rateLimit } from "@/lib/rate-limit";
import { signupBody } from "@/lib/schemas";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export async function POST(request: Request) {
  const limit = await rateLimit({ key: `signup:ip:${requestIp(request)}`, limit: 5, windowMs: 15 * MINUTE });
  if (!limit.ok) return json({ error: "Too many sign-up attempts. Wait a few minutes." }, 429);

  const body = await parseJson(request, signupBody, "Use a valid email and a password of at least 8 characters.");
  if (!body.ok) return body.response;
  const { email, password } = body.data;

  try {
    const user = await createUser(email, password);
    await sendVerification(user);
    const token = await sessionFor(user, request);
    const response = json({ ok: true, next: "/onboarding" });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return json({ error: "An account with that email already exists." }, 409);
    }
    return json({ error: "Could not create the account." }, 500);
  }
}
