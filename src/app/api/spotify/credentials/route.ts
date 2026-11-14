import { encryptString, last4 } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { json, parseJson, requestIp, requireUser } from "@/lib/http";
import { tryUnschedule } from "@/lib/jobs";
import { MINUTE, rateLimit } from "@/lib/rate-limit";
import { spotifyCredentials } from "@/lib/schemas";

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);

  const limit = await rateLimit({ key: `creds:${user.id}:${requestIp(request)}`, limit: 10, windowMs: 15 * MINUTE });
  if (!limit.ok) return json({ error: "Too many credential updates. Wait a few minutes." }, 429);

  const body = await parseJson(request, spotifyCredentials, "Paste the Client ID and Client Secret from the Spotify dashboard.");
  if (!body.ok) return body.response;
  const { clientId, clientSecret } = body.data;

  const clientSecretEnc = encryptString(clientSecret);
  const existing = await prisma.spotifyConnection.findUnique({ where: { userId: user.id } });
  if (!existing) {
    await prisma.spotifyConnection.create({
      data: { userId: user.id, clientId, clientSecretEnc, status: "pending" },
    });
  } else {
    await prisma.spotifyConnection.update({
      where: { userId: user.id },
      data: {
        clientId,
        clientSecretEnc,
        accessTokenEnc: null,
        refreshTokenEnc: null,
        expiresAt: null,
        spotifyUserId: null,
        status: "pending",
        codeVerifierEnc: null,
        oauthState: null,
        oauthStateExpiresAt: null,
      },
    });
    await prisma.blockerSettings.update({ where: { userId: user.id }, data: { enabled: false } });
    await tryUnschedule(user.id);
  }

  return json({ ok: true, clientIdLast4: last4(clientId) });
}
