export type SpotifyKind = "track" | "playlist" | "album" | "show" | "episode" | "audiobook" | "chapter";

export type ParsedSpotify = {
  kind: SpotifyKind;
  id: string;
  uri: string;
};

const KINDS = new Set<SpotifyKind>(["track", "playlist", "album", "show", "episode", "audiobook", "chapter"]);

export function parseSpotifyUri(input: string): ParsedSpotify | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const uri = /^spotify:(track|playlist|album|show|episode|audiobook|chapter):([A-Za-z0-9]+)$/.exec(trimmed);
  if (uri && KINDS.has(uri[1] as SpotifyKind)) {
    const kind = uri[1] as SpotifyKind;
    return { kind, id: uri[2], uri: `spotify:${kind}:${uri[2]}` };
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "open.spotify.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const kindIndex = parts.findIndex((part) => KINDS.has(part as SpotifyKind));
    if (kindIndex === -1 || !parts[kindIndex + 1]) return null;
    const kind = parts[kindIndex] as SpotifyKind;
    const id = parts[kindIndex + 1].split("?")[0];
    if (!/^[A-Za-z0-9]+$/.test(id)) return null;
    return { kind, id, uri: `spotify:${kind}:${id}` };
  } catch {
    return null;
  }
}
