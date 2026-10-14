import type { SpotifyConnection } from "@prisma/client";
import {
  callWithAuthRetry,
  type RefreshResult,
  type TokenState,
} from "./blocker-logic";
import { decryptString, encryptString } from "./crypto";
import { prisma } from "./db";
import { removeSchedule } from "./jobs";
import { log } from "./log";
import { notifyUser } from "./mail";
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
  if (!email) return;
  try {
    await notifyUser(email, "broken");
  } catch (error) {
    log.error("breakage email failed", { message: error instanceof Error ? error.message : "unknown" });
  }
}

export function refreshWithCredentials(connection: SpotifyConnection) {
  return async (refreshToken: string): Promise<RefreshResult> => {
    const clientSecret = decryptString(connection.clientSecretEnc);
    const result = await refreshTokens({
      clientId: connection.clientId,
      clientSecret,
      refreshToken,
    });
    if (!result.ok) {
      return { ok: false, error: result.error, invalidGrant: result.invalidGrant };
    }
    return {
      ok: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken || refreshToken,
      expiresIn: result.expiresIn,
    };
  };
}

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
  const outcome = await callWithAuthRetry({
    state: connectionTokens(connection),
    now: new Date(),
    refresh: refreshWithCredentials(connection),
    call,
  });
  if (!outcome.ok) {
    if (outcome.broken) await markConnectionBroken(connection.userId, await emailFor(connection.userId));
    return { ok: false, broken: outcome.broken, error: outcome.error, status: outcome.result?.status };
  }
  if (outcome.refreshed && outcome.expiresAt) {
    await persistTokens(connection.userId, {
      accessToken: outcome.accessToken,
      refreshToken: outcome.refreshToken,
      expiresAt: outcome.expiresAt,
    });
  }
  return { ok: true, result: outcome.result, accessToken: outcome.accessToken };
}

async function emailFor(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? "";
}
