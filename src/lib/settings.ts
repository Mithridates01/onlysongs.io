import { Prisma } from "@prisma/client";
import { parseSpotifyUri } from "./spotify-uri";
import { normalizeClock } from "./quiet-hours";
import { prisma } from "./db";
import { trySchedule, tryUnschedule } from "./jobs";
import type { AllowedShowView, ReplacementView } from "./types";

export type SettingsPatch = {
  enabled?: boolean;
  intervalSeconds?: number;
  blockAudiobooks?: boolean;
  timeZone?: string;
  quietHours?: { start: string; end: string } | null;
  allowedShows?: AllowedShowView[];
  replacement?: ReplacementView | null;
};

export async function applySettings(
  userId: string,
  patch: SettingsPatch,
): Promise<{ ok: true; warning?: string } | { ok: false; error: string; status: number }> {
  const current = await prisma.blockerSettings.findUnique({ where: { userId } });
  const spotify = await prisma.spotifyConnection.findUnique({ where: { userId } });
  if (!current) return { ok: false, error: "Account setup is incomplete.", status: 400 };

  const data: Prisma.BlockerSettingsUpdateInput = {};
  let quietValue: { start: string; end: string } | null | undefined;
  let allowedValue: AllowedShowView[] | undefined;

  if (patch.intervalSeconds !== undefined) {
    if (!Number.isInteger(patch.intervalSeconds) || patch.intervalSeconds < 10 || patch.intervalSeconds > 300) {
      return { ok: false, error: "Poll interval must be between 10 and 300 seconds.", status: 400 };
    }
    data.intervalSeconds = patch.intervalSeconds;
  }

  if (patch.blockAudiobooks !== undefined) data.blockAudiobooks = Boolean(patch.blockAudiobooks);

  if (patch.timeZone !== undefined) {
    if (!isTimeZone(patch.timeZone)) return { ok: false, error: "That time zone is not recognized.", status: 400 };
    data.timeZone = patch.timeZone;
  }

  if (patch.quietHours !== undefined) {
    if (patch.quietHours === null) {
      quietValue = null;
    } else {
      const start = normalizeClock(patch.quietHours.start);
      const end = normalizeClock(patch.quietHours.end);
      if (!start || !end) {
        return { ok: false, error: "Quiet hours use 24-hour times like 06:00.", status: 400 };
      }
      if (start === end) {
        return { ok: false, error: "Quiet hours need a start and end that differ.", status: 400 };
      }
      quietValue = { start, end };
    }
  }

  if (patch.allowedShows !== undefined) {
    if (!Array.isArray(patch.allowedShows) || patch.allowedShows.length > 40) {
      return { ok: false, error: "The allow list can hold up to 40 shows.", status: 400 };
    }
    const cleaned: AllowedShowView[] = [];
    for (const show of patch.allowedShows) {
      if (!show || typeof show.id !== "string" || typeof show.name !== "string") {
        return { ok: false, error: "A show on the allow list is incomplete.", status: 400 };
      }
      if (!/^[A-Za-z0-9]+$/.test(show.id) || show.name.trim().length === 0 || show.name.length > 200) {
        return { ok: false, error: "A show on the allow list looks invalid.", status: 400 };
      }
      if (!cleaned.some((item) => item.id === show.id)) cleaned.push({ id: show.id, name: show.name.trim() });
    }
    allowedValue = cleaned;
  }

  if (patch.replacement !== undefined) {
    if (patch.replacement === null) {
      data.replacementUri = null;
      data.replacementLabel = null;
      data.replacementArt = null;
      data.replacementKind = null;
    } else {
      const parsed = parseSpotifyUri(patch.replacement.uri);
      if (!parsed || (parsed.kind !== "track" && parsed.kind !== "playlist" && parsed.kind !== "album")) {
        return { ok: false, error: "The replacement must be a track, playlist, or album.", status: 400 };
      }
      if (parsed.kind !== patch.replacement.kind) {
        return { ok: false, error: "The replacement type does not match its Spotify link.", status: 400 };
      }
      const label = patch.replacement.label?.trim();
      if (!label || label.length > 300) return { ok: false, error: "The replacement needs a name.", status: 400 };
      data.replacementUri = parsed.uri;
      data.replacementLabel = label;
      data.replacementArt = patch.replacement.art || null;
      data.replacementKind = parsed.kind;
    }
  }

  const nextReplacement = patch.replacement !== undefined ? (patch.replacement === null ? null : data.replacementUri) : current.replacementUri;
  const nextEnabled = patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled;
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
  if (quietValue !== undefined) data.quietHours = quietValue === null ? Prisma.DbNull : quietValue;
  if (allowedValue !== undefined) data.allowedShowIds = allowedValue;

  const interval = typeof data.intervalSeconds === "number" ? data.intervalSeconds : current.intervalSeconds;
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

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
