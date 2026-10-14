// A stateful fake of the Spotify endpoints the blocker uses, for load tests.
// Each seeded user n signs in with client id `load-<n>`. Refresh tokens rotate
// on every refresh and the old one stops working at once, which is the strict
// case that exposes concurrent refreshes. GET /__stats reports what it saw.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PORT = Number(process.env.FAKE_PORT ?? 4010);
const TOKEN_TTL_SEC = Number(process.env.FAKE_TOKEN_TTL_SEC ?? 300);
const LATENCY_MIN_MS = Number(process.env.FAKE_LATENCY_MIN_MS ?? 30);
const LATENCY_MAX_MS = Number(process.env.FAKE_LATENCY_MAX_MS ?? 250);
// A stalled token endpoint is what pushes a check past the 12s lock TTL.
const SLOW_TOKEN_RATE = Number(process.env.FAKE_SLOW_TOKEN_RATE ?? 0.02);
const SLOW_TOKEN_MS = Number(process.env.FAKE_SLOW_TOKEN_MS ?? 13_000);
const RATE_LIMIT_RATE = Number(process.env.FAKE_429_RATE ?? 0.002);
// Two plays for one user inside this window mean two checks saw the same episode.
const DOUBLE_PLAY_WINDOW_MS = 15_000;
// Content stays put at least this long after a play, so the window above is unambiguous.
const MIN_HOLD_MS = 20_000;
const MAX_HOLD_MS = 120_000;

type Content = "track" | "episode" | "chapter" | "none";

type FakeUser = {
  n: number;
  refreshGen: number;
  content: Content;
  holdUntil: number;
  lastPlayAt: number;
  inFlight: number;
};

const users = new Map<number, FakeUser>();
const accessTokens = new Map<string, { n: number; expiresAt: number }>();
const startedAt = Date.now();
let tokenCounter = 0;

const stats = {
  requests: {} as Record<string, number>,
  refreshOk: 0,
  staleRefresh: 0,
  unknownRefresh: 0,
  expired401: 0,
  injected429: 0,
  slowTokenCalls: 0,
  plays: 0,
  doublePlays: 0,
  doublePlayUsers: [] as number[],
  inFlightOverlaps: 0,
};

function userFor(n: number): FakeUser {
  let user = users.get(n);
  if (!user) {
    user = { n, refreshGen: 0, content: "none", holdUntil: 0, lastPlayAt: 0, inFlight: 0 };
    reroll(user, Date.now());
    users.set(n, user);
  }
  return user;
}

function holdFor(): number {
  return MIN_HOLD_MS + Math.random() * (MAX_HOLD_MS - MIN_HOLD_MS);
}

function reroll(user: FakeUser, now: number): void {
  const roll = Math.random();
  user.content = roll < 0.55 ? "track" : roll < 0.8 ? "episode" : roll < 0.85 ? "chapter" : "none";
  user.holdUntil = now + holdFor();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function latency(): number {
  return LATENCY_MIN_MS + Math.random() * (LATENCY_MAX_MS - LATENCY_MIN_MS);
}

function send(res: ServerResponse, status: number, body?: unknown, headers?: Record<string, string>): void {
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function clientNumber(req: IncomingMessage): number | null {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return null;
  const clientId = Buffer.from(header.slice(6), "base64").toString("utf8").split(":")[0];
  const match = /^load-(\d+)$/.exec(clientId);
  return match ? Number(match[1]) : null;
}

function bearerOwner(req: IncomingMessage): number | null {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const issued = accessTokens.get(token);
  if (issued) return issued.expiresAt > Date.now() ? issued.n : null;
  // Seeded tokens count as issued when the fake started.
  const seeded = /^at-(\d+)-seed$/.exec(token);
  if (seeded && Date.now() < startedAt + TOKEN_TTL_SEC * 1000) return Number(seeded[1]);
  return null;
}

async function handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const n = clientNumber(req);
  const params = new URLSearchParams(await readBody(req));
  if (Math.random() < SLOW_TOKEN_RATE) {
    stats.slowTokenCalls++;
    await sleep(SLOW_TOKEN_MS);
  }
  if (n === null || params.get("grant_type") !== "refresh_token") {
    send(res, 400, { error: "invalid_client" });
    return;
  }
  const user = userFor(n);
  const presented = params.get("refresh_token") ?? "";
  const match = new RegExp(`^rt-${n}-(\\d+)$`).exec(presented);
  if (!match || Number(match[1]) !== user.refreshGen) {
    if (match && Number(match[1]) < user.refreshGen) stats.staleRefresh++;
    else stats.unknownRefresh++;
    send(res, 400, { error: "invalid_grant", error_description: "Refresh token revoked" });
    return;
  }
  user.refreshGen++;
  stats.refreshOk++;
  const accessToken = `at-${n}-${++tokenCounter}`;
  accessTokens.set(accessToken, { n, expiresAt: Date.now() + TOKEN_TTL_SEC * 1000 });
  send(res, 200, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SEC,
    refresh_token: `rt-${n}-${user.refreshGen}`,
    scope: "user-read-playback-state user-modify-playback-state user-read-currently-playing",
  });
}

