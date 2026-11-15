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

import { DELETE as deleteAccount } from "../../src/app/api/account/route";
import { GET as activity } from "../../src/app/api/activity/route";
import { POST as saveCredentials } from "../../src/app/api/spotify/credentials/route";
import { GET as spotifyCallback } from "../../src/app/callback/spotify/route";
import { encryptString } from "../../src/lib/crypto";
import { prisma } from "../../src/lib/db";
import { startSession } from "../../src/lib/sessions";
import { middleware } from "../../src/middleware";
import { deleteUser, seedListener } from "./helpers";

const CLIENT_ID = "0123456789abcdef0123456789abcdef";
const CLIENT_SECRET = "fedcba9876543210fedcba9876543210";
const users: string[] = [];

describe("account, Spotify credential and export routes", () => {
  afterEach(async () => {
    sessionJar.token = undefined;
    while (users.length) await deleteUser(users.pop() ?? "");
  });

  it("refuses a Spotify callback whose state doesn't match, and stores no tokens", async () => {
    const user = await signIn({ withTokens: false });
    await prisma.spotifyConnection.create({
      data: {
        userId: user.id,
        clientId: CLIENT_ID,
        clientSecretEnc: encryptString(CLIENT_SECRET),
        status: "pending",
        oauthState: "expected-state-value",
        oauthStateExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        codeVerifierEnc: encryptString("verifier"),
      },
    });
    const response = await spotifyCallback(new Request("http://127.0.0.1:3000/callback/spotify?code=abc&state=forged-state-value"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("error")).toBe("state");
    const stored = await prisma.spotifyConnection.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stored.refreshTokenEnc).toBeNull();
    expect(stored.status).toBe("pending");
  });

  it("rejects a mis-pasted Client ID before saving anything", async () => {
    const user = await signIn({ withTokens: false });
    const response = await saveCredentials(post("/api/spotify/credentials", { clientId: "not-an-id", clientSecret: CLIENT_SECRET }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/Client ID doesn’t look right/);
    expect(await prisma.spotifyConnection.findUnique({ where: { userId: user.id } })).toBeNull();
  });

  it("replacing credentials drops the old tokens and turns the blocker off", async () => {
    const user = await signIn();
    const response = await saveCredentials(post("/api/spotify/credentials", { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }));
    expect(response.status).toBe(200);
    const stored = await prisma.spotifyConnection.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stored.clientId).toBe(CLIENT_ID);
    expect(stored.refreshTokenEnc).toBeNull();
    expect(stored.status).toBe("pending");
    expect((await prisma.blockerSettings.findUniqueOrThrow({ where: { userId: user.id } })).enabled).toBe(false);
  });

  it("deletes the account and everything that belongs to it", async () => {
    const user = await signIn();
    await prisma.activityLog.create({ data: { userId: user.id, action: "swap", result: "replaced" } });
    const response = await deleteAccount();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/pb_session=;/);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.activityLog.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.spotifyConnection.count({ where: { userId: user.id } })).toBe(0);
  });

  it("exports activity as CSV with formula-like names defused", async () => {
    const user = await signIn();
    await prisma.activityLog.create({
      data: { userId: user.id, action: "swap", result: "replaced", showName: "=HYPERLINK(\"http://x\")", episodeName: "Ep, 1" },
    });
    const response = await activity(new Request("http://127.0.0.1:3000/api/activity?format=csv"));
    expect(response.headers.get("content-type")).toMatch(/text\/csv/);
    const [header, row] = (await response.text()).split("\n");
    expect(header).toBe("at,show_name,episode_name,device_name,action,result,http_status");
    expect(row).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(row).toContain('"Ep, 1"');
  });

  it("sends a nonce-based CSP with every page", async () => {
    const response = await middleware(new NextRequest("http://127.0.0.1:3000/"));
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    const again = await middleware(new NextRequest("http://127.0.0.1:3000/"));
    expect(again.headers.get("content-security-policy")).not.toBe(csp);
  });
});

async function signIn(opts?: { withTokens?: boolean }) {
  const user = await seedListener({ withTokens: opts?.withTokens });
  users.push(user.id);
  sessionJar.token = await startSession({ id: user.id, email: user.email, isAdmin: false });
  return user;
}

function post(path: string, body: unknown): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${users.length}` },
    body: JSON.stringify(body),
  });
}
