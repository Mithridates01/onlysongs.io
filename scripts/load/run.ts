// Load test: fake Spotify + N seeded users + the real worker + simulated web
// traffic, then a pass/fail report. Needs the dev Postgres and Redis:
//   docker compose -f docker-compose.dev.yml up -d
//   npm run load-test -- --users 1000 --minutes 10
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import Redis from "ioredis";
import { FAKE_PORT, FAKE_URL, assertLoadEnv, loadEnv } from "./env";

type Options = {
  users: number;
  minutes: number;
  interval: number;
  tokenTtl: number;
  webRate: number;
  dbPool: number;
  slowRate: number;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { users: 1000, minutes: 10, interval: 60, tokenTtl: 300, webRate: 2, dbPool: 0, slowRate: 0.02 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = Number(argv[i + 1]);
    if (!key || !Number.isFinite(value)) throw new Error(`Bad argument: ${argv[i]} ${argv[i + 1]}`);
    if (key === "users") options.users = value;
    else if (key === "minutes") options.minutes = value;
    else if (key === "interval") options.interval = value;
    else if (key === "token-ttl") options.tokenTtl = value;
    else if (key === "web-rate") options.webRate = value;
    else if (key === "db-pool") options.dbPool = value;
    else if (key === "slow-rate") options.slowRate = value;
    else throw new Error(`Unknown option --${key}`);
  }
  return options;
}

const ROOT = path.resolve(__dirname, "../..");
const children: ChildProcess[] = [];

function start(name: string, script: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(process.execPath, ["--import", "tsx", script], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (line: string) => `[${name}] ${line}`;
  const quietInfo = name === "worker" || name === "web";
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        // App info logs are one line per Spotify error; keep the console readable.
        if (quietInfo && line.includes('"level":"info"') && !line.includes("worker started") && !line.includes("web sim")) continue;
        console.log(prefix(line));
      }
    });
  }
  children.push(child);
  return child;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const done = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  await done;
  clearTimeout(timer);
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not come up`);
}

async function ensureDatabase(databaseUrl: string): Promise<void> {
  const adminUrl = new URL(databaseUrl);
  const name = adminUrl.pathname.replace(/^\//, "");
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (existing.rowCount === 0) await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
}

function sampleProcess(pid: number): { cpu: number; rssMb: number } | null {
  try {
    const out = execFileSync("ps", ["-o", "%cpu=,rss=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const [cpu, rss] = out.split(/\s+/).map(Number);
    return { cpu, rssMb: rss / 1024 };
  } catch {
    return null;
  }
}

function summarize(values: number[]): { avg: number; max: number } {
  if (!values.length) return { avg: 0, max: 0 };
  return { avg: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const base = loadEnv();
  if (options.dbPool > 0) {
    // Prisma's default pool is CPUs x 2 + 1, so a laptop hides what a 2-vCPU host (5) would hit.
    const url = new URL(base.DATABASE_URL);
    url.searchParams.set("connection_limit", String(options.dbPool));
    base.DATABASE_URL = url.toString();
  }
  const env: NodeJS.ProcessEnv = { ...process.env, ...base, LOAD_USERS: String(options.users), WEB_SIM_RATE: String(options.webRate) };
  assertLoadEnv(env);
  Object.assign(process.env, env);
  console.log(
    `Load test: ${options.users} users, ${options.interval}s interval, ${options.minutes} min, token TTL ${options.tokenTtl}s, ` +
      `web ${options.webRate}/s, DB pool ${options.dbPool || "default"}, stalled tokens ${options.slowRate * 100}%`,
  );

  await ensureDatabase(base.DATABASE_URL);
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: ROOT, env, stdio: "ignore" });
  const redis = new Redis(base.REDIS_URL);
  await redis.flushdb();
  redis.disconnect();

  start("fake", "scripts/load/fake-spotify.ts", { ...env, FAKE_PORT: String(FAKE_PORT), FAKE_TOKEN_TTL_SEC: String(options.tokenTtl), FAKE_SLOW_TOKEN_RATE: String(options.slowRate) });
  await waitFor(`${FAKE_URL}/__health`, 20_000);

  const { seedListeners } = await import("./seed");
  const { prisma } = await import("../../src/lib/db");
  await seedListeners(options.users, options.interval, options.tokenTtl);
  console.log(`Seeded ${options.users} listeners`);

  const worker = start("worker", "src/worker/index.ts", env);
  const web = start("web", "scripts/load/web-sim.ts", env);

  const samples: { cpu: number; rssMb: number }[] = [];
  const startedAt = Date.now();
  const endAt = startedAt + options.minutes * 60_000;
  let lastProgress = 0;
  while (Date.now() < endAt) {
    if (worker.exitCode !== null) throw new Error("The worker exited early.");
    if (worker.pid) {
      const sample = sampleProcess(worker.pid);
      if (sample) samples.push(sample);
    }
    if (Date.now() - lastProgress >= 60_000) {
      lastProgress = Date.now();
      const stats = (await (await fetch(`${FAKE_URL}/__stats`)).json()) as Record<string, number>;
      const broken = await prisma.spotifyConnection.count({ where: { status: "broken" } });
      const minute = Math.round((Date.now() - startedAt) / 60_000);
      console.log(
        `[progress] ${minute}m plays=${stats.plays} doublePlays=${stats.doublePlays} staleRefresh=${stats.staleRefresh} broken=${broken}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  await stop(web);
  await stop(worker);
  const report = await buildReport(options, samples, prisma);
  for (const child of children) await stop(child);
  await prisma.$disconnect();

  const outDir = path.join(ROOT, "scripts/load/results");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  printReport(report);
  console.log(`\nFull report: ${path.relative(ROOT, file)}`);
  process.exit(report.pass ? 0 : 1);
}

