import { NextResponse } from "next/server";
import { encryptString } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { redirectUri } from "@/lib/env";
import { json, requireUser } from "@/lib/http";
import { codeChallenge, createOauthState, createVerifier } from "@/lib/pkce";
import { PLAYBACK_SCOPES } from "@/lib/spotify";

export async function GET() {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);

  const connection = await prisma.spotifyConnection.findUnique({ where: { userId: user.id } });
  if (!connection) return json({ error: "Save your Spotify Client ID and Client Secret first." }, 400);

  const verifier = createVerifier();
  const state = createOauthState();
  await prisma.spotifyConnection.update({
    where: { userId: user.id },
    data: {
      codeVerifierEnc: encryptString(verifier),
      oauthState: state,
      oauthStateExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", connection.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", PLAYBACK_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", codeChallenge(verifier));
  return NextResponse.redirect(url);
}
