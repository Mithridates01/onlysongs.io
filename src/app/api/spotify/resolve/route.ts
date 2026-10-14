import { authorizedCall } from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { json, requireUser } from "@/lib/http";
import { resolveCatalogItem } from "@/lib/spotify";
import { parseSpotifyUri } from "@/lib/spotify-uri";

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);

  let body: { input?: unknown; purpose?: unknown } | null = null;
  try {
    body = (await request.json()) as { input?: unknown; purpose?: unknown };
  } catch {
    body = null;
  }
  const input = typeof body?.input === "string" ? body.input : "";
  const purpose = body?.purpose === "show" ? "show" : "replacement";
  const parsed = parseSpotifyUri(input);
  if (!parsed) return json({ error: "That is not a Spotify link or URI." }, 400);

  if (purpose === "replacement" && parsed.kind !== "track" && parsed.kind !== "playlist" && parsed.kind !== "album") {
    return json({ error: "Pick a track, playlist, or album." }, 400);
  }
  if (purpose === "show" && parsed.kind !== "show" && parsed.kind !== "episode") {
    return json({ error: "Paste a Spotify show or episode link." }, 400);
  }

  const connection = await prisma.spotifyConnection.findUnique({ where: { userId: user.id } });
  if (!connection?.refreshTokenEnc || connection.status === "broken") {
    return json({ error: "Connect Spotify before adding a link." }, 400);
  }

  const result = await authorizedCall(connection, async (token) => {
    const resolved = await resolveCatalogItem({ token, parsed });
    if (!resolved.ok) return { status: resolved.status || 404, hit: null, error: resolved.error };
    return { status: 200, hit: resolved.hit, error: null };
  });
  if (!result.ok) {
    return json({ error: result.broken ? "Reconnect Spotify." : "Spotify could not open that link." }, result.broken ? 409 : 502);
  }
  if (!result.result.hit) return json({ error: result.result.error ?? "Spotify could not open that link." }, 404);
  return json({ hit: result.result.hit });
}
