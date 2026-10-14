import { prisma } from "@/lib/db";
import { json, requireUser } from "@/lib/http";
import { tryUnschedule } from "@/lib/jobs";

export async function POST() {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);

  await tryUnschedule(user.id);
  await prisma.spotifyConnection.deleteMany({ where: { userId: user.id } });
  await prisma.blockerSettings.update({ where: { userId: user.id }, data: { enabled: false } });
  return json({ ok: true });
}
