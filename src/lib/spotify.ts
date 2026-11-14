import { classifyTokenError } from "./spotify-auth";
import { log } from "./log";
import type { ParsedSpotify, SpotifyKind } from "./spotify-uri";
import type { PlayBody } from "./blocker-logic";

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

// The load-test harness points the app at a fake Spotify. It needs both
// variables and is refused when NODE_ENV is production.
function spotifyBases(): { accounts: string; api: string } {
  const fake = process.env.SPOTIFY_FAKE_URL?.trim();
  if (!fake) return { accounts: ACCOUNTS, api: API };
  if (process.env.ONLYSONGS_LOAD_TEST !== "1" || process.env.NODE_ENV === "production") {
    throw new Error("SPOTIFY_FAKE_URL is only allowed in a load test, never in production.");
  }
  const base = fake.replace(/\/$/, "");
  return { accounts: base, api: `${base}/v1` };
}

export const PLAYBACK_SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing";

export type SpotifyImage = { url?: string; width?: number; height?: number };

export type SearchHit = {
  id: string;
  uri: string;
  kind: SpotifyKind;
  title: string;
  subtitle: string;
  art: string | null;
};

export type TokenResponse =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      expiresIn: number;
      scope: string;
    }
  | { ok: false; error: string; invalidGrant: boolean; status: number };

type FetchLike = typeof fetch;

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function exchangeCode(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: FetchLike;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
  return postToken(opts.clientId, opts.clientSecret, body, opts.fetchImpl);
}

export async function refreshTokens(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
  });
  return postToken(opts.clientId, opts.clientSecret, body, opts.fetchImpl, opts.signal);
}

async function postToken(
  clientId: string,
  clientSecret: string,
  body: URLSearchParams,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const tokenUrl = `${spotifyBases().accounts}/api/token`;
  let res: Response;
  try {
    res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: basicAuth(clientId, clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal,
    });
  } catch (error) {
    log.error("spotify token network error", { message: error instanceof Error ? error.message : "unknown" });
    return { ok: false, error: "Could not reach Spotify.", invalidGrant: false, status: 0 };
  }

  const json = await readJson(res);
  if (!res.ok) {
    const invalidGrant = classifyTokenError(json) === "invalid_grant";
    const message =
      json && typeof json === "object" && typeof (json as { error_description?: unknown }).error_description === "string"
        ? (json as { error_description: string }).error_description
        : "Spotify rejected the login.";
    log.info("spotify token rejected", { status: res.status, invalidGrant });
    return { ok: false, error: message, invalidGrant, status: res.status };
  }

  const record = json as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!record.access_token || !record.expires_in) {
    return { ok: false, error: "Spotify returned an incomplete token.", invalidGrant: false, status: res.status };
  }
  return {
    ok: true,
    accessToken: record.access_token,
    refreshToken: record.refresh_token ?? null,
    expiresIn: record.expires_in,
    scope: record.scope ?? "",
  };
}

export function parseRetryAfter(header: string | null, now = Date.now()): number {
  if (!header) return 60;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
  const dated = Date.parse(header);
  if (Number.isFinite(dated)) return Math.max(1, Math.ceil((dated - now) / 1000));
  return 60;
}

export function isQuotaExceeded(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as { reason?: unknown; error?: { reason?: unknown } };
  return record.reason === "QUOTA_EXCEEDED" || record.error?.reason === "QUOTA_EXCEEDED";
}

export type ApiResult = {
  status: number;
  body: unknown;
  retryAfterSec?: number;
  quotaExceeded: boolean;
};

