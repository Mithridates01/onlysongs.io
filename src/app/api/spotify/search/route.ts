import { authorizedCall } from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { json, requireUser } from "@/lib/http";
import { searchCatalog } from "@/lib/spotify";

const TYPES = new Set(["track", "playlist", "album", "show"]);

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "track";
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!TYPES.has(type)) return json({ error: "Search type must be a track, playlist, album, or show." }, 400);
  if (query.length < 1 || query.length > 120) return json({ error: "Enter a search between 1 and 120 characters." }, 400);

  const connection = await prisma.spotifyConnection.findUnique({ where: { userId: user.id } });
  if (!connection?.refreshTokenEnc || connection.status === "broken") {
    return json({ error: "Connect Spotify before searching." }, 400);
  }

  const result = await authorizedCall(connection, async (token) => {
    const found = await searchCatalog({
      token,
      query,
      type: type as "track" | "playlist" | "album" | "show",
    });
    if (!found.ok) return { status: found.status, hits: [] };
    return { status: 200, hits: found.hits };
  });

  if (!result.ok) {
    return json(
      { error: result.broken ? "Reconnect Spotify." : "Spotify search failed." },
      result.broken ? 409 : 502,
    );
  }
  return json({ hits: result.result.hits });
}
