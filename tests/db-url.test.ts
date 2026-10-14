import { describe, expect, it } from "vitest";
import { pooledDatabaseUrl } from "../src/lib/db";

describe("pooledDatabaseUrl", () => {
  const base = "postgresql://user:pass@db:5432/blocker";

  it("gives the worker a pool of 20 and web a pool of 10", () => {
    expect(new URL(pooledDatabaseUrl(base, "worker")!).searchParams.get("connection_limit")).toBe("20");
    expect(new URL(pooledDatabaseUrl(base, "web")!).searchParams.get("connection_limit")).toBe("10");
    expect(new URL(pooledDatabaseUrl(base, "")!).searchParams.get("connection_limit")).toBe("10");
  });

  it("keeps a connection_limit already in the URL", () => {
    expect(new URL(pooledDatabaseUrl(`${base}?connection_limit=5`, "worker")!).searchParams.get("connection_limit")).toBe("5");
  });

  it("leaves an empty URL alone", () => {
    expect(pooledDatabaseUrl("", "worker")).toBe("");
  });
});
