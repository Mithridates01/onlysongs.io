import type { PollState, Prisma, SpotifyConnection } from "@prisma/client";
import { authorizedCall, markConnectionBroken } from "./accounts";
import {
  COOLDOWN_MS,
  FAILURE_WARN_AT,
  classifyPlayback,
  describeNowPlaying,
  isAllowListed,
  playBodyFor,
  playOutcome,
  retryPauseMs,
  type PlaybackResult,
  type PlayerBody,
  type Replacement,
} from "./blocker-logic";
import { prisma } from "./db";
import { enqueueNotify, withUserLock } from "./jobs";
import { log } from "./log";
import { isQuietNow, parseQuietHours } from "./quiet-hours";
import { readAllowedShows } from "./shows";
import { getPlayback, playOnDevice, skipNext } from "./spotify";

export type CheckSummary = {
  outcome: string;
  detail?: string;
};

const CHECK_TIMEOUT_MS = 10_000;

export async function runUserCheck(userId: string, opts?: { ignoreCooldown?: boolean }): Promise<CheckSummary> {
  const locked = await withUserLock(userId, () => runUnlocked(userId, opts));
  if ("busy" in locked) return { outcome: "busy", detail: "A check is already running." };
  return locked;
}

async function runUnlocked(userId: string, opts?: { ignoreCooldown?: boolean }): Promise<CheckSummary> {
  // Starts with the lock, so player calls end before the lock's TTL can lapse.
  // Token refresh keeps its own longer timeout (accounts.ts).
  const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
  const bundle = await prisma.user.findUnique({
    where: { id: userId },
    include: { spotify: true, settings: true, poll: true },
  });
  if (!bundle?.settings || !bundle.poll) return { outcome: "missing" };
  const { settings, poll } = bundle;
  const spotify = bundle.spotify;
  const now = new Date();

  if (!settings.enabled) return { outcome: "disabled" };

  if (poll.pausedUntil && poll.pausedUntil > now) {
    return { outcome: "paused", detail: `Paused until ${poll.pausedUntil.toISOString()}` };
  }

  if (!opts?.ignoreCooldown && poll.cooldownUntil && poll.cooldownUntil > now) {
    return { outcome: "cooldown" };
  }

  const quiet = parseQuietHours(settings.quietHours);
  if (isQuietNow(quiet, settings.timeZone, now)) {
    await touch(userId, { lastCheckedAt: now, lastError: null });
    return { outcome: "quiet_hours" };
  }

  if (!spotify || spotify.status === "disconnected" || !spotify.refreshTokenEnc) {
    return { outcome: "not_connected" };
  }
  if (spotify.status === "broken") return { outcome: "broken" };

  if (!settings.replacementUri || !isReplacementKind(settings.replacementKind)) {
    return { outcome: "no_replacement" };
  }

  const replacement: Replacement = {
    uri: settings.replacementUri,
    kind: settings.replacementKind,
  };

  const playbackCall = await authorizedCall(spotify, (token) => getPlayback(token, signal));
  if (!playbackCall.ok) {
    if (playbackCall.broken) {
      await markConnectionBroken(userId, bundle.email);
      return { outcome: "broken", detail: playbackCall.error };
    }
    await noteFailure(userId, playbackCall.error || "Spotify request failed");
    return { outcome: "error", detail: playbackCall.error };
  }

  const playback = toPlaybackResult(playbackCall.result);
  if (!playback.ok && playback.status === 429) {
    return pauseForRateLimit(bundle.email, userId, playback.retryAfterSec, playback.reason === "QUOTA_EXCEEDED", poll, {});
  }
  if (!playback.ok) {
    await noteFailure(userId, `Spotify player returned ${playback.status || "a network error"}`);
    return { outcome: "error", detail: `Player status ${playback.status}` };
  }

  const decision = classifyPlayback(playback, {
    blockPodcasts: settings.blockPodcasts,
    blockAudiobooks: settings.blockAudiobooks,
  });
  const playing = describeNowPlaying(playback, decision.kind === "block");
  // Built up through the rest of the check and written once.
  const seen: Prisma.PollStateUpdateInput = {
    lastCheckedAt: now,
    pausedUntil: null,
    nowPlayingKind: playing.kind,
    nowPlayingTitle: playing.title,
    nowPlayingSubtitle: playing.subtitle,
    nowPlayingArt: playing.art,
  };
  const healthy: Prisma.PollStateUpdateInput = { ...seen, consecutiveFailures: 0, lastError: null };
  if (spotify.status === "quota_paused") {
    await prisma.spotifyConnection.update({ where: { userId }, data: { status: "connected" } });
  }

  if (decision.kind === "ignored") {
    await writePoll(userId, healthy);
    return { outcome: decision.content === "audiobook" ? "ignored_audiobook" : "ignored_podcast" };
  }

  if (decision.kind !== "block") {
    await writePoll(userId, healthy);
    return { outcome: decision.kind };
  }

  const allowed = readAllowedShows(settings.allowedShowIds).map((show) => show.id);
  if (isAllowListed(decision.target.showId, allowed)) {
    await logActivity({
      userId,
      showName: decision.target.showName,
      episodeName: decision.target.episodeName,
      deviceName: decision.target.deviceName,
      action: "skip",
      result: "allow_listed",
    });
    await writePoll(userId, healthy);
    return { outcome: "allow_listed", detail: decision.target.showName };
  }

  const fresh = await prisma.spotifyConnection.findUnique({ where: { userId } });
  if (!fresh?.refreshTokenEnc) {
    await writePoll(userId, seen);
    return { outcome: "broken" };
  }

  const play = await swapToReplacement(fresh, replacement, decision.target.deviceId, signal);
  if (play.kind === "rate_limited") {
    return pauseForRateLimit(bundle.email, userId, play.retryAfterSec, play.quotaExceeded, poll, seen);
  }
  if (play.kind === "broken") {
    await writePoll(userId, seen);
    await markConnectionBroken(userId, bundle.email);
    return { outcome: "broken", detail: play.detail };
  }

  await writePoll(userId, {
    ...seen,
    cooldownUntil: play.replaced ? new Date(now.getTime() + COOLDOWN_MS) : undefined,
    consecutiveFailures: play.replaced ? 0 : play.failed ? { increment: 1 } : undefined,
    lastError: play.replaced ? null : play.detail ?? null,
    ...(play.replaced
      ? {
          nowPlayingKind: replacement.kind,
          nowPlayingTitle: play.result === "replaced" ? settings.replacementLabel : "Skipped ahead",
          nowPlayingSubtitle: play.result === "replaced" ? "Replacement" : (decision.target.showName ?? null),
          nowPlayingArt: play.result === "replaced" ? settings.replacementArt : null,
        }
      : {}),
  });

  await logActivity({
    userId,
    showName: decision.target.showName,
    episodeName: decision.target.episodeName,
    deviceName: decision.target.deviceName,
    action: play.action,
    result: play.result,
    httpStatus: play.httpStatus,
  });

  return { outcome: play.result, detail: decision.target.episodeName ?? decision.target.showName };
}

