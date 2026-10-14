import { config } from "dotenv";

config();

async function main() {
  const { Worker } = await import("bullmq");
  const { QUEUE_NAME, beatWorkerHeart, reconcileSchedules, pruneOldActivity, redisConnection } = await import(
    "../lib/jobs"
  );
  const { runUserCheck } = await import("../lib/blocker-run");
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

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
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