function playerBody(user: FakeUser): unknown {
  const device = { id: `device-${user.n}`, name: "Load phone" };
  if (user.content === "track") {
    return {
      is_playing: true,
      currently_playing_type: "track",
      device,
      item: { type: "track", name: "Fake song", uri: "spotify:track:fakesong0000000000000", artists: [{ name: "Fake" }] },
    };
  }
  if (user.content === "episode") {
    return {
      is_playing: true,
      currently_playing_type: "episode",
      device,
      item: {
        type: "episode",
        id: "fakeepisode",
        name: "Fake episode",
        uri: "spotify:episode:fakeepisode",
        show: { id: "FakeShow", name: "Fake show" },
      },
    };
  }
  return {
    is_playing: true,
    currently_playing_type: "episode",
    device,
    item: {
      type: "chapter",
      id: "fakechapter",
      name: "Fake chapter",
      uri: "spotify:chapter:fakechapter",
      audiobook: { id: "FakeBook", name: "Fake audiobook" },
    },
  };
}

function notePlay(user: FakeUser, now: number): void {
  stats.plays++;
  if (user.lastPlayAt && now - user.lastPlayAt < DOUBLE_PLAY_WINDOW_MS) {
    stats.doublePlays++;
    if (stats.doublePlayUsers.length < 50) stats.doublePlayUsers.push(user.n);
  }
  user.lastPlayAt = now;
  user.content = "track";
  user.holdUntil = now + holdFor();
}

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const n = bearerOwner(req);
  if (n === null) {
    stats.expired401++;
    send(res, 401, { error: { status: 401, message: "The access token expired" } });
    return;
  }
  const user = userFor(n);
  const playerCall = path.startsWith("/v1/me/player");
  if (playerCall) {
    if (user.inFlight > 0) stats.inFlightOverlaps++;
    user.inFlight++;
  }
  try {
    await sleep(latency());
    if (Math.random() < RATE_LIMIT_RATE) {
      stats.injected429++;
      send(res, 429, { error: { status: 429, message: "API rate limit exceeded" } }, { "retry-after": "5" });
      return;
    }
    const now = Date.now();
    if (req.method === "GET" && path === "/v1/me/player") {
      if (now >= user.holdUntil) reroll(user, now);
      if (user.content === "none") send(res, 204);
      else send(res, 200, playerBody(user));
      return;
    }
    if (req.method === "PUT" && path === "/v1/me/player/play") {
      await readBody(req);
      notePlay(user, now);
      send(res, 204);
      return;
    }
    if (req.method === "POST" && path === "/v1/me/player/next") {
      notePlay(user, now);
      send(res, 204);
      return;
    }
    if (req.method === "GET" && path === "/v1/search") {
      send(res, 200, { tracks: { items: [] }, playlists: { items: [] }, albums: { items: [] }, shows: { items: [] } });
      return;
    }
    if (req.method === "GET" && path === "/v1/me") {
      send(res, 200, { id: `load-${n}` });
      return;
    }
    send(res, 404, { error: { status: 404, message: "Not found" } });
  } finally {
    if (playerCall) user.inFlight--;
  }
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://fake").pathname;
  const key = `${req.method} ${path}`;
  stats.requests[key] = (stats.requests[key] ?? 0) + 1;
  const work =
    path === "/__health"
      ? Promise.resolve(send(res, 200, { ok: true }))
      : path === "/__stats"
        ? Promise.resolve(send(res, 200, { ...stats, users: users.size }))
        : path === "/api/token" && req.method === "POST"
          ? handleToken(req, res)
          : handleApi(req, res, path);
  work.catch((error: unknown) => {
    console.error("fake spotify error", error);
    if (!res.headersSent) send(res, 500, { error: "fake failure" });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ level: "info", msg: "fake spotify listening", port: PORT, tokenTtlSec: TOKEN_TTL_SEC }));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}
