import { FAILURE_WARN_AT } from "./blocker-logic";
import { last4 } from "./crypto";
import { prisma } from "./db";
import { redirectUri } from "./env";
import { readWorkerHeart } from "./redis";
import { isQuietNow, parseQuietHours, startOfZonedDay } from "./quiet-hours";
import { readAllowedShows } from "./shows";
import type { ActivityResult, ConnectionStatus } from "@prisma/client";
import type { ConnectionState, ReplacementView, StatusResponse, StatusWarning } from "./types";

const REPLACED: ActivityResult[] = ["replaced", "replaced_via_next"];

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
  const quotaPaused = poll.pauseReason === "quota" && Boolean(poll.pausedUntil && poll.pausedUntil > new Date());
  const connection = connectionState(spotify?.status, Boolean(spotify?.refreshTokenEnc), Boolean(spotify), quotaPaused);
  const worker = await readWorkerHeart();

  const [blockedAllTime, blockedToday, recent] = await Promise.all([
    prisma.activityLog.count({ where: { userId, result: { in: REPLACED } } }),
    prisma.activityLog.count({
      where: {
        userId,
        result: { in: REPLACED },
        at: { gte: startOfZonedDay(settings.timeZone) },
      },
    }),
    prisma.activityLog.findMany({
      where: { userId, result: { in: REPLACED } },
      orderBy: { at: "desc" },
      take: 3,
      select: { at: true, showName: true, episodeName: true },
    }),
  ]);

  const replacement: ReplacementView | null =
    settings.replacementUri && settings.replacementLabel && settings.replacementKind
      ? {
          uri: settings.replacementUri,
          label: settings.replacementLabel,
          art: settings.replacementArt,
          kind: settings.replacementKind,
        }
      : null;

  const blockedNow = poll.nowPlayingKind === "episode" || poll.nowPlayingKind === "audiobook";
  const warnings: StatusWarning[] = [];
  if (connection === "broken") warnings.push({ text: "Reconnect Spotify. The blocker is off until you do." });
  if (connection === "quota_paused") {
    warnings.push({ text: "Spotify quota is exceeded. Checks resume", resumesAt: poll.pausedUntil?.toISOString() });
  }
  if (poll.consecutiveFailures >= FAILURE_WARN_AT) {
    warnings.push({ text: "The last 10 checks failed. Spotify may be unreachable from this server." });
  }
  if (!worker.online) {
    warnings.push({ text: "The worker is not running, so automatic checks are paused. Check now still works." });
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
    recent: recent.map((row) => ({ at: row.at.toISOString(), showName: row.showName, episodeName: row.episodeName })),
    replacement,
    worker,
    warnings,
    redirectUri: redirectUri(),
    email: user.email,
    isAdmin: user.isAdmin,
  };
}

function connectionState(
  status: ConnectionStatus | undefined,
  hasRefresh: boolean,
  hasRow: boolean,
  quotaPaused: boolean,
): ConnectionState {
  if (!hasRow || !status || status === "disconnected") return "disconnected";
  if (status === "broken") return "broken";
  if (!hasRefresh) return "needs_connect";
  return quotaPaused ? "quota_paused" : "connected";
}
