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
