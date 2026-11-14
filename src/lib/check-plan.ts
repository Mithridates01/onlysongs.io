// The pure half of a playback check: given what was read from the database and
// from Spotify, decide what to do and what to write. blocker-run.ts does the I/O.
import type { ActivityAction, ActivityResult, PauseReason, ReplacementKind } from "@prisma/client";
import {
  COOLDOWN_MS,
  classifyPlayback,
  describeNowPlaying,
  isAllowListed,
  retryPauseMs,
  type BlockTarget,
  type PlaybackResult,
  type Replacement,
} from "./blocker-logic";
import { isQuietNow, parseQuietHours } from "./quiet-hours";

export type CheckOutcome =
  | "busy"
  | "missing"
  | "disabled"
  | "off"
  | "paused"
  | "cooldown"
  | "quiet_hours"
  | "not_connected"
  | "broken"
  | "no_replacement"
  | "error"
  | "idle"
  | "music"
  | "ignored_podcast"
  | "ignored_audiobook"
  | "allow_listed"
  | "rate_limited"
  | "quota"
  | Extract<ActivityResult, "replaced" | "replaced_via_next" | "no_device" | "restricted" | "failed">;

export type CheckSummary = { outcome: CheckOutcome; detail?: string };

// What to write to poll_state. failures replaces Prisma's increment operator so
// this stays plain data.
export type PollPatch = {
  lastCheckedAt?: Date;
  pausedUntil?: Date | null;
  pauseReason?: PauseReason | null;
  cooldownUntil?: Date;
  lastError?: string | null;
  quotaNotifiedAt?: Date;
  nowPlayingKind?: string;
  nowPlayingTitle?: string | null;
  nowPlayingSubtitle?: string | null;
  nowPlayingArt?: string | null;
  failures?: "reset" | "increment";
};

export type ActivityEntry = {
  action: ActivityAction;
  result: ActivityResult;
  httpStatus?: number;
  showName?: string;
  episodeName?: string;
  deviceName?: string;
};

// Everything a finished check leaves behind.
export type CheckResult = {
  summary: CheckSummary;
  poll?: PollPatch;
  activity?: ActivityEntry;
  markBroken?: boolean;
  notifyQuota?: boolean;
};

export type CheckState = {
  settings: {
    enabled: boolean;
    quietHours: unknown;
    timeZone: string;
    replacementUri: string | null;
    replacementKind: ReplacementKind | null;
    replacementLabel: string | null;
    replacementArt: string | null;
    blockPodcasts: boolean;
    blockAudiobooks: boolean;
    allowedShowIds: string[];
  };
  poll: { pausedUntil: Date | null; cooldownUntil: Date | null; quotaNotifiedAt: Date | null };
  connection: { status: string; hasRefreshToken: boolean } | null;
};

// Gates that need no Spotify call. Returns the replacement when the check should go on,
// or "observe" when a manual check should only read the player because the blocker is off.
export function preflight(
  state: CheckState,
  now: Date,
  opts?: { ignoreCooldown?: boolean; observeWhenOff?: boolean },
): { kind: "stop"; result: CheckResult } | { kind: "go"; replacement: Replacement } | { kind: "observe" } {
  const { settings, poll, connection } = state;
  const stop = (summary: CheckSummary, patch?: PollPatch) => ({ kind: "stop" as const, result: { summary, poll: patch } });
  if (!settings.enabled && !opts?.observeWhenOff) return stop({ outcome: "disabled" });
  if (poll.pausedUntil && poll.pausedUntil > now) {
    return stop({ outcome: "paused", detail: `Paused until ${poll.pausedUntil.toISOString()}` });
  }
  if (settings.enabled) {
    if (!opts?.ignoreCooldown && poll.cooldownUntil && poll.cooldownUntil > now) return stop({ outcome: "cooldown" });
    if (isQuietNow(parseQuietHours(settings.quietHours), settings.timeZone, now)) {
      return stop({ outcome: "quiet_hours" }, { lastCheckedAt: now, lastError: null });
    }
  }
  if (!connection || connection.status === "disconnected" || !connection.hasRefreshToken) {
    return stop({ outcome: "not_connected" });
  }
  if (connection.status === "broken") return stop({ outcome: "broken" });
  if (!settings.enabled) return { kind: "observe" };
  if (!settings.replacementUri || !settings.replacementKind) return stop({ outcome: "no_replacement" });
  return { kind: "go", replacement: { uri: settings.replacementUri, kind: settings.replacementKind } };
}

export type PlayerObservation =
  | { kind: "broken"; error: string }
  | { kind: "error"; error: string }
  | { kind: "player"; playback: PlaybackResult };

export type SwapPlan = { kind: "swap"; target: BlockTarget; seen: PollPatch };

