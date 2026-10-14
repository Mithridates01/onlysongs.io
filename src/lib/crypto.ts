import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

export function loadKey(raw = process.env.ENCRYPTION_KEY): Buffer {
  if (!raw?.trim()) {
    throw new Error("ENCRYPTION_KEY is not set");
  }
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or base64");
}

export function encryptString(plain: string, key = loadKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptString(payload: string, key = loadKey()): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 12 + 16 + 1) throw new Error("decrypt failed");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("decrypt failed");
  }
}

export function last4(value: string): string {
  return value.slice(-4);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
