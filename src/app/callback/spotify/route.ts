import { NextResponse } from "next/server";
import { safeEqual, decryptString, encryptString } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { appUrl, redirectUri } from "@/lib/env";
import { currentSession } from "@/lib/http";
import { log } from "@/lib/log";
import { exchangeCode, getMe } from "@/lib/spotify";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const session = await currentSession();
  if (!session) return NextResponse.redirect(new URL("/login", appUrl()));
  const userId = session.sub;
  if (oauthError) return back(userId, oauthError === "access_denied" ? "access_denied" : "token", oauthError);
  if (!code || !state) return back(userId, "missing_code");

  const connection = await prisma.spotifyConnection.findUnique({ where: { userId: session.sub } });
  if (!connection?.oauthState || !connection.codeVerifierEnc || !connection.oauthStateExpiresAt) return back(userId, "state", "no sign-in in progress");
  if (connection.oauthStateExpiresAt < new Date()) return back(userId, "state", "sign-in took longer than 10 minutes");
  if (!safeEqual(connection.oauthState, state)) return back(userId, "state", "state mismatch");

  const verifier = decryptString(connection.codeVerifierEnc);
  const clientSecret = decryptString(connection.clientSecretEnc);
  await prisma.spotifyConnection.update({
    where: { userId: session.sub },
    data: { oauthState: null, oauthStateExpiresAt: null, codeVerifierEnc: null },
  });

  const tokens = await exchangeCode({
    clientId: connection.clientId,
    clientSecret,
    code,
    redirectUri: redirectUri(),
    codeVerifier: verifier,
  });
  if (!tokens.ok || !tokens.refreshToken) {
    const reason = tokens.ok ? "token" : tokens.invalidGrant ? "invalid_grant" : "token";
    return back(userId, reason, tokens.ok ? "no refresh token returned" : tokens.error);
  }

  const me = await getMe(tokens.accessToken);
  const spotifyUserId =
    me.status === 200 && me.body && typeof me.body === "object" && typeof (me.body as { id?: unknown }).id === "string"
      ? (me.body as { id: string }).id
      : null;

  await prisma.spotifyConnection.update({
    where: { userId: session.sub },
    data: {
      accessTokenEnc: encryptString(tokens.accessToken),
      refreshTokenEnc: encryptString(tokens.refreshToken),
      expiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      spotifyUserId,
      status: "connected",
    },
  });

  log.info("spotify connected", { userId, spotifyUser: Boolean(spotifyUserId) });
  return NextResponse.redirect(new URL("/dashboard", appUrl()));
}

// Sends the user back to setup with a reason, and logs why for the operator.
function back(userId: string, error: string, detail?: string) {
  log.info("spotify sign-in failed", { userId, reason: error, detail: detail?.slice(0, 200) });
  return NextResponse.redirect(new URL(`/onboarding?error=${encodeURIComponent(error)}`, appUrl()));
}
