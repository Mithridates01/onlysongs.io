import { SignJWT, jwtVerify } from "jose";
import { isHttpsApp } from "./env";

export const SESSION_COOKIE = "pb_session";

export type SessionPayload = {
  sub: string;
  email: string;
  admin: boolean;
};

function secretKey(): Uint8Array {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  return new TextEncoder().encode(raw);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, admin: payload.admin })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());
}

export async function readSession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.email !== "string") return null;
    return {
      sub: payload.sub,
      email: payload.email,
      admin: payload.admin === true,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = 60 * 60 * 24 * 30) {
  return {
    httpOnly: true,
    secure: isHttpsApp(),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
