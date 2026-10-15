import { prisma } from "./db";

export async function pruneOldActivity(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const result = await prisma.activityLog.deleteMany({ where: { at: { lt: cutoff } } });
  return result.count;
}
