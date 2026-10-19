import { createHash, randomBytes } from "node:crypto";
import type { EarlyAccessRequest } from "@prisma/client";
import { createUser } from "./auth-actions";
import { prisma } from "./db";
import { adminEmail, appUrl } from "./env";
import { inviteEmail, sendEmail } from "./mail";

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// SIGNUPS=open lets anyone create an account; anything else (the default)
// means sign-up only through an approved early-access invite.
export function signupsOpen(): boolean {
  return process.env.SIGNUPS?.trim().toLowerCase() === "open";
}

// The operator can always sign up, so an invite-only deploy can't lock them out.
export function canSignUpDirectly(email: string): boolean {
  return signupsOpen() || adminEmail() === email;
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Adds the email to the list. Repeat requests, declined requests and existing
// accounts are all left as they are, so the caller always answers the same way.
export async function requestEarlyAccess(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) return;
  await prisma.earlyAccessRequest.upsert({ where: { email }, create: { email }, update: {} });
}

// Approves (or re-sends) an invite: a fresh 14-day single-use link replaces any
// earlier one. Returns false when the request is gone or already joined.
export async function sendInvite(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const request = await prisma.earlyAccessRequest.findUnique({ where: { id } });
  if (!request) return { ok: false, error: "That request no longer exists." };
  if (request.status === "joined") return { ok: false, error: "That person has already joined." };
  const token = randomBytes(32).toString("base64url");
  await prisma.earlyAccessRequest.update({
    where: { id },
    data: {
      status: "invited",
      decidedAt: new Date(),
      inviteTokenHash: hash(token),
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
  await sendEmail(request.email, inviteEmail(`${appUrl()}/join?token=${token}`));
  return { ok: true };
}

export async function declineRequest(id: string): Promise<void> {
  await prisma.earlyAccessRequest.updateMany({
    where: { id, status: { in: ["pending", "invited"] } },
    data: { status: "declined", decidedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
  });
}

// The request behind a live invite link, or null if it is unknown, used,
// declined or past its 14 days.
export async function findInvite(token: unknown): Promise<EarlyAccessRequest | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const request = await prisma.earlyAccessRequest.findUnique({ where: { inviteTokenHash: hash(token) } });
  if (!request || request.status !== "invited" || !request.inviteExpiresAt || request.inviteExpiresAt <= new Date()) {
    return null;
  }
  return request;
}

// Spends the invite and creates the account. The emailed link proved the
// inbox, so the account starts verified.
export async function acceptInvite(token: unknown, password: string) {
  const request = await findInvite(token);
  if (!request) return null;
  const claimed = await prisma.earlyAccessRequest.updateMany({
    where: { id: request.id, status: "invited", inviteTokenHash: request.inviteTokenHash },
    data: { status: "joined", joinedAt: new Date(), inviteTokenHash: null },
  });
  if (claimed.count !== 1) return null;
  const existing = await prisma.user.findUnique({ where: { email: request.email } });
  if (existing) return null;
  return createUser(request.email, password, { verified: true });
}
