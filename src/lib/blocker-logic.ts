export type PlayerItem = {
  type?: string;
  uri?: string;
  name?: string;
  id?: string;
  show?: { id?: string; name?: string; uri?: string };
  audiobook?: { id?: string; name?: string; uri?: string };
  artists?: { name?: string }[];
  album?: { images?: { url?: string }[] };
  images?: { url?: string }[];
};

export type PlayerBody = {
  is_playing?: boolean;
  currently_playing_type?: string;
  device?: { id?: string; name?: string } | null;
  item?: PlayerItem | null;
};

export type PlaybackResult =
  | { ok: true; status: 204 }
  | { ok: true; status: 200; body: PlayerBody }
  | { ok: false; status: number; retryAfterSec?: number; reason?: string };

export type BlockTarget = {
  showId?: string;
  showName?: string;
  episodeName?: string;
  deviceId?: string;
  deviceName?: string;
  uri?: string;
  kind: "episode" | "audiobook";
};

export type Classification =
  | { kind: "idle" }
  | { kind: "music" }
  | { kind: "ignored" }
  | { kind: "block"; target: BlockTarget };

export type Replacement = {
  uri: string;
  kind: "track" | "playlist" | "album";
};

export function classifyPlayback(result: PlaybackResult, blockAudiobooks: boolean): Classification {
  if (!result.ok) return { kind: "idle" };
  if (result.status === 204) return { kind: "idle" };
  const body = result.body;
  if (body.is_playing !== true) return { kind: "idle" };

  const item = body.item ?? undefined;
  const uri = item?.uri ?? "";
  const itemType = item?.type ?? "";
  const playingType = body.currently_playing_type ?? "";

  const episode =
    playingType === "episode" || itemType === "episode" || uri.startsWith("spotify:episode:");

  const audiobook =
    playingType === "chapter" ||
    playingType === "audiobook" ||
    itemType === "chapter" ||
    itemType === "audiobook" ||
    uri.startsWith("spotify:chapter:") ||
    uri.startsWith("spotify:audiobook:");

  if (!episode && !(audiobook && blockAudiobooks)) {
    return audiobook ? { kind: "ignored" } : { kind: "music" };
  }

  const showName = item?.show?.name || item?.audiobook?.name || undefined;
  const showId = item?.show?.id || showIdFromUri(item?.show?.uri) || item?.audiobook?.id || showIdFromUri(item?.audiobook?.uri);

  return {
    kind: "block",
    target: {
      kind: episode ? "episode" : "audiobook",
      showId,
      showName,
      episodeName: item?.name,
      deviceId: body.device?.id || undefined,
      deviceName: body.device?.name || undefined,
      uri: uri || undefined,
    },
  };
}

function showIdFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const match = /^spotify:(?:show|audiobook):([A-Za-z0-9]+)$/.exec(uri);
  return match?.[1];
}

export function playBodyFor(replacement: Replacement): { uris: string[] } | { context_uri: string } {
  if (replacement.kind === "track") return { uris: [replacement.uri] };
  return { context_uri: replacement.uri };
}

export type PlayOutcome = "ok" | "fallback_next" | "error";

export function playOutcome(status: number): PlayOutcome {
  if (status === 200 || status === 202 || status === 204) return "ok";
  if (status === 403 || status === 404) return "fallback_next";
  return "error";
}

export function classifyHttpStatus(
  status: number,
): "empty" | "ok" | "unauthorized" | "restricted_or_missing" | "rate_limited" | "server" | "other" {
  if (status === 204) return "empty";
  if (status === 200 || status === 202) return "ok";
  if (status === 401) return "unauthorized";
  if (status === 403 || status === 404) return "restricted_or_missing";
  if (status === 429) return "rate_limited";
  if (status === 0 || status >= 500) return "server";
  return "other";
}

export function tokenNeedsRefresh(expiresAt: Date | null, now: Date): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - now.getTime() <= 60_000;
}

export function classifyTokenError(body: unknown): "invalid_grant" | "other" {
  if (!body || typeof body !== "object") return "other";
  const error = (body as { error?: unknown }).error;
  if (error === "invalid_grant") return "invalid_grant";
  if (typeof error === "string" && error.includes("invalid_grant")) return "invalid_grant";
  return "other";
}

