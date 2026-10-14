import { SignJWT, jwtVerify } from "jose";
import { isHttpsApp } from "./env";
import { sessionKey } from "./keys";

export const SESSION_COOKIE = "pb_session";

export type SessionPayload = {
  sub: string;
  sid: string;
  email: string;
  admin: boolean;
};

export const SESSION_DAYS = 30;

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ sid: payload.sid, email: payload.email, admin: payload.admin })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(await sessionKey());
}

export async function readSession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await sessionKey(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.sid !== "string" || typeof payload.email !== "string") return null;
    return {
      sub: payload.sub,
      sid: payload.sid,
      email: payload.email,
      admin: payload.admin === true,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = 60 * 60 * 24 * SESSION_DAYS) {
  return {
    httpOnly: true,
    secure: isHttpsApp(),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
