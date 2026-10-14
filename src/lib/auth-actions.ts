import bcrypt from "bcryptjs";
import { adminEmail } from "./env";
import { prisma } from "./db";
import { signSession } from "./session";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) return null;
  return email;
}

export function checkPassword(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) return null;
  return value;
}

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

export async function sessionFor(user: { id: string; email: string; isAdmin: boolean }) {
  return signSession({ sub: user.id, email: user.email, admin: user.isAdmin });
}

export async function nextPath(userId: string): Promise<string> {
  const connection = await prisma.spotifyConnection.findUnique({ where: { userId } });
  if (connection?.refreshTokenEnc && connection.status !== "broken") return "/dashboard";
  return "/onboarding";
}
