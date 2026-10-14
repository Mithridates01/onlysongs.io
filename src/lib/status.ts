import { FAILURE_WARN_AT } from "./blocker-logic";
import { last4 } from "./crypto";
import { prisma } from "./db";
import { redirectUri } from "./env";
import { readWorkerHeart } from "./redis";
import { isQuietNow, parseQuietHours, startOfZonedDay } from "./quiet-hours";
import { readAllowedShows } from "./shows";
import type { ConnectionState, ReplacementView, StatusResponse } from "./types";

const REPLACED = ["replaced", "replaced_via_next"];

export async function buildStatus(userId: string): Promise<StatusResponse | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { spotify: true, settings: true, poll: true },
  });
  if (!user?.settings || !user.poll) return null;

  const settings = user.settings;
  const poll = user.poll;
  const spotify = user.spotify;
  const quiet = parseQuietHours(settings.quietHours);
  const quietHoursActive = isQuietNow(quiet, settings.timeZone);
  const connection = connectionState(spotify?.status, Boolean(spotify?.refreshTokenEnc), Boolean(spotify));
  const worker = await readWorkerHeart();

  const [blockedAllTime, blockedToday] = await Promise.all([
    prisma.activityLog.count({ where: { userId, result: { in: REPLACED } } }),
    prisma.activityLog.count({
      where: {
        userId,
        result: { in: REPLACED },
        at: { gte: startOfZonedDay(settings.timeZone) },
      },
    }),
  ]);

  const replacement: ReplacementView | null =
    settings.replacementUri &&
    settings.replacementLabel &&
    (settings.replacementKind === "track" ||
      settings.replacementKind === "playlist" ||
      settings.replacementKind === "album")
      ? {
          uri: settings.replacementUri,
          label: settings.replacementLabel,
          art: settings.replacementArt,
          kind: settings.replacementKind,
        }
      : null;

  const blockedNow = poll.nowPlayingKind === "episode" || poll.nowPlayingKind === "audiobook";
  const warnings: string[] = [];
  if (connection === "broken") warnings.push("Reconnect Spotify. The blocker is off until you do.");
  if (connection === "quota_paused") {
    warnings.push(
      poll.pausedUntil
        ? `Spotify quota is exceeded. Checks resume ${poll.pausedUntil.toLocaleString()}.`
        : "Spotify quota is exceeded. Checks are paused.",
    );
  }
  if (poll.consecutiveFailures >= FAILURE_WARN_AT) {
    warnings.push("The last 10 checks failed. Spotify may be unreachable from this server.");
  }
  if (!worker.online) {
    warnings.push("The worker is not running, so automatic checks are paused. Check now still works.");
  }

  return {
    blockerEnabled: settings.enabled,
    intervalSeconds: settings.intervalSeconds,
    blockPodcasts: settings.blockPodcasts,
    blockAudiobooks: settings.blockAudiobooks,
    timeZone: settings.timeZone,
    quietHours: quiet ? { start: quiet.start, end: quiet.end } : null,
    quietHoursActive,
    allowedShows: readAllowedShows(settings.allowedShowIds),
    connection,
    spotifyUserId: spotify?.spotifyUserId ?? null,
    clientIdLast4: spotify ? last4(spotify.clientId) : null,
    lastCheckedAt: poll.lastCheckedAt?.toISOString() ?? null,
    pausedUntil: poll.pausedUntil?.toISOString() ?? null,
    consecutiveFailures: poll.consecutiveFailures,
    lastError: poll.lastError,
    nowPlaying: {
      kind: poll.nowPlayingKind ?? "none",
      title: poll.nowPlayingTitle,
      subtitle: poll.nowPlayingSubtitle,
      art: poll.nowPlayingArt,
      blocked: blockedNow,
    },
    blockedToday,
    blockedAllTime,
    replacement,
    worker,
    warnings,
    redirectUri: redirectUri(),
    email: user.email,
    isAdmin: user.isAdmin,
  };
}

function connectionState(
  status: string | undefined,
  hasRefresh: boolean,
  hasRow: boolean,
): ConnectionState {
  if (!hasRow || !status || status === "disconnected") return "disconnected";
  if (status === "broken") return "broken";
  if (status === "quota_paused") return "quota_paused";
  if (status === "connected" && hasRefresh) return "connected";
  if (hasRefresh) return "connected";
  return "needs_connect";
}