function isReplacementKind(kind: string | null): kind is Replacement["kind"] {
  return kind === "track" || kind === "playlist" || kind === "album";
}

function toPlaybackResult(result: { status: number; body: unknown; retryAfterSec?: number; quotaExceeded: boolean }): PlaybackResult {
  if (result.status === 204) return { ok: true, status: 204 };
  if (result.status === 200 && result.body && typeof result.body === "object") {
    return { ok: true, status: 200, body: result.body as PlayerBody };
  }
  if (result.status === 200) return { ok: true, status: 204 };
  return {
    ok: false,
    status: result.status,
    retryAfterSec: result.retryAfterSec,
    reason: result.quotaExceeded ? "QUOTA_EXCEEDED" : undefined,
  };
}

async function swapToReplacement(
  connection: SpotifyConnection,
  replacement: Replacement,
  deviceId: string | undefined,
  signal: AbortSignal,
): Promise<
  | { kind: "done"; action: string; result: string; httpStatus: number; replaced: boolean; failed: boolean; detail?: string }
  | { kind: "rate_limited"; retryAfterSec?: number; quotaExceeded: boolean }
  | { kind: "broken"; detail: string }
> {
  const body = playBodyFor(replacement);
  const played = await authorizedCall(connection, (token) => playOnDevice({ token, deviceId, body, signal }));
  if (!played.ok) {
    if (played.broken) return { kind: "broken", detail: played.error };
    return {
      kind: "done",
      action: "swap",
      result: "failed",
      httpStatus: played.status ?? 0,
      replaced: false,
      failed: true,
      detail: played.error,
    };
  }

  const first = played.result;
  if (first.status === 429) {
    return { kind: "rate_limited", retryAfterSec: first.retryAfterSec, quotaExceeded: first.quotaExceeded };
  }

  const outcome = playOutcome(first.status);
  if (outcome === "ok") {
    return { kind: "done", action: "swap", result: "replaced", httpStatus: first.status, replaced: true, failed: false };
  }

  if (outcome !== "fallback_next") {
    return {
      kind: "done",
      action: "swap",
      result: "failed",
      httpStatus: first.status,
      replaced: false,
      failed: true,
      detail: `Play returned ${first.status || "a network error"}`,
    };
  }

  const current = await prisma.spotifyConnection.findUnique({ where: { userId: connection.userId } });
  if (!current) return { kind: "broken", detail: "Connection disappeared." };

  const skipped = await authorizedCall(current, (token) => skipNext({ token, deviceId, signal }));
  if (!skipped.ok) {
    if (skipped.broken) return { kind: "broken", detail: skipped.error };
    return {
      kind: "done",
      action: "fallback_next",
      result: first.status === 404 ? "no_device" : "restricted",
      httpStatus: skipped.status ?? first.status,
      replaced: false,
      failed: true,
      detail: skipped.error,
    };
  }
  if (skipped.result.status === 429) {
    return {
      kind: "rate_limited",
      retryAfterSec: skipped.result.retryAfterSec,
      quotaExceeded: skipped.result.quotaExceeded,
    };
  }
  const nextOutcome = playOutcome(skipped.result.status);
  if (nextOutcome === "ok") {
    return {
      kind: "done",
      action: "fallback_next",
      result: "replaced_via_next",
      httpStatus: skipped.result.status,
      replaced: true,
      failed: false,
    };
  }
  return {
    kind: "done",
    action: "fallback_next",
    result: first.status === 404 ? "no_device" : "restricted",
    httpStatus: skipped.result.status || first.status,
    replaced: false,
    failed: false,
    detail: `Play ${first.status}, next ${skipped.result.status}`,
  };
}

