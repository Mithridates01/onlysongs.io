// The operator's view of one account: its stored state, without secrets, and
// plain-language findings about what is stopping it. diagnose() is pure so the
// findings can be tested without a database.
import type { ConnectionStatus } from "@prisma/client";
import { FAILURE_WARN_AT } from "./blocker-logic";
import { isQuietNow, parseQuietHours } from "./quiet-hours";
import { switchBlockedReason } from "./switch-reason";
import { connectionState } from "./connection-state";

export type AccountSnapshot = {
  emailVerified: boolean;
  spotify: {
    status: ConnectionStatus;
    hasRefreshToken: boolean;
    signInStartedAt: Date | null; // oauthStateExpiresAt minus its 10-minute lifetime
    signInExpiresAt: Date | null;
  } | null;
  settings: {
    enabled: boolean;
    intervalSeconds: number;
    hasSong: boolean;
    quietHours: unknown;
    timeZone: string;
  };
  poll: {
    lastCheckedAt: Date | null;
    consecutiveFailures: number;
    lastError: string | null;
    pausedUntil: Date | null;
    pauseReason: string | null;
  };
  workerOnline: boolean;
};

export type Finding = { level: "problem" | "note"; text: string };

export function diagnose(account: AccountSnapshot, redirectUri: string, now = new Date()): Finding[] {
  const findings: Finding[] = [];
  const { spotify, settings, poll } = account;
  const quotaPaused = poll.pauseReason === "quota" && Boolean(poll.pausedUntil && poll.pausedUntil > now);
  const connection = connectionState(spotify?.status, Boolean(spotify?.hasRefreshToken), Boolean(spotify), quotaPaused);

  if (spotify && connection === "needs_connect") {
    if (spotify.signInExpiresAt && spotify.signInExpiresAt > now) {
      findings.push({ level: "note", text: "Spotify sign-in is in progress right now (started in the last 10 minutes)." });
    } else if (spotify.signInExpiresAt) {
      findings.push({
        level: "problem",
        text: `Spotify sign-in was started but never came back. Usually ${redirectUri} is missing from the Redirect URIs in their Spotify app, the app owner isn't on Spotify Premium, or they cancelled on Spotify's page.`,
      });
    } else {
      findings.push({ level: "problem", text: "Spotify keys are saved, but they never pressed Connect to sign in to Spotify." });
    }
  }
  const reason = switchBlockedReason(connection, settings.hasSong, redirectUri);
  if (reason && connection !== "needs_connect") findings.push({ level: "problem", text: reason });

  if (!account.emailVerified) findings.push({ level: "note", text: "Email address not confirmed yet." });
  if (quotaPaused && poll.pausedUntil) {
    findings.push({ level: "problem", text: `Paused by Spotify's quota until ${poll.pausedUntil.toISOString()}.` });
  }
  if (poll.consecutiveFailures >= FAILURE_WARN_AT) {
    findings.push({ level: "problem", text: `${poll.consecutiveFailures} checks failed in a row. Last error: ${poll.lastError ?? "none recorded"}.` });
  } else if (poll.lastError) {
    findings.push({ level: "note", text: `Last error: ${poll.lastError}` });
  }

  const ready = !reason;
  if (ready && !settings.enabled) findings.push({ level: "note", text: "Everything is set up; the blocker is switched off." });
  if (settings.enabled && ready) {
    if (isQuietNow(parseQuietHours(settings.quietHours), settings.timeZone, now)) {
      findings.push({ level: "note", text: "Quiet hours are on now, so checks are skipped." });
    } else if (!account.workerOnline) {
      findings.push({ level: "problem", text: "The worker is offline, so no checks are running for anyone." });
    } else {
      // Missed checks: well past the interval with no check recorded.
      const staleAfterMs = settings.intervalSeconds * 3 * 1000 + 60_000;
      if (!poll.lastCheckedAt || now.getTime() - poll.lastCheckedAt.getTime() > staleAfterMs) {
        findings.push({ level: "problem", text: "The blocker is on, but no check has run recently. Its schedule may be missing; it is restored within 5 minutes." });
      }
    }
  }
  if (findings.length === 0) findings.push({ level: "note", text: "No problems found." });
  return findings;
}