export async function apiRequest(opts: {
  path: string;
  token: string;
  method?: string;
  jsonBody?: unknown;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<ApiResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}` };
  let body: string | undefined;
  if (opts.jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.jsonBody);
  }
  const url = opts.path.startsWith("http") ? opts.path : `${spotifyBases().api}${opts.path}`;
  try {
    const res = await fetchImpl(url, { method: opts.method ?? "GET", headers, body, signal: opts.signal });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    const quotaExceeded = res.status === 429 && isQuotaExceeded(parsed);
    if (res.status >= 400) {
      log.info("spotify api error", { path: opts.path.split("?")[0], status: res.status, quotaExceeded });
    }
    return {
      status: res.status,
      body: parsed,
      retryAfterSec: res.status === 429 ? parseRetryAfter(res.headers.get("retry-after")) : undefined,
      quotaExceeded,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    log.error("spotify api network error", {
      path: opts.path.split("?")[0],
      message: aborted ? "timeout" : error instanceof Error ? error.message : "unknown",
    });
    return { status: 0, body: null, quotaExceeded: false };
  }
}

export async function getPlayback(token: string, signal?: AbortSignal, fetchImpl?: FetchLike): Promise<ApiResult> {
  return apiRequest({
    path: "/me/player?additional_types=track,episode",
    token,
    signal,
    fetchImpl,
  });
}

export async function getTrack(token: string, trackId: string, signal?: AbortSignal, fetchImpl?: FetchLike): Promise<ApiResult> {
  return apiRequest({ path: `/tracks/${encodeURIComponent(trackId)}`, token, signal, fetchImpl });
}

export async function playOnDevice(opts: {
  token: string;
  deviceId?: string;
  body: PlayBody;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<ApiResult> {
  const query = opts.deviceId ? `?device_id=${encodeURIComponent(opts.deviceId)}` : "";
  return apiRequest({
    path: `/me/player/play${query}`,
    token: opts.token,
    method: "PUT",
    jsonBody: opts.body,
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
  });
}

export async function skipNext(opts: {
  token: string;
  deviceId?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<ApiResult> {
  const query = opts.deviceId ? `?device_id=${encodeURIComponent(opts.deviceId)}` : "";
  return apiRequest({
    path: `/me/player/next${query}`,
    token: opts.token,
    method: "POST",
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
  });
}

export async function getMe(token: string, fetchImpl?: FetchLike): Promise<ApiResult> {
  return apiRequest({ path: "/me", token, fetchImpl });
}

function imageUrl(images: SpotifyImage[] | undefined): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return sorted[0]?.url ?? null;
}

export async function searchCatalog(opts: {
  token: string;
  query: string;
  type: "track" | "playlist" | "album" | "show";
  fetchImpl?: FetchLike;
}): Promise<{ ok: true; hits: SearchHit[] } | { ok: false; status: number }> {
  const params = new URLSearchParams({
    q: opts.query,
    type: opts.type,
    limit: "8",
  });
  const result = await apiRequest({
    path: `/search?${params.toString()}`,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
  });
  if (result.status !== 200 || !result.body || typeof result.body !== "object") {
    return { ok: false, status: result.status };
  }
  return { ok: true, hits: mapSearch(opts.type, result.body as Record<string, unknown>) };
}

function mapSearch(type: "track" | "playlist" | "album" | "show", body: Record<string, unknown>): SearchHit[] {
  const bucketKey = `${type}s` as const;
  const bucket = body[bucketKey] as { items?: unknown[] } | undefined;
  const items = Array.isArray(bucket?.items) ? bucket.items : [];
  const hits: SearchHit[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.uri !== "string" || typeof item.name !== "string") continue;
    hits.push({
      id: item.id,
      uri: item.uri,
      kind: type,
      title: item.name,
      subtitle: subtitleFor(type, item),
      art: artFor(type, item),
    });
  }
  return hits;
}

function subtitleFor(type: string, item: Record<string, unknown>): string {
  if (type === "track" || type === "album") {
    const artists = Array.isArray(item.artists) ? item.artists : [];
    return artists
      .map((artist) => (artist && typeof artist === "object" ? (artist as { name?: string }).name : ""))
      .filter(Boolean)
      .join(", ");
  }
  if (type === "playlist") {
    const owner = item.owner as { display_name?: string } | undefined;
    return owner?.display_name ? `Playlist · ${owner.display_name}` : "Playlist";
  }
  if (type === "audiobook") {
    const authors = Array.isArray(item.authors) ? item.authors : [];
    const names = authors
      .map((author) => (author && typeof author === "object" ? (author as { name?: string }).name : ""))
      .filter(Boolean)
      .join(", ");
    return names ? `Audiobook · ${names}` : "Audiobook";
  }
  const publisher = typeof item.publisher === "string" ? item.publisher : "";
  return publisher ? `Show · ${publisher}` : "Show";
}

function artFor(type: string, item: Record<string, unknown>): string | null {
  if (type === "track") {
    const album = item.album as { images?: SpotifyImage[] } | undefined;
    return imageUrl(album?.images);
  }
  return imageUrl(item.images as SpotifyImage[] | undefined);
}

export async function resolveCatalogItem(opts: {
  token: string;
  parsed: ParsedSpotify;
  fetchImpl?: FetchLike;
}): Promise<{ ok: true; hit: SearchHit } | { ok: false; status: number; error: string }> {
  const { parsed } = opts;
  if (parsed.kind === "episode" || parsed.kind === "chapter") {
    const path = parsed.kind === "chapter" ? `/chapters/${parsed.id}` : `/episodes/${parsed.id}`;
    const episode = await apiRequest({ path, token: opts.token, fetchImpl: opts.fetchImpl });
    if (episode.status !== 200 || !episode.body || typeof episode.body !== "object") {
      return { ok: false, status: episode.status, error: "Could not find that episode." };
    }
    const record = episode.body as {
      show?: { id?: string; uri?: string; name?: string; publisher?: string; images?: SpotifyImage[] };
      audiobook?: { id?: string; uri?: string; name?: string; authors?: { name?: string }[]; images?: SpotifyImage[] };
    };
    if (record.audiobook?.id && record.audiobook.name) {
      const authors = (record.audiobook.authors ?? []).map((author) => author.name).filter(Boolean).join(", ");
      return {
        ok: true,
        hit: {
          id: record.audiobook.id,
          uri: record.audiobook.uri || `spotify:audiobook:${record.audiobook.id}`,
          kind: "show",
          title: record.audiobook.name,
          subtitle: authors ? `Audiobook · ${authors}` : "Audiobook",
          art: imageUrl(record.audiobook.images),
        },
      };
    }
    const show = record.show;
    if (!show?.id || !show.uri || !show.name) {
      return { ok: false, status: 404, error: "That episode has no show." };
    }
    return {
      ok: true,
      hit: {
        id: show.id,
        uri: show.uri,
        kind: "show",
        title: show.name,
        subtitle: show.publisher ? `Show · ${show.publisher}` : "Show",
        art: imageUrl(show.images),
      },
    };
  }

  const path =
    parsed.kind === "track"
      ? `/tracks/${parsed.id}`
      : parsed.kind === "playlist"
        ? `/playlists/${parsed.id}`
        : parsed.kind === "album"
          ? `/albums/${parsed.id}`
          : parsed.kind === "audiobook"
            ? `/audiobooks/${parsed.id}`
            : `/shows/${parsed.id}`;
  const result = await apiRequest({ path, token: opts.token, fetchImpl: opts.fetchImpl });
  if (result.status !== 200 || !result.body || typeof result.body !== "object") {
    return { ok: false, status: result.status, error: "Spotify could not find that link." };
  }
  const item = result.body as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.name !== "string") {
    return { ok: false, status: 502, error: "Spotify returned an unexpected item." };
  }
  const uri = typeof item.uri === "string" ? item.uri : parsed.uri;
  return {
    ok: true,
    hit: {
      id: item.id,
      uri,
      kind: parsed.kind,
      title: item.name,
      subtitle: subtitleFor(parsed.kind, item),
      art: artFor(parsed.kind, item),
    },
  };
}
