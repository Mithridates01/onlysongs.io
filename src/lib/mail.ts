import nodemailer from "nodemailer";
import { appUrl } from "./env";
import { log } from "./log";

export type Email = { subject: string; text: string };

export async function sendEmail(to: string, email: Email): Promise<void> {
  if (!process.env.SMTP_HOST) {
    // Locally without Mailpit, the log line carries the message so links still work.
    log.info("email not sent; SMTP is not configured", { to, subject: email.subject, body: email.text });
    return;
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined,
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "OnlySongs <no-reply@onlysongs.local>",
    to,
    subject: email.subject,
    text: email.text,
  });
  log.info("email sent", { subject: email.subject });
}

export function noticeEmail(kind: "broken" | "quota"): Email {
  return kind === "broken"
    ? {
        subject: "Reconnect Spotify — OnlySongs",
        text: `Spotify revoked access, so the blocker is off.\n\nReconnect at ${appUrl()}/account`,
      }
    : {
        subject: "Spotify quota pause — OnlySongs",
        text: `Spotify asked this app to stop for an hour (quota exceeded).\n\nThe blocker will resume on its own. Status: ${appUrl()}/dashboard`,
      };
}

export function verifyEmail(link: string): Email {
  return {
    subject: "Confirm your email — OnlySongs",
    text: `Confirm this address for your OnlySongs account:\n\n${link}\n\nThe link works once and expires in 24 hours. If you did not sign up, ignore this email.`,
  };
}

export function resetEmail(link: string): Email {
  return {
    subject: "Reset your password — OnlySongs",
    text: `Choose a new OnlySongs password:\n\n${link}\n\nThe link works once and expires in 1 hour. If you did not ask for this, ignore this email; your password stays the same.`,
  };
}

export async function notifyUser(to: string, kind: "broken" | "quota"): Promise<void> {
  await sendEmail(to, noticeEmail(kind));
}
