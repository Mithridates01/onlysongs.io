import path from "node:path";
import { defineConfig } from "vitest/config";
import { TEST_APP_URL, TEST_DATABASE_URL, TEST_ENCRYPTION_KEY, TEST_REDIS_URL } from "./tests/integration/env";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 30_000,
    testTimeout: 20_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      APP_URL: TEST_APP_URL,
      ADMIN_EMAIL: "",
      SMTP_HOST: "",
      SIGNUPS: "open",
    },
  },
});
