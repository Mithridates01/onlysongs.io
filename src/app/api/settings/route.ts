import { json, parseJson, requireUser } from "@/lib/http";
import { log } from "@/lib/log";
import { settingsPatch } from "@/lib/schemas";
import { applySettings } from "@/lib/settings";
import { buildStatus } from "@/lib/status";

export async function GET() {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const status = await buildStatus(user.id);
  if (!status) return json({ error: "Account setup is incomplete." }, 400);
  return json({
    enabled: status.blockerEnabled,
    intervalSeconds: status.intervalSeconds,
    blockPodcasts: status.blockPodcasts,
    blockAudiobooks: status.blockAudiobooks,
    timeZone: status.timeZone,
    quietHours: status.quietHours,
    allowedShows: status.allowedShows,
    replacement: status.replacement,
  });
}

export async function PUT(request: Request) {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const patch = await parseJson(request, settingsPatch);
  if (!patch.ok) {
    log.info("settings refused", { userId: user.id, reason: "invalid" });
    return patch.response;
  }
  const saved = await applySettings(user.id, patch.data);
  if (!saved.ok) {
    log.info("settings refused", { userId: user.id, reason: saved.error });
    return json({ error: saved.error }, saved.status);
  }
  log.info("settings saved", { userId: user.id, fields: Object.keys(patch.data), enabled: patch.data.enabled });
  return json({ ok: true, warning: saved.warning ?? null });
}
