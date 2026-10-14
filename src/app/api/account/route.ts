import { prisma } from "@/lib/db";
import { json, requireUser } from "@/lib/http";
import { tryUnschedule } from "@/lib/jobs";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export async function DELETE() {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  await tryUnschedule(user.id);
  await prisma.user.delete({ where: { id: user.id } });
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return response;
}
