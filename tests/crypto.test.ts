import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "ab".repeat(32);
});

describe("encryption", () => {
  it("round-trips a secret and fails closed on the wrong key", async () => {
    const { decryptString, encryptString, last4 } = await import("../src/lib/crypto");
    const payload = encryptString("refresh-token-value");
    expect(payload).not.toContain("refresh-token-value");
    expect(decryptString(payload)).toBe("refresh-token-value");
    expect(last4("clientid1234")).toBe("1234");
    process.env.ENCRYPTION_KEY = "cd".repeat(32);
    expect(() => decryptString(payload)).toThrow(/decrypt failed/);
  });
});
