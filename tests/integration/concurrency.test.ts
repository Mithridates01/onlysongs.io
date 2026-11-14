import { afterEach, describe, expect, it } from "vitest";
import { authorizedCall } from "../../src/lib/accounts";
import { runUserCheck } from "../../src/lib/blocker-run";
import { decryptString } from "../../src/lib/crypto";
import { prisma } from "../../src/lib/db";
import { getQueue, reconcileSchedules, removeSchedule, schedulerId } from "../../src/lib/jobs";
import { getRedis, withUserLock } from "../../src/lib/redis";
import { deleteUser, jsonResponse, seedListener, spotifyRoute, stubFetch } from "./helpers";

describe("locks and token refresh across processes", () => {
  const created: string[] = [];

  afterEach(async () => {
    while (created.length) {
      const id = created.pop();
      if (id) await deleteUser(id);
    }
  });

  it("leaves a check lock alone once another check owns it", async () => {
    const key = "lock:check:lock-owner-test";
    const result = await withUserLock("lock-owner-test", async () => {
      // The TTL lapsed and a second check took the lock.
      await getRedis().set(key, "second-check");
      return "first done";
    });
    expect(result).toBe("first done");
    expect(await getRedis().get(key)).toBe("second-check");
    await getRedis().del(key);
  });

  it("refreshes once when two calls race on an expired token", async () => {
    const user = await seedListener({ expiresAt: new Date(Date.now() - 60_000) });
    created.push(user.id);
    // Spotify rotates the refresh token and rejects the old one at once.
    let current = "refresh-old";
    let issued = 0;
    const spotify = stubFetch(async (call) =>
      spotifyRoute(call, {
        token: () => {
          const presented = new URLSearchParams(call.body ?? "").get("refresh_token");
          if (presented !== current) return jsonResponse(400, { error: "invalid_grant" });
          issued++;
          current = `refresh-${issued}`;
          return jsonResponse(200, { access_token: `access-${issued}`, refresh_token: current, expires_in: 3600 });
        },
      }),
    );
    try {
      const connection = await prisma.spotifyConnection.findUniqueOrThrow({ where: { userId: user.id } });
      const call = async (token: string) => ({ status: 200, token });
      const [web, worker] = await Promise.all([authorizedCall(connection, call), authorizedCall(connection, call)]);
      expect(web).toMatchObject({ ok: true, accessToken: "access-1" });
      expect(worker).toMatchObject({ ok: true, accessToken: "access-1" });
      expect(spotify.calls.filter((item) => item.url.includes("/api/token"))).toHaveLength(1);
      const stored = await prisma.spotifyConnection.findUniqueOrThrow({ where: { userId: user.id } });
      expect(stored.status).toBe("connected");
      expect(decryptString(stored.refreshTokenEnc ?? "")).toBe("refresh-1");
    } finally {
      spotify.restore();
    }
  });

  it("reports a revoked token to a search without turning the blocker off", async () => {
    const user = await seedListener({ expiresAt: new Date(Date.now() - 60_000) });
    created.push(user.id);
    const spotify = stubFetch((call) =>
      spotifyRoute(call, { token: () => jsonResponse(400, { error: "invalid_grant" }) }),
    );
    try {
      const connection = await prisma.spotifyConnection.findUniqueOrThrow({ where: { userId: user.id } });
      const result = await authorizedCall(connection, async () => ({ status: 200 }));
      expect(result).toMatchObject({ ok: false, broken: true });
      const settings = await prisma.blockerSettings.findUniqueOrThrow({ where: { userId: user.id } });
      expect(settings.enabled).toBe(true);
      const stored = await prisma.spotifyConnection.findUniqueOrThrow({ where: { userId: user.id } });
      expect(stored.status).toBe("connected");
      expect(await prisma.activityLog.count({ where: { userId: user.id } })).toBe(0);
    } finally {
      spotify.restore();
    }
  });

  it("waits for another process's refresh instead of sending the same refresh token", async () => {
    const user = await seedListener({ expiresAt: new Date(Date.now() - 60_000) });
    created.push(user.id);
    let current = "refresh-old";
    let issued = 0;
    // A slow Spotify: the first refresh takes 500ms, so the second caller arrives mid-refresh.
    const spotify = stubFetch(async (call) => {
      if (call.url.includes("/api/token")) await new Promise((resolve) => setTimeout(resolve, 500));
      return spotifyRoute(call, {
        token: () => {
          const presented = new URLSearchParams(call.body ?? "").get("refresh_token");
          if (presented !== current) return jsonResponse(400, { error: "invalid_grant" });
          issued++;
          current = `refresh-${issued}`;
          return jsonResponse(200, { access_token: `access-${issued}`, refresh_token: current, expires_in: 3600 });
        },
      });
    });
    try {
      const connection = await prisma.spotifyConnection.findUniqueOrThrow({ where: { userId: user.id } });
      const call = async (token: string) => ({ status: 200, token });
      const first = authorizedCall(connection, call);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const second = await authorizedCall(connection, call);
      expect(second).toMatchObject({ ok: true, accessToken: "access-1" });
      await expect(first).resolves.toMatchObject({ ok: true, accessToken: "access-1" });
      expect(issued).toBe(1);
    } finally {
      spotify.restore();
    }
  });

  it("queues the Reconnect email instead of sending it inside the check", async () => {
    const user = await seedListener({ expiresAt: new Date(Date.now() - 60_000) });
    created.push(user.id);
    const spotify = stubFetch((call) =>
      spotifyRoute(call, { token: () => jsonResponse(400, { error: "invalid_grant" }) }),
    );
    try {
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("broken");
      const jobs = await getQueue().getJobs(["waiting", "delayed", "prioritized"]);
      const notice = jobs.find((job) => job.name === "notify" && job.data?.email === user.email);
      expect(notice?.data).toEqual({ email: user.email, kind: "broken" });
      await notice?.remove();
    } finally {
      spotify.restore();
    }
  });

  it("restores a schedule that is missing on the periodic reconcile", async () => {
    const user = await seedListener();
    created.push(user.id);
    await removeSchedule(user.id).catch(() => undefined);
    expect(await getQueue().getJobScheduler(schedulerId(user.id))).toBeFalsy();
    await reconcileSchedules({ onlyMissing: true });
    const restored = await getQueue().getJobScheduler(schedulerId(user.id));
    expect(Number(restored?.every)).toBe(60_000);
    await removeSchedule(user.id);
  });
});
