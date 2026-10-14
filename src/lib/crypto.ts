import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { parseRootKey } from "./keys";

// Ciphertext formats:
//   v1.<kid>.<base64 iv|tag|ciphertext>  AES-256-GCM with a key derived from
//                                        the root key by HKDF; kid names it.
//   <base64 iv|tag|ciphertext>           legacy: the root key used directly.
// ENCRYPTION_KEY_PREVIOUS lets values written under the old key still decrypt
// during a rotation; scripts/reencrypt.ts rewrites them under the current key.

const DATA_INFO = "onlysongs/data/v1";

type DataKey = { key: Buffer; kid: string; root: Buffer };

export function loadKey(raw = process.env.ENCRYPTION_KEY): Buffer {
  return Buffer.from(parseRootKey(raw));
}

const derived = new Map<string, DataKey>();

function dataKey(root: Buffer): DataKey {
  const id = root.toString("hex");
  let found = derived.get(id);
  if (!found) {
    const key = Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), DATA_INFO, 32));
    const kid = createHash("sha256").update(key).digest("hex").slice(0, 8);
    found = { key, kid, root };
    derived.set(id, found);
  }
  return found;
}

function currentKey(root?: Buffer): DataKey {
  return dataKey(root ?? loadKey());
}

function previousKey(): DataKey | null {
  const raw = process.env.ENCRYPTION_KEY_PREVIOUS?.trim();
  return raw ? dataKey(loadKey(raw)) : null;
}

function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function open(body: string, key: Buffer): string {
  const buf = Buffer.from(body, "base64");
  if (buf.length < 12 + 16 + 1) throw new Error("decrypt failed");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("decrypt failed");
  }
}

export function encryptString(plain: string, root?: Buffer): string {
  const { key, kid } = currentKey(root);
  return `v1.${kid}.${seal(plain, key)}`;
}

export function decryptString(payload: string, root?: Buffer): string {
  const keys = root ? [currentKey(root)] : [currentKey(), previousKey()].filter((k): k is DataKey => k !== null);
  const versioned = /^v1\.([0-9a-f]{8})\.(.+)$/.exec(payload);
  if (versioned) {
    const match = keys.find((k) => k.kid === versioned[1]);
    if (!match) throw new Error("decrypt failed");
    return open(versioned[2], match.key);
  }
  for (const k of keys) {
    try {
      return open(payload, k.root);
    } catch {
      // try the next key
    }
  }
  throw new Error("decrypt failed");
}

// True when the value is legacy or was written under a key other than the current one.
export function needsReencrypt(payload: string): boolean {
  const versioned = /^v1\.([0-9a-f]{8})\./.exec(payload);
  return !versioned || versioned[1] !== currentKey().kid;
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
