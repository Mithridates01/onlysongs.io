import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { POST as decide } from "../../src/app/api/admin/early-access/[id]/route";
import { POST as join } from "../../src/app/api/auth/join/route";
import { POST as signup } from "../../src/app/api/auth/signup/route";
import { POST as requestAccess } from "../../src/app/api/early-access/route";
import { prisma } from "../../src/lib/db";
import { findInvite } from "../../src/lib/early-access";
import { startSession } from "../../src/lib/sessions";
import { seedListener } from "./helpers";

const created: string[] = [];
let address = 0;

describe("early access", () => {
  beforeEach(() => {
    process.env.SIGNUPS = "invite";
  });
  afterEach(async () => {
    process.env.SIGNUPS = "open";
    process.env.ADMIN_EMAIL = "";
    sessionJar.token = undefined;
    outbox.length = 0;
    await prisma.earlyAccessRequest.deleteMany({ where: { email: { in: created } } });
    await prisma.user.deleteMany({ where: { email: { in: created } } });
    created.length = 0;
  });

  it("adds a request once and answers the same way every time", async () => {
    const email = uniqueEmail();
    const first = await requestAccess(post("/api/early-access", { email }));
    const again = await requestAccess(post("/api/early-access", { email: email.toUpperCase() }));
    expect(first.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
    expect(await prisma.earlyAccessRequest.count({ where: { email } })).toBe(1);

    const member = await seedListener({ email: uniqueEmail() });
    const existing = await requestAccess(post("/api/early-access", { email: member.email }));
    expect(existing.status).toBe(200);
    expect(await prisma.earlyAccessRequest.count({ where: { email: member.email } })).toBe(0);
  });

  it("blocks open sign-up while invite-only, except for the operator", async () => {
    const blocked = await signup(post("/api/auth/signup", { email: uniqueEmail(), password: "password-1" }));
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/invite-only/);

    const operator = uniqueEmail();
    process.env.ADMIN_EMAIL = operator;
    const allowed = await signup(post("/api/auth/signup", { email: operator, password: "password-1" }));
    expect(allowed.status).toBe(200);
  });

  it("lets an approved person join once from the emailed link", async () => {
    const email = uniqueEmail();
    await requestAccess(post("/api/early-access", { email }));
    const request = await prisma.earlyAccessRequest.findUniqueOrThrow({ where: { email } });
    await signInAsAdmin();

    const approved = await decide(post(`/api/admin/early-access/${request.id}`, { action: "approve" }), params(request.id));
    expect(approved.status).toBe(200);
    const mail = outbox.find((item) => item.to === email);
    expect(mail?.subject).toMatch(/finish creating/i);
    const token = /\/join\?token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "")?.[1] ?? "";
    const invited = await prisma.earlyAccessRequest.findUniqueOrThrow({ where: { email } });
    expect(invited.status).toBe("invited");
    const days = ((invited.inviteExpiresAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);

    sessionJar.token = undefined;
    const joined = await join(post("/api/auth/join", { token, password: "new-password-1" }));
    expect(joined.status).toBe(200);
    expect(await joined.json()).toMatchObject({ next: "/onboarding" });
    expect(joined.headers.getSetCookie().some((cookie) => cookie.startsWith("pb_session="))).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect((await prisma.earlyAccessRequest.findUniqueOrThrow({ where: { email } })).status).toBe("joined");

    const again = await join(post("/api/auth/join", { token, password: "another-password-2" }));
    expect(again.status).toBe(400);
  });

  it("rejects an expired or declined invite", async () => {
    const email = uniqueEmail();
    await requestAccess(post("/api/early-access", { email }));
    const request = await prisma.earlyAccessRequest.findUniqueOrThrow({ where: { email } });
    await signInAsAdmin();
    await decide(post(`/api/admin/early-access/${request.id}`, { action: "approve" }), params(request.id));
    const token = /\/join\?token=([A-Za-z0-9_-]+)/.exec(outbox.at(-1)?.text ?? "")?.[1] ?? "";

    await prisma.earlyAccessRequest.update({ where: { email }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    expect(await findInvite(token)).toBeNull();
    expect((await join(post("/api/auth/join", { token, password: "new-password-1" }))).status).toBe(400);

    await decide(post(`/api/admin/early-access/${request.id}`, { action: "decline" }), params(request.id));
    expect((await prisma.earlyAccessRequest.findUniqueOrThrow({ where: { email } })).status).toBe("declined");
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("keeps approvals to the operator", async () => {
    const email = uniqueEmail();
    await requestAccess(post("/api/early-access", { email }));
    const request = await prisma.earlyAccessRequest.findUniqueOrThrow({ where: { email } });
    const member = await seedListener({ email: uniqueEmail() });
    sessionJar.token = await startSession({ id: member.id, email: member.email, isAdmin: false });
    const response = await decide(post(`/api/admin/early-access/${request.id}`, { action: "approve" }), params(request.id));
    expect(response.status).toBe(404);
    expect(outbox).toHaveLength(0);
  });
});

async function signInAsAdmin(): Promise<void> {
  const admin = await seedListener({ email: uniqueEmail() });
  await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
  sessionJar.token = await startSession({ id: admin.id, email: admin.email, isAdmin: true });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function uniqueEmail(): string {
  const email = `early-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  created.push(email);
  return email;
}

function post(path: string, body: unknown): Request {
  address += 1;
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${address}` },
    body: JSON.stringify(body),
  });
}
