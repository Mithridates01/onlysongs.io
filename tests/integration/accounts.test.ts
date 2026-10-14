import { afterEach, describe, expect, it, vi } from "vitest";

const sessionJar = vi.hoisted(() => ({ token: undefined as string | undefined }));
const outbox = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get(name: string) {
      if (name !== "pb_session" || !sessionJar.token) return undefined;
      return { name, value: sessionJar.token };
    },
  }),
}));

vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return {
    ...actual,
    sendEmail: async (to: string, email: { subject: string; text: string }) => {
      outbox.push({ to, ...email });
    },
  };
});

import { POST as login } from "../../src/app/api/auth/login/route";
import { POST as logout } from "../../src/app/api/auth/logout/route";
import { POST as forgot } from "../../src/app/api/auth/password/forgot/route";
import { POST as reset } from "../../src/app/api/auth/password/reset/route";
import { POST as signup } from "../../src/app/api/auth/signup/route";
import { POST as verify } from "../../src/app/api/auth/verify-email/route";
import { GET as getStatus } from "../../src/app/api/status/route";
import { prisma } from "../../src/lib/db";
import { SESSION_COOKIE } from "../../src/lib/session";

const PASSWORD = "password-1";
const createdEmails: string[] = [];
let address = 0;

describe("accounts: sessions, verification, reset, rate limits", () => {
  afterEach(async () => {
    sessionJar.token = undefined;
    outbox.length = 0;
    while (createdEmails.length) {
      const email = createdEmails.pop();
      if (email) await prisma.user.deleteMany({ where: { email } });
    }
  });

  it("ends a session on logout even though the JWT is still signed", async () => {
    const { token } = await signUp();
    sessionJar.token = token;
    expect((await getStatus()).status).toBe(200);
    await logout(post("/api/auth/logout", {}));
    expect((await getStatus()).status).toBe(401);
  });

  it("signs out other devices and keeps this one", async () => {
    const { email, token: first } = await signUp();
    const second = cookieValue(await login(post("/api/auth/login", { email, password: PASSWORD })));
    sessionJar.token = second;
    const response = await logout(post("/api/auth/logout?scope=others", {}));
    expect(await response.json()).toMatchObject({ ok: true, ended: 1 });
    expect((await getStatus()).status).toBe(200);
    sessionJar.token = first;
    expect((await getStatus()).status).toBe(401);
  });

  it("verifies the email once from the emailed link", async () => {
    const { email } = await signUp();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toBeNull();
    const token = linkToken(lastEmailTo(email), "verify-email");

    expect((await verify(post("/api/auth/verify-email", { token }))).status).toBe(200);
    const verified = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(verified.emailVerifiedAt).not.toBeNull();
    expect((await verify(post("/api/auth/verify-email", { token }))).status).toBe(400);
  });

  it("answers a reset request the same way whether or not the account exists", async () => {
    const missing = await forgot(post("/api/auth/password/forgot", { email: uniqueEmail() }));
    expect(missing.status).toBe(200);
    expect(outbox).toHaveLength(0);

    const { email } = await signUp();
    outbox.length = 0;
    const known = await forgot(post("/api/auth/password/forgot", { email }));
    expect(known.status).toBe(200);
    expect(await missing.json()).toEqual(await known.json());
    expect(outbox).toHaveLength(1);
  });

  it("resets the password, signs out everywhere, and works only once", async () => {
    const { email, token: session } = await signUp();
    await forgot(post("/api/auth/password/forgot", { email }));
    const token = linkToken(lastEmailTo(email), "reset-password");

    const done = await reset(post("/api/auth/password/reset", { token, password: "new-password-2" }));
    expect(done.status).toBe(200);
    sessionJar.token = session;
    expect((await getStatus()).status).toBe(401);
    expect((await login(post("/api/auth/login", { email, password: PASSWORD }))).status).toBe(401);
    expect((await login(post("/api/auth/login", { email, password: "new-password-2" }))).status).toBe(200);

    const again = await reset(post("/api/auth/password/reset", { token, password: "third-password-3" }));
    expect(again.status).toBe(400);
  });

  it("rejects an expired reset link", async () => {
    const { email } = await signUp();
    await forgot(post("/api/auth/password/forgot", { email }));
    const token = linkToken(lastEmailTo(email), "reset-password");
    await prisma.authToken.updateMany({
      where: { user: { email }, purpose: "reset_password" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const response = await reset(post("/api/auth/password/reset", { token, password: "new-password-2" }));
    expect(response.status).toBe(400);
  });

  it("limits sign-in attempts per account and IP, but not other IPs", async () => {
    const { email } = await signUp();
    const ip = nextIp();
    for (let i = 0; i < 10; i++) {
      await login(post("/api/auth/login", { email, password: "wrong-password" }, ip));
    }
    const blocked = await login(post("/api/auth/login", { email, password: PASSWORD }, ip));
    expect(blocked.status).toBe(429);
    const elsewhere = await login(post("/api/auth/login", { email, password: PASSWORD }));
    expect(elsewhere.status).toBe(200);
  });
});

async function signUp(): Promise<{ email: string; token: string }> {
  const email = uniqueEmail();
  const response = await signup(post("/api/auth/signup", { email, password: PASSWORD }));
  expect(response.status).toBe(200);
  return { email, token: cookieValue(response) };
}

function uniqueEmail(): string {
  const email = `accounts-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  createdEmails.push(email);
  return email;
}

function post(path: string, body: unknown, ip = nextIp()): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function nextIp(): string {
  address += 1;
  return `198.51.100.${address}`;
}

function lastEmailTo(to: string): string {
  const mail = [...outbox].reverse().find((item) => item.to === to);
  if (!mail) throw new Error(`No email to ${to}`);
  return mail.text;
}

function linkToken(text: string, page: string): string {
  const match = new RegExp(`/${page}\\?token=([A-Za-z0-9_-]+)`).exec(text);
  if (!match?.[1]) throw new Error(`No ${page} link in email`);
  return match[1];
}

function cookieValue(response: Response): string {
  const headers = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const header = headers.find((item) => item.startsWith(`${SESSION_COOKIE}=`)) ?? "";
  const pair = header.split(";")[0] ?? "";
  const value = pair.slice(pair.indexOf("=") + 1);
  if (!value) throw new Error("Session cookie was missing.");
  return value;
}
