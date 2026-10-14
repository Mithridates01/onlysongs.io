const SECRET_KEYS = new Set([
  "access_token",
  "refresh_token",
  "client_secret",
  "authorization",
  "code",
  "code_verifier",
  "password",
  "token",
]);

function sanitize(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key.toLowerCase())) {
      out[key] = "[redacted]";
    } else {
      out[key] = sanitize(inner);
    }
  }
  return out;
}

function write(level: "info" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({
    level,
    msg,
    ...(extra ? (sanitize(extra) as Record<string, unknown>) : {}),
  });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info(msg: string, extra?: Record<string, unknown>) {
    write("info", msg, extra);
  },
  error(msg: string, extra?: Record<string, unknown>) {
    write("error", msg, extra);
  },
};
