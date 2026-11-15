import { runUserCheck } from "@/lib/blocker-run";
import { json, requireUser } from "@/lib/http";
import { log } from "@/lib/log";
import { MINUTE, rateLimit } from "@/lib/rate-limit";
import { buildStatus } from "@/lib/status";

export async function POST() {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  // Each manual check spends the user's own Spotify quota.
  const limit = await rateLimit({ key: `check:${user.id}`, limit: 10, windowMs: MINUTE });
  if (!limit.ok) return json({ outcome: "error", detail: "Too many checks. Wait a minute." }, 429);
  try {
    const summary = await runUserCheck(user.id, { ignoreCooldown: true, observeWhenOff: true });
    const status = await buildStatus(user.id);
    return json({ ...summary, status });
  } catch (error) {
    log.error("manual check failed", { userId: user.id, message: error instanceof Error ? error.message : "unknown" });
    return json({ outcome: "error", detail: "The check could not run. Confirm Redis and Postgres are up." }, 503);
  }
}
