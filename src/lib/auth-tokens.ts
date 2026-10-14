import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";

export type TokenPurpose = "verify_email" | "reset_password";

export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
};

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Issues a fresh single-use token and voids any unused one for the same purpose,
// so only the newest emailed link works.
export async function issueToken(userId: string, purpose: TokenPurpose): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.authToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.authToken.create({
      data: { userId, purpose, tokenHash: hash(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]) },
    }),
  ]);
  return token;
}

// Marks the token used and returns its user, or null when it is unknown,
// expired, already used, or for another purpose.
export async function consumeToken(token: unknown, purpose: TokenPurpose): Promise<string | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const tokenHash = hash(token);
  const claimed = await prisma.authToken.updateMany({
    where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  const row = await prisma.authToken.findUnique({ where: { tokenHash }, select: { userId: true } });
  return row?.userId ?? null;
}
