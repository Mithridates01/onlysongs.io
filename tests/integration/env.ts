// Fixed local targets. Overwriting the process env keeps a developer shell
// that points at the dev database from being used by this suite.
export const TEST_DATABASE_URL = "postgresql://blocker:blocker@127.0.0.1:5432/onlysongs_test";
export const TEST_REDIS_URL = "redis://127.0.0.1:6379/1";
export const TEST_ENCRYPTION_KEY = "ab".repeat(32);

export const TEST_APP_URL = "http://127.0.0.1:3000";

export function applyTestEnv(): void {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = TEST_REDIS_URL;
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.APP_URL = TEST_APP_URL;
  process.env.ADMIN_EMAIL = "";
  process.env.SMTP_HOST = "";
  process.env.SIGNUPS = "open";
}

export function assertTestEnv(): void {
  const database = new URL(process.env.DATABASE_URL ?? "http://invalid").pathname.replace(/^\//, "");
  if (database !== "onlysongs_test") {
    throw new Error(`Integration tests refuse database "${database}".`);
  }
  if (!process.env.REDIS_URL?.endsWith("/1")) {
    throw new Error("Integration tests refuse a Redis URL that is not database 1.");
  }
}
