// Fixed local targets for load tests, kept apart from dev (database `blocker`,
// Redis 0) and the integration suite (`onlysongs_test`, Redis 1).
import { randomBytes } from "node:crypto";

export const LOAD_DATABASE_URL = "postgresql://blocker:blocker@127.0.0.1:5432/onlysongs_load";
export const LOAD_REDIS_URL = "redis://127.0.0.1:6379/2";
export const FAKE_PORT = 4010;
export const FAKE_URL = `http://127.0.0.1:${FAKE_PORT}`;

export function loadEnv(): Record<string, string> {
  return {
    DATABASE_URL: process.env.LOAD_DATABASE_URL ?? LOAD_DATABASE_URL,
    REDIS_URL: LOAD_REDIS_URL,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY_LOAD ?? randomBytes(32).toString("hex"),
    APP_URL: "http://127.0.0.1:3000",
    SPOTIFY_FAKE_URL: FAKE_URL,
    ONLYSONGS_LOAD_TEST: "1",
    NODE_ENV: "development",
    ADMIN_EMAIL: "",
    SMTP_HOST: "",
  };
}

export function assertLoadEnv(env: NodeJS.ProcessEnv = process.env): void {
  const database = new URL(env.DATABASE_URL ?? "http://invalid").pathname.replace(/^\//, "");
  if (database !== "onlysongs_load") throw new Error(`Load tests refuse database "${database}".`);
  if (!env.REDIS_URL?.endsWith("/2")) throw new Error("Load tests refuse a Redis URL that is not database 2.");
  if (env.ONLYSONGS_LOAD_TEST !== "1") throw new Error("ONLYSONGS_LOAD_TEST must be 1.");
}
