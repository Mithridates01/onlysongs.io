import { z } from "zod";
import { prisma } from "@/lib/db";
import { json, parseJson, requireOperator } from "@/lib/http";
import { purgeListening } from "@/lib/listening";
import { log } from "@/lib/log";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("collect"), on: z.boolean() }),
  z.object({ action: z.literal("purge") }),
]);

// Operator only: one account's collection switch, and purging its history.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const operator = await requireOperator();
  if (!operator) return json({ error: "Not found." }, 404);
  const { id } = await params;
  const parsed = await parseJson(request, body);
  if (!parsed.ok) return parsed.response;
  if (parsed.data.action === "collect") {
    const updated = await prisma.user.updateMany({ where: { id }, data: { historyEnabled: parsed.data.on } });
    if (updated.count === 0) return json({ error: "No such account." }, 404);
    log.info("listening history switched", { userId: id, on: parsed.data.on, by: operator.id });
    return json({ ok: true, on: parsed.data.on });
  }
  const deleted = await purgeListening(id);
  log.info("listening history purged", { userId: id, deleted, by: operator.id });
  return json({ ok: true, deleted });
}