// Decides from the player read: leave it, pause, record a failure, or swap.
export function decide(observed: PlayerObservation, state: CheckState, now: Date): CheckResult | SwapPlan {
  if (observed.kind === "broken") {
    return { summary: { outcome: "broken", detail: observed.error }, markBroken: true };
  }
  if (observed.kind === "error") {
    return failure(observed.error || "Spotify request failed", now, observed.error);
  }
  const playback = observed.playback;
  if (!playback.ok && playback.status === 429) {
    return pause(state, now, playback.retryAfterSec, playback.reason === "QUOTA_EXCEEDED", {});
  }
  if (!playback.ok) {
    return failure(`Spotify player returned ${playback.status || "a network error"}`, now, `Player status ${playback.status}`);
  }

  const decision = classifyPlayback(playback, {
    blockPodcasts: state.settings.blockPodcasts,
    blockAudiobooks: state.settings.blockAudiobooks,
  });
  const playing = describeNowPlaying(playback, decision.kind === "block");
  const seen: PollPatch = {
    lastCheckedAt: now,
    pausedUntil: null,
    pauseReason: null,
    nowPlayingKind: playing.kind,
    nowPlayingTitle: playing.title,
    nowPlayingSubtitle: playing.subtitle,
    nowPlayingArt: playing.art,
  };
  const healthy: PollPatch = { ...seen, failures: "reset", lastError: null };

  if (decision.kind === "ignored") {
    return { summary: { outcome: decision.content === "audiobook" ? "ignored_audiobook" : "ignored_podcast" }, poll: healthy };
  }
  if (decision.kind !== "block") return { summary: { outcome: decision.kind }, poll: healthy };

  const { target } = decision;
  if (isAllowListed(target.showId, state.settings.allowedShowIds)) {
    return {
      summary: { outcome: "allow_listed", detail: target.showName },
      poll: healthy,
      activity: { ...where(target), action: "skip", result: "allow_listed" },
    };
  }
  return { kind: "swap", target, seen };
}

// With the blocker off, a check records what is playing and changes nothing else.
export function observeOnly(plan: CheckResult | SwapPlan): CheckResult {
  if (!("kind" in plan)) return { ...plan, activity: undefined };
  return {
    summary: { outcome: "off", detail: plan.target.episodeName ?? plan.target.showName },
    poll: { ...plan.seen, failures: "reset", lastError: null },
  };
}

export type SwapOutcome =
  | {
      kind: "done";
      action: Extract<ActivityAction, "swap" | "fallback_next">;
      result: Extract<ActivityResult, "replaced" | "replaced_via_next" | "no_device" | "restricted" | "failed">;
      httpStatus: number;
      replaced: boolean;
      failed: boolean;
      detail?: string;
    }
  | { kind: "rate_limited"; retryAfterSec?: number; quotaExceeded: boolean }
  | { kind: "broken"; detail: string };

// Turns the result of the play (or skip-next) call into what to record.
export function settleSwap(plan: SwapPlan, swap: SwapOutcome, state: CheckState, now: Date): CheckResult {
  if (swap.kind === "rate_limited") return pause(state, now, swap.retryAfterSec, swap.quotaExceeded, plan.seen);
  if (swap.kind === "broken") {
    return { summary: { outcome: "broken", detail: swap.detail }, poll: plan.seen, markBroken: true };
  }
  const { settings } = state;
  const direct = swap.result === "replaced";
  const poll: PollPatch = {
    ...plan.seen,
    lastError: swap.replaced ? null : (swap.detail ?? null),
    ...(swap.replaced ? { cooldownUntil: new Date(now.getTime() + COOLDOWN_MS), failures: "reset" as const } : {}),
    ...(!swap.replaced && swap.failed ? { failures: "increment" as const } : {}),
    ...(swap.replaced
      ? {
          nowPlayingKind: settings.replacementKind ?? "track",
          nowPlayingTitle: direct ? settings.replacementLabel : "Skipped ahead",
          nowPlayingSubtitle: direct ? "Replacement" : (plan.target.showName ?? null),
          nowPlayingArt: direct ? settings.replacementArt : null,
        }
      : {}),
  };
  return {
    summary: { outcome: swap.result, detail: plan.target.episodeName ?? plan.target.showName },
    poll,
    activity: { ...where(plan.target), action: swap.action, result: swap.result, httpStatus: swap.httpStatus },
  };
}

function failure(lastError: string, now: Date, detail?: string): CheckResult {
  return {
    summary: { outcome: "error", detail },
    poll: { failures: "increment", lastCheckedAt: now, lastError: lastError.slice(0, 240) },
  };
}

function pause(
  state: CheckState,
  now: Date,
  retryAfterSec: number | undefined,
  quotaExceeded: boolean,
  base: PollPatch,
): CheckResult {
  const until = new Date(now.getTime() + retryPauseMs(retryAfterSec, quotaExceeded));
  const lastNotice = state.poll.quotaNotifiedAt;
  const notifyQuota = quotaExceeded && (!lastNotice || now.getTime() - lastNotice.getTime() > 60 * 60 * 1000);
  return {
    summary: { outcome: quotaExceeded ? "quota" : "rate_limited", detail: `Paused until ${until.toISOString()}` },
    poll: {
      ...base,
      pausedUntil: until,
      pauseReason: quotaExceeded ? "quota" : "rate_limited",
      lastCheckedAt: now,
      lastError: quotaExceeded ? "Spotify quota exceeded" : "Spotify rate limit",
      ...(notifyQuota ? { quotaNotifiedAt: now } : {}),
    },
    activity: { action: "error", result: quotaExceeded ? "quota" : "rate_limited", httpStatus: 429 },
    notifyQuota,
  };
}

function where(target: BlockTarget): Pick<ActivityEntry, "showName" | "episodeName" | "deviceName"> {
  return { showName: target.showName, episodeName: target.episodeName, deviceName: target.deviceName };
}
