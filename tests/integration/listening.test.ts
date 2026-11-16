import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { POST as platform } from "../../src/app/api/admin/listening/route";
import { POST as perUser } from "../../src/app/api/admin/users/[id]/listening/route";
import { prisma } from "../../src/lib/db";
import { recordListening, setHistoryCollection } from "../../src/lib/listening";
import { startSession } from "../../src/lib/sessions";
import { deleteUser, seedListener } from "./helpers";

const playing = (uri: string) => ({ is_playing: true, currently_playing_type: "track", item: { type: "track", uri, name: uri } });

describe("listening history", () => {
  const created: string[] = [];
  beforeEach(async () => {
    await setHistoryCollection(true);
  });
  afterEach(async () => {
    sessionJar.token = undefined;
    await prisma.appSetting.deleteMany({});
    while (created.length) await deleteUser(created.pop()!);
  });

  async function listener() {
    const seeded = await seedListener();
    created.push(seeded.id);
    return { id: seeded.id, email: seeded.email, historyEnabled: true, timeZone: "UTC" };
  }

  async function titles(userId: string) {
    const rows = await prisma.listeningEvent.findMany({ where: { userId }, orderBy: { at: "asc" } });
    return rows.map((row) => row.kind === "none" ? "-" : row.title);
  }

  it("saves a row only when what's playing changes", async () => {
    const u = await listener();
    const t0 = Date.now();
    const at = (i: number) => new Date(t0 + i * 5000);
    await recordListening(u, null, at(0));
    await recordListening(u, playing("x"), at(1));
    await recordListening(u, playing("x"), at(2));
    await recordListening(u, playing("y"), at(3));
    await recordListening(u, playing("y"), at(4));
    await recordListening(u, null, at(5));
    await recordListening(u, null, at(6));
    await recordListening(u, playing("x"), at(7));
    expect(await titles(u.id)).toEqual(["x", "y", "-", "x"]);
  });

  it("saves nothing while the platform or the account switch is off", async () => {
    const u = await listener();
    await setHistoryCollection(false);
    expect(await recordListening(u, playing("x"))).toBe(false);
    await setHistoryCollection(true);
    expect(await recordListening({ ...u, historyEnabled: false }, playing("x"))).toBe(false);
    expect(await prisma.listeningEvent.count({ where: { userId: u.id } })).toBe(0);
  });

  it("lets only the operator switch collection and purge", async () => {
    const u = await listener();
    const other = await listener();
    await recordListening(u, playing("x"));
    await recordListening(other, playing("y"));

    sessionJar.token = await startSession({ id: u.id, email: u.email, isAdmin: false });
    expect((await platform(post({ action: "collect", on: false }))).status).toBe(404);
    expect((await perUser(post({ action: "purge" }), params(other.id))).status).toBe(404);

    await signInAsOperator();
    const off = await perUser(post({ action: "collect", on: false }), params(u.id));
    expect(off.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).historyEnabled).toBe(false);

    expect(await (await perUser(post({ action: "purge" }), params(u.id))).json()).toMatchObject({ deleted: 1 });
    expect(await prisma.listeningEvent.count({ where: { userId: other.id } })).toBe(1);

    expect((await platform(post({ action: "purge", confirm: "yes" }))).status).toBe(400);
    expect((await platform(post({ action: "purge", confirm: "PURGE ALL" }))).status).toBe(200);
    expect(await prisma.listeningEvent.count()).toBe(0);

    await platform(post({ action: "collect", on: false }));
    expect((await prisma.appSetting.findUniqueOrThrow({ where: { key: "listening_history" } })).value).toEqual({ on: false });
  });

  async function signInAsOperator() {
    const admin = await seedListener();
    created.push(admin.id);
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true, emailVerifiedAt: new Date() } });
    sessionJar.token = await startSession({ id: admin.id, email: admin.email, isAdmin: true });
  }
});

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function post(body: unknown): Request {
  return new Request("http://127.0.0.1:3000/api/admin/listening", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
