// A same-site path to return to after sign-in, or null. Anything that could
// leave the site ("//evil.com", "/\evil.com", "https://...") is refused.
export function safeNextPath(value: string | string[] | undefined | null): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  return value;
}