export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken: string; expiresIn: number }
  | { ok: false; error: string; invalidGrant: boolean };

export type TokenState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
};

export type EnsuredToken =
  | { ok: true; accessToken: string; refreshToken: string; expiresAt: Date | null; refreshed: boolean }
  | { ok: false; broken: boolean; error: string };

export async function ensureAccessToken(
  state: TokenState,
  now: Date,
  refresh: (refreshToken: string) => Promise<RefreshResult>,
): Promise<EnsuredToken> {
  if (!tokenNeedsRefresh(state.expiresAt, now)) {
    return {
      ok: true,
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      expiresAt: state.expiresAt,
      refreshed: false,
    };
  }
  return forceRefresh(state.refreshToken, now, refresh);
}

export async function forceRefresh(
  refreshToken: string,
  now: Date,
  refresh: (refreshToken: string) => Promise<RefreshResult>,
): Promise<EnsuredToken> {
  const result = await refresh(refreshToken);
  if (!result.ok) {
    return { ok: false, broken: result.invalidGrant, error: result.error };
  }
  return {
    ok: true,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken || refreshToken,
    expiresAt: new Date(now.getTime() + result.expiresIn * 1000),
    refreshed: true,
  };
}

export async function callWithAuthRetry<T extends { status: number }>(opts: {
  state: TokenState;
  now: Date;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  call: (accessToken: string) => Promise<T>;
}): Promise<
  | { ok: true; result: T; accessToken: string; refreshToken: string; expiresAt: Date | null; refreshed: boolean }
  | { ok: false; broken: boolean; error: string; result?: T }
> {
  let ensured = await ensureAccessToken(opts.state, opts.now, opts.refresh);
  if (!ensured.ok) return ensured;

  let result = await opts.call(ensured.accessToken);
  if (result.status !== 401) {
    return { ok: true, result, ...publicToken(ensured) };
  }

  const refreshed = await forceRefresh(ensured.refreshToken, opts.now, opts.refresh);
  if (!refreshed.ok) return { ...refreshed, result };
  result = await opts.call(refreshed.accessToken);
  if (result.status === 401) {
    return { ok: false, broken: true, error: "spotify rejected the refreshed token", result };
  }
  return { ok: true, result, ...publicToken(refreshed) };
}

function publicToken(token: Extract<EnsuredToken, { ok: true }>) {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    refreshed: token.refreshed,
  };
}

export function isAllowListed(showId: string | undefined, allowedShowIds: string[]): boolean {
  if (!showId) return false;
  return allowedShowIds.includes(showId);
}

export const COOLDOWN_MS = 15_000;
export const QUOTA_PAUSE_MS = 60 * 60 * 1000;
export const FAILURE_WARN_AT = 10;

export function retryPauseMs(retryAfterSec: number | undefined, quotaExceeded: boolean): number {
  if (quotaExceeded) return QUOTA_PAUSE_MS;
  const seconds = retryAfterSec && retryAfterSec > 0 ? retryAfterSec : 60;
  return seconds * 1000;
}

export function describeNowPlaying(result: PlaybackResult, blocked: boolean): {
  kind: string;
  title: string | null;
  subtitle: string | null;
  art: string | null;
} {
  if (!result.ok || result.status === 204 || result.body.is_playing !== true) {
    return { kind: "none", title: null, subtitle: null, art: null };
  }
  const item = result.body.item;
  const art = item?.album?.images?.[0]?.url || item?.images?.[0]?.url || null;
  const artists = item?.artists?.map((artist) => artist.name).filter(Boolean).join(", ");
  const playingType = result.body.currently_playing_type;
  if (blocked) {
    return {
      kind: playingType === "episode" || item?.type === "episode" ? "episode" : "audiobook",
      title: item?.name ?? "Podcast",
      subtitle: item?.show?.name || item?.audiobook?.name || null,
      art,
    };
  }
  return {
    kind: playingType || item?.type || "track",
    title: item?.name ?? "Something is playing",
    subtitle: artists || item?.show?.name || null,
    art,
  };
}
