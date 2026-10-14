import { config } from "dotenv";

config();

async function main() {
  // Selects the worker's database pool size in src/lib/db.ts.
  process.env.PROCESS ||= "worker";
  const { Worker } = await import("bullmq");
  const { QUEUE_NAME, reconcileSchedules } = await import("../lib/jobs");
  const { beatWorkerHeart, redisConnection } = await import("../lib/redis");
  const { pruneOldActivity } = await import("../lib/activity");
  const { runUserCheck } = await import("../lib/blocker-run");
  const { notifyUser } = await import("../lib/mail");
  const { assertMailConfigured } = await import("../lib/env");
  assertMailConfigured();
  const { log } = await import("../lib/log");

  await reconcileSchedules();
  await beatWorkerHeart().catch((error) => {
    log.error("heartbeat failed", { message: error instanceof Error ? error.message : "unknown" });
  });
  const beat = setInterval(() => {
    beatWorkerHeart().catch((error) => {
      log.error("heartbeat failed", { message: error instanceof Error ? error.message : "unknown" });
    });
  }, 10_000);
  const prune = setInterval(() => {
    pruneOldActivity()
      .then((count) => {
        if (count > 0) log.info("pruned activity", { count });
      })
      .catch((error) => {
        log.error("prune failed", { message: error instanceof Error ? error.message : "unknown" });
      });
  }, 6 * 60 * 60 * 1000);
  const reconcile = setInterval(() => {
    reconcileSchedules({ onlyMissing: true }).catch((error) => {
      log.error("reconcile failed", { message: error instanceof Error ? error.message : "unknown" });
    });
  }, 5 * 60 * 1000);

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === "notify") {
        const { email, kind } = job.data ?? {};
        if (typeof email === "string" && (kind === "broken" || kind === "quota")) await notifyUser(email, kind);
        return;
      }
      const userId = typeof job.data?.userId === "string" ? job.data.userId : "";
      if (!userId) return;
      await runUserCheck(userId);
    },
    { connection: redisConnection(), concurrency: 50 },
  );

  worker.on("failed", (job, error) => {
    log.error("check job failed", { jobId: job?.id, message: error.message });
  });

  log.info("worker started");

  const shutdown = async () => {
    clearInterval(beat);
    clearInterval(prune);
    clearInterval(reconcile);
    await worker.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    shutdown().catch(() => process.exit(1));
  });
  process.on("SIGINT", () => {
    shutdown().catch(() => process.exit(1));
  });
}

main().catch((error) => {
  console.error(JSON.stringify({ level: "error", msg: "worker crashed", message: error instanceof Error ? error.message : "unknown" }));
  process.exit(1);
});
