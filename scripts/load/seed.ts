// Replaces every user in the load database with N listeners whose blocker is on
// and whose Spotify app is the fake one (`load-<n>`).
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { encryptString } from "../../src/lib/crypto";
import { prisma } from "../../src/lib/db";
import { assertLoadEnv } from "./env";

const BATCH = 250;

export async function seedListeners(count: number, intervalSeconds: number, tokenTtlSec: number): Promise<void> {
  assertLoadEnv();
  await prisma.user.deleteMany({});
  const passwordHash = await bcrypt.hash("load-password", 4);
  const clientSecretEnc = encryptString("load-secret");
  const now = Date.now();

  for (let start = 0; start < count; start += BATCH) {
    const numbers = Array.from({ length: Math.min(BATCH, count - start) }, (_, i) => start + i);
    const id = (n: number) => `load-user-${n}`;
    await prisma.$transaction([
      prisma.user.createMany({
        data: numbers.map((n) => ({ id: id(n), email: `load-${n}@load.test`, passwordHash })),
      }),
      prisma.blockerSettings.createMany({
        data: numbers.map((n) => ({
          userId: id(n),
          enabled: true,
          intervalSeconds,
          replacementUri: "spotify:track:11dFghVXANMlKmJXsNCbNl",
          replacementLabel: "Load track",
          replacementKind: "track",
          timeZone: "UTC",
          quietHours: Prisma.DbNull,
        })),
      }),
      prisma.pollState.createMany({ data: numbers.map((n) => ({ userId: id(n) })) }),
      prisma.spotifyConnection.createMany({
        data: numbers.map((n) => ({
          userId: id(n),
          clientId: `load-${n}`,
          clientSecretEnc,
          accessTokenEnc: encryptString(`at-${n}-seed`),
          refreshTokenEnc: encryptString(`rt-${n}-0`),
          // Spread expiry so refreshes are spread over the run, not all at once.
          expiresAt: new Date(now + Math.random() * tokenTtlSec * 1000),
          status: "connected",
        })),
      }),
    ]);
  }
}
