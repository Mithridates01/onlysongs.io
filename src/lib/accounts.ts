import type { SpotifyConnection } from "@prisma/client";
import {
  callWithAuthRetry,
  tokenNeedsRefresh,
  type RefreshResult,
  type TokenState,
} from "./blocker-logic";
import { decryptString, encryptString } from "./crypto";
import { prisma } from "./db";
import { enqueueNotify, removeSchedule, withRefreshLock } from "./jobs";
import { log } from "./log";
import { refreshTokens } from "./spotify";

export function connectionTokens(connection: SpotifyConnection): TokenState {
  return {
    accessToken: connection.accessTokenEnc ? decryptString(connection.accessTokenEnc) : "",
    refreshToken: connection.refreshTokenEnc ? decryptString(connection.refreshTokenEnc) : "",
    expiresAt: connection.expiresAt,
  };
}

export async function persistTokens(
  userId: string,
  tokens: { accessToken: string; refreshToken: string; expiresAt: Date | null },
): Promise<void> {
  await prisma.spotifyConnection.update({
    where: { userId },
    data: {
      accessTokenEnc: encryptString(tokens.accessToken),
      refreshTokenEnc: encryptString(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
      status: "connected",
    },
  });
}

export async function markConnectionBroken(userId: string, email: string): Promise<void> {
  await prisma.$transaction([
    prisma.spotifyConnection.update({
      where: { userId },
      data: { status: "broken", accessTokenEnc: null, expiresAt: null },
    }),
    prisma.blockerSettings.update({
      where: { userId },
      data: { enabled: false },
    }),
  ]);
  try {
    await removeSchedule(userId);
  } catch (error) {
    log.error("could not remove schedule after broken connection", {
      message: error instanceof Error ? error.message : "unknown",
    });
  }
  await prisma.activityLog.create({
    data: {
      userId,
      action: "error",
      result: "broken",
      showName: null,
      episodeName: null,
      deviceName: null,
    },
  });
  await enqueueNotify(email, "broken");
}

// A refresh is never cut short by a check's deadline: Spotify may finish it and
// rotate the refresh token after we stop waiting, and the new token would be lost.
const REFRESH_TIMEOUT_MS = 25_000;

// Refreshes one user's tokens at most once at a time across web and worker.
// Under the lock it re-reads the row: if another process already refreshed,
// it reuses that token, and it always presents the newest refresh token, so a
// rotated token is never sent twice.
function singleFlightRefresh(userId: string, seen: TokenState) {
  let used = seen.accessToken;

  const refreshNow = async (): Promise<RefreshResult> => {
    const current = await prisma.spotifyConnection.findUnique({ where: { userId } });
    if (!current?.refreshTokenEnc || current.status === "broken" || current.status === "disconnected") {
      return { ok: false, error: "Spotify is not connected.", invalidGrant: false };
    }
    const tokens = connectionTokens(current);
    const now = new Date();
    if (tokens.accessToken && tokens.accessToken !== used && current.expiresAt && !tokenNeedsRefresh(current.expiresAt, now)) {
      return {
        ok: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: Math.floor((current.expiresAt.getTime() - now.getTime()) / 1000),
      };
    }
    const result = await refreshTokens({
      clientId: current.clientId,
      clientSecret: decryptString(current.clientSecretEnc),
      refreshToken: tokens.refreshToken,
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (!result.ok) return { ok: false, error: result.error, invalidGrant: result.invalidGrant };
    const refreshToken = result.refreshToken || tokens.refreshToken;
    await persistTokens(userId, {
      accessToken: result.accessToken,
      refreshToken,
      expiresAt: new Date(now.getTime() + result.expiresIn * 1000),
    });
    return { ok: true, accessToken: result.accessToken, refreshToken, expiresIn: result.expiresIn };
  };

  return async (): Promise<RefreshResult> => {
    let result: RefreshResult;
    try {
      const locked = await withRefreshLock(userId, refreshNow);
      if ("busy" in locked) return { ok: false, error: "Another token refresh is still running.", invalidGrant: false };
      result = locked;
    } catch (error) {
      // Redis is down. Refreshing without the lock beats failing every Spotify call.
      log.error("refresh lock unavailable", { message: error instanceof Error ? error.message : "unknown" });
      result = await refreshNow();
    }
    if (result.ok) used = result.accessToken;
    return result;
  };
}

// Calls Spotify with a fresh token, refreshing once on expiry or a 401.
// It changes no state besides the stored tokens; `broken: true` tells the
// caller that Spotify revoked access, and the caller decides what to do.
export async function authorizedCall<T extends { status: number }>(
  connection: SpotifyConnection,
  call: (accessToken: string) => Promise<T>,
): Promise<
  | { ok: true; result: T; accessToken: string }
  | { ok: false; broken: boolean; error: string; status?: number }
> {
  if (!connection.refreshTokenEnc) {
    return { ok: false, broken: true, error: "Spotify is not connected." };
  }
  const state = connectionTokens(connection);
  const outcome = await callWithAuthRetry({
    state,
    now: new Date(),
    refresh: singleFlightRefresh(connection.userId, state),
    call,
  });
  if (!outcome.ok) {
    return { ok: false, broken: outcome.broken, error: outcome.error, status: outcome.result?.status };
  }
  return { ok: true, result: outcome.result, accessToken: outcome.accessToken };
}
