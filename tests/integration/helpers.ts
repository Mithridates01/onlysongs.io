import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { encryptString } from "../../src/lib/crypto";
import { prisma } from "../../src/lib/db";

export const TRACK_URI = "spotify:track:11dFghVXANMlKmJXsNCbNl";

export type RecordedCall = {
  url: string;
  method: string;
  body: string | null;
  authorization: string | null;
};

export function stubFetch(handler: (call: RecordedCall) => Response | Promise<Response>): {
  calls: RecordedCall[];
  restore: () => void;
} {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" ? init.body : null;
    const authorization = new Headers(init?.headers).get("authorization");
    const call = { url, method, body, authorization };
    calls.push(call);
    return handler(call);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

export function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

export function trackPlayback(name = "Kept Song"): unknown {
  return {
    is_playing: true,
    currently_playing_type: "track",
    device: { id: "device1", name: "Phone" },
    item: {
      type: "track",
      name,
      uri: "spotify:track:kepttrack0000000000",
      artists: [{ name: "Artist" }],
    },
  };
}

export function episodePlayback(opts?: { showId?: string; showName?: string; episodeName?: string }): unknown {
  return {
    is_playing: true,
    currently_playing_type: "episode",
    device: { id: "device1", name: "Phone" },
    item: {
      type: "episode",
      id: "episode1",
      name: opts?.episodeName ?? "Morning episode",
      uri: "spotify:episode:episode1",
      show: { id: opts?.showId ?? "Show123", name: opts?.showName ?? "Daily News" },
    },
  };
}

export async function seedListener(opts?: {
  email?: string;
  enabled?: boolean;
  quietHours?: { start: string; end: string } | null;
  allowedShows?: { id: string; name: string }[];
  failures?: number;
  expiresAt?: Date | null;
  withTokens?: boolean;
}): Promise<{ id: string; email: string }> {
  const email = opts?.email ?? `listener-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const withTokens = opts?.withTokens !== false;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("password-1", 4),
      settings: {
        create: {
          enabled: opts?.enabled !== false,
          replacementUri: TRACK_URI,
          replacementLabel: "Test Track",
          replacementKind: "track",
          timeZone: "UTC",
          blockAudiobooks: true,
          allowedShowIds: opts?.allowedShows ?? [],
          ...(opts?.quietHours ? { quietHours: opts.quietHours } : { quietHours: Prisma.DbNull }),
        },
      },
      poll: { create: { consecutiveFailures: opts?.failures ?? 0 } },
      ...(withTokens
        ? {
            spotify: {
              create: {
                clientId: "clientid1234",
                clientSecretEnc: encryptString("client-secret"),
                accessTokenEnc: encryptString("access-old"),
                refreshTokenEnc: encryptString("refresh-old"),
                expiresAt: opts?.expiresAt === undefined ? new Date(Date.now() + 60 * 60 * 1000) : opts.expiresAt,
                status: "connected",
              },
            },
          }
        : {}),
    },
    select: { id: true, email: true },
  });
  return user;
}

export async function deleteUser(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

export function quietWindowCoveringNow(now = new Date()): { start: string; end: string } {
  const hour = now.getUTCHours();
  const pad = (value: number) => String(value).padStart(2, "0");
  return { start: `${pad((hour + 23) % 24)}:00`, end: `${pad((hour + 2) % 24)}:00` };
}

export function spotifyRoute(call: RecordedCall, handlers: {
  player?: () => Response;
  play?: () => Response;
  next?: () => Response;
  token?: () => Response;
}): Response {
  if (call.url.includes("/api/token")) return (handlers.token ?? unexpected(call))();
  if (call.url.includes("/me/player/play")) return (handlers.play ?? unexpected(call))();
  if (call.url.includes("/me/player/next")) return (handlers.next ?? unexpected(call))();
  if (call.url.includes("/me/player")) return (handlers.player ?? unexpected(call))();
  return unexpected(call)();
}

function unexpected(call: RecordedCall): () => Response {
  return () => {
    throw new Error(`Unexpected Spotify request ${call.method} ${call.url}`);
  };
}
