import { encryptString, last4 } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { json, requestIp, requireUser } from "@/lib/http";
import { tryUnschedule } from "@/lib/jobs";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);

  const limit = rateLimit(`creds:${requestIp(request)}:${user.id}`, 10, 15 * 60 * 1000);
  if (!limit.ok) return json({ error: "Too many credential updates. Wait a few minutes." }, 429);

  let body: { clientId?: unknown; clientSecret?: unknown } | null = null;
  try {
    body = (await request.json()) as { clientId?: unknown; clientSecret?: unknown };
  } catch {
    body = null;
  }
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  const clientSecret = typeof body?.clientSecret === "string" ? body.clientSecret.trim() : "";
  if (clientId.length < 8 || clientId.length > 80 || clientSecret.length < 8 || clientSecret.length > 200) {
    return json({ error: "Paste the Client ID and Client Secret from the Spotify dashboard." }, 400);
  }

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
