import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    // Integration tests live in tests/integration and need Postgres and Redis.
    include: ["tests/*.test.ts"],
  },
});
