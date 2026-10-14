import { createHash, randomBytes } from "node:crypto";

export function createVerifier(): string {
  return randomBytes(48).toString("base64url");
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createOauthState(): string {
  return randomBytes(32).toString("base64url");
}
