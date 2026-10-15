// Root-key parsing and the session key. Edge-safe: middleware imports this,
// so it uses Web Crypto and no Node APIs.

const SESSION_INFO = "onlysongs/session/v1";

export function parseRootKey(raw: string | undefined): Uint8Array {
  const trimmed = raw?.trim();
  if (!trimmed) throw new Error("ENCRYPTION_KEY is not set");
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }
  try {
    const decoded = Uint8Array.from(atob(trimmed), (char) => char.charCodeAt(0));
    if (decoded.length === 32) return decoded;
  } catch {
    // not base64
  }
  throw new Error("ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or base64");
}

const cache = new Map<string, Promise<Uint8Array>>();

// The JWT signing key. SESSION_SECRET wins when set; otherwise it is derived
// from ENCRYPTION_KEY with HKDF, so it never equals the data-encryption key.
export function sessionKey(): Promise<Uint8Array> {
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit) {
    if (explicit.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    return Promise.resolve(new TextEncoder().encode(explicit));
  }
  const raw = process.env.ENCRYPTION_KEY ?? "";
  let key = cache.get(raw);
  if (!key) {
    key = deriveSessionKey(parseRootKey(raw));
    cache.set(raw, key);
    key.catch(() => cache.delete(raw));
  }
  return key;
}

async function deriveSessionKey(root: Uint8Array): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", root as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(SESSION_INFO) },
    base,
    256,
  );
  return new Uint8Array(bits);
}
