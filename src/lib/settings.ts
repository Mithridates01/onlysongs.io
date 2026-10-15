import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { trySchedule, tryUnschedule } from "./jobs";
import type { SettingsPatch } from "./schemas";

// The patch is already validated by the settingsPatch schema; this applies it
// and enforces the rules that need the stored row.
export async function applySettings(
  userId: string,
  patch: SettingsPatch,
): Promise<{ ok: true; warning?: string } | { ok: false; error: string; status: number }> {
  const current = await prisma.blockerSettings.findUnique({ where: { userId } });
  const spotify = await prisma.spotifyConnection.findUnique({ where: { userId } });
  if (!current) return { ok: false, error: "Account setup is incomplete.", status: 400 };

  const data: Prisma.BlockerSettingsUpdateInput = {};
  if (patch.intervalSeconds !== undefined) data.intervalSeconds = patch.intervalSeconds;
  if (patch.blockPodcasts !== undefined) data.blockPodcasts = patch.blockPodcasts;
  if (patch.blockAudiobooks !== undefined) data.blockAudiobooks = patch.blockAudiobooks;
  if (patch.timeZone !== undefined) data.timeZone = patch.timeZone;
  if (patch.quietHours !== undefined) data.quietHours = patch.quietHours ?? Prisma.DbNull;
  if (patch.allowedShows !== undefined) data.allowedShowIds = patch.allowedShows;
  if (patch.replacement !== undefined) {
    data.replacementUri = patch.replacement?.uri ?? null;
    data.replacementLabel = patch.replacement?.label ?? null;
    data.replacementArt = patch.replacement?.art ?? null;
    data.replacementKind = patch.replacement?.kind ?? null;
  }

  const nextReplacement = patch.replacement !== undefined ? (patch.replacement?.uri ?? null) : current.replacementUri;
  const nextEnabled = patch.enabled ?? current.enabled;
  if (patch.replacement === null && nextEnabled) {
    return { ok: false, error: "Turn the blocker off before clearing the replacement.", status: 400 };
  }
  if (nextEnabled) {
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
