import { afterAll, beforeAll } from "vitest";
import { applyTestEnv, assertTestEnv } from "./env";

applyTestEnv();
assertTestEnv();

beforeAll(async () => {
  applyTestEnv();
  assertTestEnv();
  const { prisma } = await import("../../src/lib/db");
  const { getRedis } = await import("../../src/lib/redis");
  await prisma.user.deleteMany();
  await getRedis().flushdb();
});

afterAll(async () => {
  const { prisma } = await import("../../src/lib/db");
  const { closeConnections } = await import("../../src/lib/jobs");
  await closeConnections();
  await prisma.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
});
