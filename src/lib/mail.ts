import nodemailer from "nodemailer";
import { appUrl } from "./env";
import { log } from "./log";

export async function notifyUser(to: string, kind: "broken" | "quota"): Promise<void> {
  const subject =
    kind === "broken" ? "Reconnect Spotify — Podcast Blocker" : "Spotify quota pause — Podcast Blocker";
  const text =
    kind === "broken"
      ? `Spotify revoked access, so the blocker is off.\n\nReconnect at ${appUrl()}/account`
      : `Spotify asked this app to stop for an hour (quota exceeded).\n\nThe blocker will resume on its own. Status: ${appUrl()}/dashboard`;

  if (!process.env.SMTP_HOST) {
    log.info("email not sent; SMTP is not configured", { kind });
    return;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
      : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
  log.info("email sent", { kind });
}