async function pauseForRateLimit(
  email: string,
  userId: string,
  retryAfterSec: number | undefined,
  quotaExceeded: boolean,
  poll: PollState,
  seen: Prisma.PollStateUpdateInput,
): Promise<CheckSummary> {
  const until = new Date(Date.now() + retryPauseMs(retryAfterSec, quotaExceeded));
  const notify =
    quotaExceeded && (!poll.quotaNotifiedAt || Date.now() - poll.quotaNotifiedAt.getTime() > 60 * 60 * 1000);
  await writePoll(userId, {
    ...seen,
    pausedUntil: until,
    lastCheckedAt: new Date(),
    lastError: quotaExceeded ? "Spotify quota exceeded" : "Spotify rate limit",
    ...(notify ? { quotaNotifiedAt: new Date() } : {}),
  });
  if (quotaExceeded) {
    await prisma.spotifyConnection.update({ where: { userId }, data: { status: "quota_paused" } });
  }
  if (notify) await enqueueNotify(email, "quota");
  await logActivity({
    userId,
    action: "error",
    result: quotaExceeded ? "quota" : "rate_limited",
    httpStatus: 429,
  });
  return {
    outcome: quotaExceeded ? "quota" : "rate_limited",
    detail: `Paused until ${until.toISOString()}`,
  };
}

async function noteFailure(userId: string, message: string): Promise<void> {
  const updated = await prisma.pollState.update({
    where: { userId },
    data: {
      consecutiveFailures: { increment: 1 },
      lastCheckedAt: new Date(),
      lastError: message.slice(0, 240),
    },
  });
  if (updated.consecutiveFailures === FAILURE_WARN_AT) {
    log.info("blocker hit repeated failures", { userId, failures: updated.consecutiveFailures });
  }
}

async function writePoll(userId: string, data: Prisma.PollStateUpdateInput): Promise<void> {
  await prisma.pollState.update({ where: { userId }, data });
}

async function touch(userId: string, data: { lastCheckedAt: Date; lastError: string | null }): Promise<void> {
  await prisma.pollState.update({ where: { userId }, data });
}

async function logActivity(entry: {
  userId: string;
  showName?: string;
  episodeName?: string;
  deviceName?: string;
  action: string;
  result: string;
  httpStatus?: number;
}): Promise<void> {
  await prisma.activityLog.create({
    data: {
      userId: entry.userId,
      showName: entry.showName ?? null,
      episodeName: entry.episodeName ?? null,
      deviceName: entry.deviceName ?? null,
      action: entry.action,
      result: entry.result,
      httpStatus: entry.httpStatus ?? null,
    },
  });
}

