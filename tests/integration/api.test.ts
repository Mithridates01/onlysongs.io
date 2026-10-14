import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionJar = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get(name: string) {
      if (name !== "pb_session" || !sessionJar.token) return undefined;
      return { name, value: sessionJar.token };
    },
  }),
}));

import { POST as signup } from "../../src/app/api/auth/signup/route";
import { POST as login } from "../../src/app/api/auth/login/route";
import { PUT as putSettings } from "../../src/app/api/settings/route";
import { GET as getStatus } from "../../src/app/api/status/route";
import { middleware } from "../../src/middleware";
import { encryptString } from "../../src/lib/crypto";
import { prisma } from "../../src/lib/db";
import { getQueue, schedulerId } from "../../src/lib/jobs";
import { readSession, SESSION_COOKIE } from "../../src/lib/session";
import { TRACK_URI } from "./helpers";

const PASSWORD = "password-1";
const createdEmails: string[] = [];
let address = 0;

describe("auth and settings routes", () => {
  afterEach(async () => {
    sessionJar.token = undefined;
    while (createdEmails.length) {
      const email = createdEmails.pop();
      if (!email) continue;
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  it("sets a session cookie on signup and login", async () => {
    const email = uniqueEmail();
    const signedUp = await signup(postJson("http://127.0.0.1:3000/api/auth/signup", { email, password: PASSWORD }));
    expect(signedUp.status).toBe(200);
    const signupToken = cookieValue(signedUp);
    expect(signupToken).toBeTruthy();
    expect(sessionHeader(signedUp).toLowerCase()).toContain("httponly");
    expect(sessionHeader(signedUp).toLowerCase()).toContain("samesite=lax");
    const signupSession = await readSession(signupToken);
    expect(signupSession?.email).toBe(email);

    const signedIn = await login(postJson("http://127.0.0.1:3000/api/auth/login", { email, password: PASSWORD }));
    expect(signedIn.status).toBe(200);
    const loginToken = cookieValue(signedIn);
    expect(await readSession(loginToken)).toMatchObject({ email });

    sessionJar.token = loginToken;
    const status = await getStatus();
    expect(status.status).toBe(200);
    const body = (await status.json()) as { blockerEnabled: boolean };
    expect(body.blockerEnabled).toBe(false);
  });

  it("rejects a signed-out status request", async () => {
    const blocked = await middleware(new NextRequest("http://127.0.0.1:3000/api/status"));
    expect(blocked.status).toBe(401);
    const payload = (await blocked.json()) as { error: string };
    expect(payload.error).toMatch(/sign in/i);

    sessionJar.token = undefined;
    const direct = await getStatus();
    expect(direct.status).toBe(401);
  });

  it("rejects enabling the blocker until a replacement and Spotify are saved", async () => {
    const email = uniqueEmail();
    const signedUp = await signup(postJson("http://127.0.0.1:3000/api/auth/signup", { email, password: PASSWORD }));
    sessionJar.token = cookieValue(signedUp);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    const missingSong = await putSettings(jsonRequest("PUT", { enabled: true }));
    expect(missingSong.status).toBe(400);
    expect(((await missingSong.json()) as { error: string }).error).toMatch(/replacement/i);

    const missingSpotify = await putSettings(
      jsonRequest("PUT", {
        enabled: true,
        replacement: { uri: TRACK_URI, label: "Test Track", kind: "track" },
      }),
    );
    expect(missingSpotify.status).toBe(400);
    expect(((await missingSpotify.json()) as { error: string }).error).toMatch(/connect spotify/i);
    const stillOff = await prisma.blockerSettings.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stillOff.enabled).toBe(false);

    await prisma.spotifyConnection.create({
      data: {
        userId: user.id,
        clientId: "clientid1234",
        clientSecretEnc: encryptString("client-secret"),
        accessTokenEnc: encryptString("access-old"),
        refreshTokenEnc: encryptString("refresh-old"),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        status: "connected",
      },
    });

    const enabled = await putSettings(
      jsonRequest("PUT", {
        enabled: true,
        replacement: { uri: TRACK_URI, label: "Test Track", kind: "track" },
      }),
    );
    expect(enabled.status).toBe(200);
    const settings = await prisma.blockerSettings.findUniqueOrThrow({ where: { userId: user.id } });
    expect(settings.enabled).toBe(true);
    const schedulers = await getQueue().getJobSchedulers();
    expect(schedulers.some((job) => (job.id ?? job.key) === schedulerId(user.id))).toBe(true);

    const disabled = await putSettings(jsonRequest("PUT", { enabled: false }));
    expect(disabled.status).toBe(200);
    const after = await getQueue().getJobSchedulers();
    expect(after.some((job) => (job.id ?? job.key) === schedulerId(user.id))).toBe(false);
  });
});

function uniqueEmail(): string {
  const email = `api-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  createdEmails.push(email);
  return email;
}

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextIp(),
    },
    body: JSON.stringify(body),
  });
}

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://127.0.0.1:3000/api/settings", {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextIp(),
    },
    body: JSON.stringify(body),
  });
}

function nextIp(): string {
  address += 1;
  return `203.0.113.${address}`;
}

function cookieValue(response: Response): string {
  const header = sessionHeader(response);
  const pair = header.split(";")[0] ?? "";
  const value = pair.slice(pair.indexOf("=") + 1);
  if (!value || !header.includes(SESSION_COOKIE)) throw new Error("Session cookie was missing.");
  return value;
}

function sessionHeader(response: Response): string {
  const headers = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const match = headers.find((item) => item.startsWith(`${SESSION_COOKIE}=`)) ?? response.headers.get("set-cookie") ?? "";
  return match;
}
