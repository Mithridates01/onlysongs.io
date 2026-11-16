import { z } from "zod";
import { json, parseJson, requireOperator } from "@/lib/http";
import { purgeListening, setHistoryCollection } from "@/lib/listening";
import { log } from "@/lib/log";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("collect"), on: z.boolean() }),
  z.object({ action: z.literal("purge"), confirm: z.literal("PURGE ALL") }),
]);

// Operator only: the platform-wide collection switch, and purging everyone's history.
export async function POST(request: Request) {
  const operator = await requireOperator();
  if (!operator) return json({ error: "Not found." }, 404);
  const parsed = await parseJson(request, body);
  if (!parsed.ok) return parsed.response;
  if (parsed.data.action === "collect") {
    await setHistoryCollection(parsed.data.on);
    log.info("listening history switched", { on: parsed.data.on, by: operator.id });
    return json({ ok: true, on: parsed.data.on });
  }
  const deleted = await purgeListening();
  log.info("listening history purged", { scope: "all", deleted, by: operator.id });
  return json({ ok: true, deleted });
}
