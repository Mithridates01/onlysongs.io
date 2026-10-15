// Rewrites encrypted Spotify fields under the current ENCRYPTION_KEY. Run after
// a key rotation (with ENCRYPTION_KEY_PREVIOUS set) or to move legacy values
// to the v1 format. Dry run by default:
//   npm run reencrypt            # report what would change
//   npm run reencrypt -- --apply # write the changes
import { config } from "dotenv";

config();

const FIELDS = ["clientSecretEnc", "accessTokenEnc", "refreshTokenEnc", "codeVerifierEnc"] as const;

async function main() {
  const apply = process.argv.includes("--apply");
  const { decryptString, encryptString, needsReencrypt } = await import("../src/lib/crypto");
  const { prisma } = await import("../src/lib/db");

  const connections = await prisma.spotifyConnection.findMany();
  let rows = 0;
  let values = 0;
  let unreadable = 0;
  for (const connection of connections) {
    const data: Partial<Record<(typeof FIELDS)[number], string>> = {};
    for (const field of FIELDS) {
      const value = connection[field];
      if (!value || !needsReencrypt(value)) continue;
      try {
        data[field] = encryptString(decryptString(value));
      } catch {
        unreadable++;
        console.error(`user ${connection.userId}: ${field} does not decrypt with the current or previous key`);
      }
    }
    const changed = Object.keys(data).length;
    if (!changed) continue;
    rows++;
    values += changed;
    if (apply) await prisma.spotifyConnection.update({ where: { userId: connection.userId }, data });
  }
  console.log(
    `${apply ? "Re-encrypted" : "Would re-encrypt"} ${values} values in ${rows} of ${connections.length} connections.` +
      (unreadable ? ` ${unreadable} values could not be read.` : ""),
  );
  await prisma.$disconnect();
  if (unreadable) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
