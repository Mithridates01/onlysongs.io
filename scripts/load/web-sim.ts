// Stands in for the web process: random users press Check now or search, the
// two web paths that touch Spotify tokens alongside the worker.
const RATE_PER_SEC = Number(process.env.WEB_SIM_RATE ?? 2);
const USERS = Number(process.env.LOAD_USERS ?? 1000);
const MAX_IN_FLIGHT = 20;

async function main() {
  const { assertLoadEnv } = await import("./env");
  assertLoadEnv();
  const { runUserCheck } = await import("../../src/lib/blocker-run");
  const { authorizedCall } = await import("../../src/lib/accounts");
  const { searchCatalog } = await import("../../src/lib/spotify");
  const { prisma } = await import("../../src/lib/db");
  const { closeConnections } = await import("../../src/lib/jobs");

  let inFlight = 0;
  const counts = { checkNow: 0, search: 0, skipped: 0, failed: 0 };

  async function search(userId: string): Promise<void> {
    const connection = await prisma.spotifyConnection.findUnique({ where: { userId } });
    if (!connection?.refreshTokenEnc || connection.status === "broken") return;
    await authorizedCall(connection, async (token) => {
      const found = await searchCatalog({ token, query: "load", type: "track" });
      return { status: found.ok ? 200 : found.status };
    });
  }

  const tick = setInterval(() => {
    if (inFlight >= MAX_IN_FLIGHT) {
      counts.skipped++;
      return;
    }
    const userId = `load-user-${Math.floor(Math.random() * USERS)}`;
    const checkNow = Math.random() < 0.5;
    if (checkNow) counts.checkNow++;
    else counts.search++;
    inFlight++;
    const work = checkNow ? runUserCheck(userId, { ignoreCooldown: true }) : search(userId);
    work
      .catch(() => {
        counts.failed++;
      })
      .finally(() => {
        inFlight--;
      });
  }, 1000 / RATE_PER_SEC);

  const shutdown = async () => {
    clearInterval(tick);
    console.log(JSON.stringify({ level: "info", msg: "web sim done", ...counts }));
    await closeConnections().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  console.log(JSON.stringify({ level: "info", msg: "web sim started", ratePerSec: RATE_PER_SEC }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
