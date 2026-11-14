import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { z } from "zod";
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

// Reads a JSON body and validates it. On failure, `response` is a 400 carrying
// the first schema message (or `message` when given).
export async function parseJson<S extends z.ZodType>(
  request: Request,
  schema: S,
  message?: string,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  const body = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const error = message ?? parsed.error.issues[0]?.message ?? "The request is not valid.";
  return { ok: false, response: json({ error }, 400) };
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
