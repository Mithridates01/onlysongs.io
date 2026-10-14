import type { SpotifyConnection } from "@prisma/client";
import { authorizedCall, markConnectionBroken } from "./accounts";
import { FAILURE_WARN_AT, playBodyFor, playOutcome, type PlaybackResult, type PlayerBody, type Replacement } from "./blocker-logic";
import {
  decide,
  preflight,
  settleSwap,
  type CheckResult,
  type CheckState,
  type CheckSummary,
  type PlayerObservation,
  type SwapOutcome,
} from "./check-plan";
import { prisma } from "./db";
import { enqueueNotify } from "./jobs";
import { log } from "./log";
import { withUserLock } from "./redis";
import { readAllowedShows } from "./shows";
import { getPlayback, playOnDevice, skipNext } from "./spotify";

export type { CheckOutcome, CheckSummary } from "./check-plan";

const CHECK_TIMEOUT_MS = 10_000;

export async function runUserCheck(userId: string, opts?: { ignoreCooldown?: boolean }): Promise<CheckSummary> {
  const locked = await withUserLock(userId, () => runUnlocked(userId, opts));
  if ("busy" in locked) return { outcome: "busy", detail: "A check is already running." };
  return locked;
}

// gather → preflight → read the player → decide → swap → settle → persist.
// The decisions are pure (check-plan.ts); this function only does I/O.
async function runUnlocked(userId: string, opts?: { ignoreCooldown?: boolean }): Promise<CheckSummary> {
  // Starts with the lock, so player calls end before the lock's TTL can lapse.
  // Token refresh keeps its own longer timeout (accounts.ts).
  const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
  const bundle = await prisma.user.findUnique({
    where: { id: userId },
    include: { spotify: true, settings: true, poll: true },
  });
  if (!bundle?.settings || !bundle.poll) return { outcome: "missing" };
  const now = new Date();
  const state: CheckState = {
    settings: {
      ...bundle.settings,
      allowedShowIds: readAllowedShows(bundle.settings.allowedShowIds).map((show) => show.id),
    },
    poll: bundle.poll,
    connection: bundle.spotify
      ? { status: bundle.spotify.status, hasRefreshToken: Boolean(bundle.spotify.refreshTokenEnc) }
      : null,
  };

  const gate = preflight(state, now, opts);
  if (gate.kind === "stop") return persist(userId, bundle.email, gate.result);

  const observed = await readPlayer(bundle.spotify as SpotifyConnection, signal);
  const plan = decide(observed, state, now);
  if (!("kind" in plan)) return persist(userId, bundle.email, plan);

  const fresh = await prisma.spotifyConnection.findUnique({ where: { userId } });
  if (!fresh?.refreshTokenEnc) {
    return persist(userId, bundle.email, { summary: { outcome: "broken" }, poll: plan.seen });
  }
  const swap = await swapToReplacement(fresh, gate.replacement, plan.target.deviceId, signal);
  return persist(userId, bundle.email, settleSwap(plan, swap, state, now));
}

async function readPlayer(connection: SpotifyConnection, signal: AbortSignal): Promise<PlayerObservation> {
  const call = await authorizedCall(connection, (token) => getPlayback(token, signal));
  if (!call.ok) return call.broken ? { kind: "broken", error: call.error } : { kind: "error", error: call.error };
  return { kind: "player", playback: toPlaybackResult(call.result) };
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
): Promise<SwapOutcome> {
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

  const fallbackResult = first.status === 404 ? "no_device" : "restricted";
  const skipped = await authorizedCall(current, (token) => skipNext({ token, deviceId, signal }));
  if (!skipped.ok) {
    if (skipped.broken) return { kind: "broken", detail: skipped.error };
    return {
      kind: "done",
      action: "fallback_next",
      result: fallbackResult,
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
  if (playOutcome(skipped.result.status) === "ok") {
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
    result: fallbackResult,
    httpStatus: skipped.result.status || first.status,
    replaced: false,
    failed: false,
    detail: `Play ${first.status}, next ${skipped.result.status}`,
  };
}

// The one place a check writes: poll_state once, then the activity row, then
// the broken-connection and quota-email side effects.
async function persist(userId: string, email: string, result: CheckResult): Promise<CheckSummary> {
  if (result.poll) {
    const { failures, ...fields } = result.poll;
    const updated = await prisma.pollState.update({
      where: { userId },
      data: {
        ...fields,
        ...(failures === "reset" ? { consecutiveFailures: 0 } : {}),
        ...(failures === "increment" ? { consecutiveFailures: { increment: 1 } } : {}),
      },
    });
    if (failures === "increment" && updated.consecutiveFailures === FAILURE_WARN_AT) {
      log.info("blocker hit repeated failures", { userId, failures: updated.consecutiveFailures });
    }
  }
  if (result.activity) {
    const { showName, episodeName, deviceName, httpStatus, ...entry } = result.activity;
    await prisma.activityLog.create({
      data: {
        userId,
        ...entry,
        showName: showName ?? null,
        episodeName: episodeName ?? null,
        deviceName: deviceName ?? null,
        httpStatus: httpStatus ?? null,
      },
    });
  }
  if (result.markBroken) await markConnectionBroken(userId, email);
  if (result.notifyQuota) await enqueueNotify(email, "quota");
  return result.summary;
}
