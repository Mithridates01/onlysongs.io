// Spotify access-token lifecycle: when to refresh, and one retry after a 401.
// Pure apart from the injected refresh and call functions.

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
