import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma's default pool is CPUs x 2 + 1, about 5 on a 2-vCPU host, which the
// worker's 50 concurrent checks would queue behind. An explicit
// connection_limit in DATABASE_URL wins.
export function pooledDatabaseUrl(raw = process.env.DATABASE_URL, role = process.env.PROCESS): string | undefined {
  if (!raw) return raw;
  const url = new URL(raw);
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", role === "worker" ? "20" : "10");
  }
  return url.toString();
}

function createClient() {
  return new PrismaClient({
    datasourceUrl: pooledDatabaseUrl(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient();
  return globalForPrisma.prisma;
}

// Constructed on first use so a worker can load .env before touching the database.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
