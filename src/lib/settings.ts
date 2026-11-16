import { Prisma, type BlockerSettings } from "@prisma/client";
import { prisma } from "./db";
import { DELAY_MS, isDue, widens } from "./delay";
import { trySchedule, tryUnschedule } from "./jobs";
import { parseQuietHours } from "./quiet-hours";
import type { SettingsPatch } from "./schemas";

// Applies delayed changes whose hour has passed. Every reader of the settings
// (checks, status, saves) calls this first, so nothing waits on a timer.
export async function settlePending(settings: BlockerSettings, now = new Date()): Promise<BlockerSettings> {
  const data: Prisma.BlockerSettingsUpdateInput = {};
  if (isDue(settings.offAt, now)) Object.assign(data, { enabled: false, offAt: null });
  if (isDue(settings.quietHoursAt, now)) {
    Object.assign(data, { quietHours: settings.pendingQuietHours ?? Prisma.DbNull, pendingQuietHours: Prisma.DbNull, quietHoursAt: null });
  }
  if (Object.keys(data).length === 0) return settings;
  const updated = await prisma.blockerSettings.update({ where: { userId: settings.userId }, data });
  if (settings.enabled && !updated.enabled) await tryUnschedule(settings.userId);
  return updated;
}

// The patch is already validated by the settingsPatch schema; this applies it
// and enforces the rules that need the stored row.
export async function applySettings(
  userId: string,
  patch: SettingsPatch,
): Promise<{ ok: true; warning?: string } | { ok: false; error: string; status: number }> {
  const stored = await prisma.blockerSettings.findUnique({ where: { userId } });
  const spotify = await prisma.spotifyConnection.findUnique({ where: { userId } });
  if (!stored) return { ok: false, error: "Account setup is incomplete.", status: 400 };
  const now = new Date();
  const current = await settlePending(stored, now);
  // The delay only guards a blocker that is actually running.
  const guarded = current.enabled && spotify?.status === "connected" && Boolean(spotify.refreshTokenEnc);
  const later = new Date(now.getTime() + DELAY_MS);

  const data: Prisma.BlockerSettingsUpdateInput = {};
  if (patch.intervalSeconds !== undefined) data.intervalSeconds = patch.intervalSeconds;
  if (patch.blockPodcasts !== undefined) data.blockPodcasts = patch.blockPodcasts;
  if (patch.blockAudiobooks !== undefined) data.blockAudiobooks = patch.blockAudiobooks;
  if (patch.timeZone !== undefined) data.timeZone = patch.timeZone;
  if (patch.quietHours !== undefined) {
    if (guarded && widens(parseQuietHours(current.quietHours), patch.quietHours)) {
      data.pendingQuietHours = patch.quietHours ?? Prisma.DbNull;
      data.quietHoursAt = later;
    } else {
      // Narrower or the same: applies now and drops anything waiting.
      data.quietHours = patch.quietHours ?? Prisma.DbNull;
      data.pendingQuietHours = Prisma.DbNull;
      data.quietHoursAt = null;
    }
  }
  if (patch.allowedShows !== undefined) data.allowedShowIds = patch.allowedShows;
  if (patch.replacement !== undefined) {
    data.replacementUri = patch.replacement?.uri ?? null;
    data.replacementLabel = patch.replacement?.label ?? null;
    data.replacementArt = patch.replacement?.art ?? null;
    data.replacementKind = patch.replacement?.kind ?? null;
  }

  // Turning off waits; asking again keeps the first time. Turning on cancels it.
  const delayOff = patch.enabled === false && guarded;
  if (delayOff) data.offAt = current.offAt ?? later;
  else if (patch.enabled !== undefined) data.offAt = null;

  const nextReplacement = patch.replacement !== undefined ? (patch.replacement?.uri ?? null) : current.replacementUri;
  const nextEnabled = delayOff ? true : (patch.enabled ?? current.enabled);
  if (patch.replacement === null && nextEnabled) {
    return { ok: false, error: "Turn the blocker off before clearing the replacement.", status: 400 };
  }
  if (nextEnabled && !delayOff) {
    if (!nextReplacement) return { ok: false, error: "Pick a replacement song before turning the blocker on.", status: 400 };
    if (spotify?.status !== "connected" || !spotify.refreshTokenEnc) {
      return { ok: false, error: "Connect Spotify before turning the blocker on.", status: 400 };
    }
  }
  data.enabled = nextEnabled;

  const interval = patch.intervalSeconds ?? current.intervalSeconds;
  const wasEnabled = current.enabled;
  await prisma.blockerSettings.update({ where: { userId }, data });

  let warning: string | undefined;
  if (nextEnabled) {
    const scheduleWarning = await trySchedule(userId, interval, !wasEnabled);
    if (scheduleWarning) warning = scheduleWarning;
  } else if (wasEnabled) {
    await tryUnschedule(userId);
  }

  return warning ? { ok: true, warning } : { ok: true };
}
