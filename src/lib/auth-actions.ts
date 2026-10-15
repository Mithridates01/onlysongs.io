import bcrypt from "bcryptjs";
import { issueToken } from "./auth-tokens";
import { adminEmail, appUrl } from "./env";
import { log } from "./log";
import { resetEmail, sendEmail, verifyEmail } from "./mail";
import { prisma } from "./db";
import { startSession } from "./sessions";

export async function createUser(email: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.create({
    data: {
      email,
      passwordHash,
      isAdmin: adminEmail() === email,
      settings: { create: {} },
      poll: { create: {} },
    },
  });
}

export async function verifyLogin(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return null;
  if (adminEmail() === email && !user.isAdmin) {
    return prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
  }
  return user;
}

export async function sessionFor(user: { id: string; email: string; isAdmin: boolean }, request?: Request) {
  return startSession(user, request?.headers.get("user-agent"));
}

export async function nextPath(userId: string): Promise<string> {
  const connection = await prisma.spotifyConnection.findUnique({ where: { userId } });
  if (connection?.refreshTokenEnc && connection.status !== "broken") return "/dashboard";
  return "/onboarding";
}

// Email failures are logged, not thrown: the account action still succeeds and
// the user can ask for another link.
export async function sendVerification(user: { id: string; email: string }): Promise<boolean> {
  try {
    const token = await issueToken(user.id, "verify_email");
    await sendEmail(user.email, verifyEmail(`${appUrl()}/verify-email?token=${token}`));
    return true;
  } catch (error) {
    log.error("verification email failed", { message: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

export async function sendPasswordReset(user: { id: string; email: string }): Promise<boolean> {
  try {
    const token = await issueToken(user.id, "reset_password");
    await sendEmail(user.email, resetEmail(`${appUrl()}/reset-password?token=${token}`));
    return true;
  } catch (error) {
    log.error("password reset email failed", { message: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

export async function setPassword(userId: string, password: string): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}
