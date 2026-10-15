import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "./db";
import { clientIp } from "./rate-limit";
import { SESSION_COOKIE, type SessionPayload } from "./session";
import { liveSession } from "./sessions";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function currentSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return liveSession(jar.get(SESSION_COOKIE)?.value);
}

export async function requireUser() {
  const session = await currentSession();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.sub } });
}

export function requestIp(request: Request): string {
  return clientIp(request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"));
}
