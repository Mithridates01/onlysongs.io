import { Prisma } from "@prisma/client";
import { checkPassword, createUser, normalizeEmail, sessionFor } from "@/lib/auth-actions";
import { json, requestIp } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export async function POST(request: Request) {
  const limit = rateLimit(`signup:${requestIp(request)}`, 5, 15 * 60 * 1000);
  if (!limit.ok) return json({ error: "Too many sign-up attempts. Wait a few minutes." }, 429);

  const body = await readBody(request);
  const email = normalizeEmail(body?.email);
  const password = checkPassword(body?.password);
  if (!email || !password) {
    return json({ error: "Use a valid email and a password of at least 8 characters." }, 400);
  }

  try {
    const user = await createUser(email, password);
    const token = await sessionFor(user);
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

async function readBody(request: Request): Promise<{ email?: unknown; password?: unknown } | null> {
  try {
    return (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return null;
  }
}
