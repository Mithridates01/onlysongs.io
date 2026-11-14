import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { decryptString, encryptString, last4, loadKey, needsReencrypt } from "../src/lib/crypto";
import { sessionKey } from "../src/lib/keys";

const CURRENT = "ab".repeat(32);
const OLD = "cd".repeat(32);

// The pre-versioning format: AES-256-GCM with the root key itself.
function legacyEncrypt(plain: string, rawKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(rawKey), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

describe("encryption", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = CURRENT;
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    delete process.env.SESSION_SECRET;
  });
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
  });

  it("round-trips a secret in the versioned format and fails closed on the wrong key", () => {
    const payload = encryptString("refresh-token-value");
    expect(payload).toMatch(/^v1\.[0-9a-f]{8}\./);
    expect(payload).not.toContain("refresh-token-value");
    expect(decryptString(payload)).toBe("refresh-token-value");
    expect(needsReencrypt(payload)).toBe(false);
    expect(last4("clientid1234")).toBe("1234");
    process.env.ENCRYPTION_KEY = OLD;
    expect(() => decryptString(payload)).toThrow(/decrypt failed/);
  });

  it("still reads legacy values and marks them for re-encryption", () => {
    const legacy = legacyEncrypt("old-secret", CURRENT);
    expect(decryptString(legacy)).toBe("old-secret");
    expect(needsReencrypt(legacy)).toBe(true);
  });

  it("reads values under the previous key during a rotation", () => {
    process.env.ENCRYPTION_KEY = OLD;
    const versioned = encryptString("rotated");
    const legacy = legacyEncrypt("rotated-legacy", OLD);
    process.env.ENCRYPTION_KEY = CURRENT;
    process.env.ENCRYPTION_KEY_PREVIOUS = OLD;
    expect(decryptString(versioned)).toBe("rotated");
    expect(decryptString(legacy)).toBe("rotated-legacy");
    expect(needsReencrypt(versioned)).toBe(true);
  });

  it("signs sessions with a key that differs from the encryption key", async () => {
    const key = Buffer.from(await sessionKey());
    expect(key).toHaveLength(32);
    expect(key.equals(loadKey())).toBe(false);
    process.env.SESSION_SECRET = "s".repeat(40);
    expect(Buffer.from(await sessionKey()).toString()).toBe("s".repeat(40));
  });
});
