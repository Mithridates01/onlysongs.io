import nodemailer from "nodemailer";
import { appUrl } from "./env";
import { log } from "./log";
import { recordEmail } from "./mail-stats";

export type Email = { subject: string; text: string };

const RESEND_URL = "https://api.resend.com/emails";

function sender(): string {
  return (
    process.env.MAIL_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "OnlySongs <no-reply@onlysongs.local>"
  );
}

// Resend's HTTPS API when RESEND_API_KEY is set (Railway's Hobby plan blocks
// outbound SMTP), otherwise SMTP (Mailpit locally), otherwise a log line.
export async function sendEmail(to: string, email: Email): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    await counted(sendWithResend(resendKey, to, email));
    log.info("email sent", { via: "resend", subject: email.subject });
    return;
  }
  if (!process.env.SMTP_HOST) {
    // Locally without Mailpit, the log line carries the message so links still work.
    log.info("email not sent; mail is not configured", { to, subject: email.subject, body: email.text });
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
  await counted(transporter.sendMail({ from: sender(), to, subject: email.subject, text: email.text }));
  log.info("email sent", { via: "smtp", subject: email.subject });
}

// Tallies each real send for the admin page, then passes the outcome through.
async function counted<T>(sending: Promise<T>): Promise<T> {
  try {
    const result = await sending;
    await recordEmail(true);
    return result;
  } catch (error) {
    await recordEmail(false);
    throw error;
  }
}

// For emails nobody waits on (confirmations, operator notices): a failure is
// logged and never undoes what triggered it.
export async function sendQuietly(to: string, email: Email, context: Record<string, unknown> = {}): Promise<void> {
  try {
    await sendEmail(to, email);
  } catch (error) {
    log.error("email failed", { ...context, subject: email.subject, message: error instanceof Error ? error.message : "unknown" });
  }
}

async function sendWithResend(apiKey: string, to: string, email: Email): Promise<void> {
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: sender(), to: [to], subject: email.subject, text: email.text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Resend explains the failure (unverified domain, bad key) in the body; never log the key.
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Resend rejected the email (${res.status}): ${detail}`);
  }
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

export function inviteEmail(link: string): Email {
  return {
    subject: "You’re in: finish creating your OnlySongs account",
    text: `Your early access request for OnlySongs was approved.\n\nChoose a password to finish creating your account:\n\n${link}\n\nThe link works once and expires in 14 days. Then we’ll walk you through connecting Spotify.`,
  };
}

export function resetEmail(link: string): Email {
  return {
    subject: "Reset your password — OnlySongs",
    text: `Choose a new OnlySongs password:\n\n${link}\n\nThe link works once and expires in 1 hour. If you did not ask for this, ignore this email; your password stays the same.`,
  };
}

export function requestReceivedEmail(): Email {
  return {
    subject: "You’re on the list — OnlySongs",
    text: `Thanks for asking for early access to OnlySongs.\n\nWe let people in a few at a time. When it’s your turn you’ll get an email with a link to finish creating your account.\n\nIf you didn’t ask for this, ignore this email.`,
  };
}

export function welcomeEmail(): Email {
  return {
    subject: "Welcome to OnlySongs",
    text: `Your OnlySongs account is ready.\n\nNext, connect Spotify and pick a song. It takes about five minutes:\n\n${appUrl()}/onboarding\n\nAfter that, podcasts that start on your Spotify get swapped for your song.`,
  };
}

export function operatorRequestEmail(email: string): Email {
  return {
    subject: `New early access request: ${email}`,
    text: `${email} asked for early access.\n\nApprove or decline: ${appUrl()}/admin#requests`,
  };
}

export function operatorAccountEmail(email: string): Email {
  return {
    subject: `New account: ${email}`,
    text: `${email} just created an OnlySongs account.\n\nSee them: ${appUrl()}/admin`,
  };
}

export async function notifyUser(to: string, kind: "broken" | "quota"): Promise<void> {
  await sendEmail(to, noticeEmail(kind));
}
