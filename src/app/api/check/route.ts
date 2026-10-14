import { runUserCheck } from "@/lib/blocker-run";
import { json, requireUser } from "@/lib/http";
import { log } from "@/lib/log";
import { buildStatus } from "@/lib/status";

export async function POST() {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  try {
    const summary = await runUserCheck(user.id, { ignoreCooldown: true });
    const status = await buildStatus(user.id);
    return json({ ...summary, status });
  } catch (error) {
    log.error("manual check failed", { message: error instanceof Error ? error.message : "unknown" });
    return json({ outcome: "error", detail: "The check could not run. Confirm Redis and Postgres are up." }, 503);
  }
}