async function buildReport(
  options: Options,
  samples: { cpu: number; rssMb: number }[],
  prisma: typeof import("../../src/lib/db").prisma,
) {
  const fake = (await (await fetch(`${FAKE_URL}/__stats`)).json()) as {
    requests: Record<string, number>;
    refreshOk: number;
    staleRefresh: number;
    unknownRefresh: number;
    expired401: number;
    injected429: number;
    slowTokenCalls: number;
    plays: number;
    doublePlays: number;
    doublePlayUsers: number[];
    inFlightOverlaps: number;
  };
  const broken = await prisma.spotifyConnection.count({ where: { status: "broken" } });
  const disabled = await prisma.blockerSettings.count({ where: { enabled: false } });
  const staleCutoff = new Date(Date.now() - options.interval * 3 * 1000);
  const behind = await prisma.pollState.count({
    where: {
      user: { settings: { enabled: true } },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: staleCutoff } }],
    },
  });
  const activity = await prisma.activityLog.groupBy({ by: ["action", "result"], _count: { _all: true } });
  const cpu = summarize(samples.map((s) => s.cpu));
  const rss = summarize(samples.map((s) => s.rssMb));
  const pass = fake.doublePlays === 0 && broken === 0;
  return {
    options,
    pass,
    gate: {
      doublePlays: fake.doublePlays,
      falseBroken: broken,
    },
    causes: {
      staleRefreshTokens: fake.staleRefresh,
      inFlightOverlaps: fake.inFlightOverlaps,
      slowTokenCalls: fake.slowTokenCalls,
    },
    health: {
      blockersDisabled: disabled,
      usersBehindSchedule: behind,
      plays: fake.plays,
      refreshes: fake.refreshOk,
      expired401: fake.expired401,
      injected429: fake.injected429,
    },
    worker: {
      cpuPercentAvg: Math.round(cpu.avg),
      cpuPercentMax: Math.round(cpu.max),
      rssMbAvg: Math.round(rss.avg),
      rssMbMax: Math.round(rss.max),
    },
    activity: activity.map((row) => ({ action: row.action, result: row.result, count: row._count._all })),
    requests: fake.requests,
    doublePlayUsers: fake.doublePlayUsers,
  };
}

function printReport(report: Awaited<ReturnType<typeof buildReport>>): void {
  const row = (label: string, value: number | string) => console.log(`  ${label.padEnd(28)} ${value}`);
  console.log(`\n=== Load test ${report.pass ? "PASSED" : "FAILED"} ===`);
  console.log("Gate (both must be 0)");
  row("Double swaps (C1)", report.gate.doublePlays);
  row("False broken connections (C2)", report.gate.falseBroken);
  console.log("Causes");
  row("Stale refresh tokens used", report.causes.staleRefreshTokens);
  row("Overlapping player calls", report.causes.inFlightOverlaps);
  row("Stalled token calls (13s)", report.causes.slowTokenCalls);
  console.log("Health");
  row("Blockers switched off", report.health.blockersDisabled);
  row("Users behind schedule", report.health.usersBehindSchedule);
  row("Swaps", report.health.plays);
  row("Token refreshes", report.health.refreshes);
  console.log("Worker process");
  row("CPU % (avg / max)", `${report.worker.cpuPercentAvg} / ${report.worker.cpuPercentMax}`);
  row("Memory MB (avg / max)", `${report.worker.rssMbAvg} / ${report.worker.rssMbMax}`);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  for (const child of children) await stop(child).catch(() => undefined);
  process.exit(1);
});
