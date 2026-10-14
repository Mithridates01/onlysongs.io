export function appUrl(): string {
  const raw = process.env.APP_URL?.trim() || "http://127.0.0.1:3000";
  return raw.replace(/\/$/, "");
}

export function redirectUri(): string {
  return `${appUrl()}/callback/spotify`;
}

export function adminEmail(): string | null {
  const value = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return value || null;
}

export function isHttpsApp(): boolean {
  return appUrl().startsWith("https://");
}

// A public deployment must be able to send verification and reset links.
// Lives here, not in mail.ts, so instrumentation.ts can import it without
// pulling nodemailer into the edge bundle.
export function assertMailConfigured(): void {
  if (isHttpsApp() && !process.env.SMTP_HOST?.trim()) {
    throw new Error("SMTP_HOST must be set when APP_URL is https://. Verification and password-reset emails need it.");
  }
}
