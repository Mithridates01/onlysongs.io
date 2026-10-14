import { execFileSync } from "node:child_process";
import { Client } from "pg";
import Redis from "ioredis";
import { applyTestEnv, assertTestEnv, TEST_DATABASE_URL, TEST_REDIS_URL } from "./env";

const SERVICES =
  "Start them with: docker compose -f docker-compose.dev.yml up -d";

export async function setup(): Promise<void> {
  applyTestEnv();
  assertTestEnv();
  await ensureDatabase();
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: process.env,
  });
  await ensureRedis();
}

async function ensureDatabase(): Promise<void> {
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Integration tests cannot reach Postgres. ${SERVICES}\n${message}`);
  }
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", ["onlysongs_test"]);
    if (existing.rowCount === 0) {
      await admin.query("CREATE DATABASE onlysongs_test");
    }
  } finally {
    await admin.end();
  }
}

async function ensureRedis(): Promise<void> {
  const redis = new Redis(TEST_REDIS_URL, {
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Integration tests cannot reach Redis database 1. ${SERVICES}\n${message}`);
  } finally {
    redis.disconnect();
  }
}
