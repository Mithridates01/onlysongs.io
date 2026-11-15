import { afterEach, describe, expect, it, vi } from "vitest";
import { log, setErrorReporter } from "../src/lib/log";

describe("log error reporting", () => {
  afterEach(() => setErrorReporter(null));

  it("forwards errors, with secrets redacted, and not info lines", () => {
    const seen: [string, Record<string, unknown>][] = [];
    setErrorReporter((msg, extra) => seen.push([msg, extra]));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.info("settings saved", { userId: "u1" });
    log.error("invite email failed", { userId: "u1", token: "secret-value" });
    expect(seen).toEqual([["invite email failed", { userId: "u1", token: "[redacted]" }]]);
  });
});
