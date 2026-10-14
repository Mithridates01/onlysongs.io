import { json, requireUser } from "@/lib/http";
import { applySettings, type SettingsPatch } from "@/lib/settings";
import { buildStatus } from "@/lib/status";
import type { AllowedShowView, ReplacementView } from "@/lib/types";

export async function GET() {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const status = await buildStatus(user.id);
  if (!status) return json({ error: "Account setup is incomplete." }, 400);
  return json({
    enabled: status.blockerEnabled,
    intervalSeconds: status.intervalSeconds,
    blockPodcasts: status.blockPodcasts,
    blockAudiobooks: status.blockAudiobooks,
    timeZone: status.timeZone,
    quietHours: status.quietHours,
    allowedShows: status.allowedShows,
    replacement: status.replacement,
  });
}

export async function PUT(request: Request) {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Settings must be JSON." }, 400);
  }
  const patch = readPatch(body);
  if (!patch) return json({ error: "Settings must be a JSON object." }, 400);
  const saved = await applySettings(user.id, patch);
  if (!saved.ok) return json({ error: saved.error }, saved.status);
  return json({ ok: true, warning: saved.warning ?? null });
}

function readPatch(body: unknown): SettingsPatch | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const patch: SettingsPatch = {};
  if ("enabled" in record) patch.enabled = record.enabled === true;
  if ("intervalSeconds" in record) {
    patch.intervalSeconds = typeof record.intervalSeconds === "number" ? record.intervalSeconds : Number.NaN;
  }
  if ("blockPodcasts" in record) patch.blockPodcasts = record.blockPodcasts === true;
  if ("blockAudiobooks" in record) patch.blockAudiobooks = record.blockAudiobooks === true;
  if ("timeZone" in record && typeof record.timeZone === "string") patch.timeZone = record.timeZone;
  if ("quietHours" in record) {
    patch.quietHours = readQuiet(record.quietHours);
    if (record.quietHours !== null && patch.quietHours === null) return null;
  }
  if ("allowedShows" in record) {
    if (!Array.isArray(record.allowedShows)) return null;
    patch.allowedShows = record.allowedShows as AllowedShowView[];
  }
  if ("replacement" in record) {
    patch.replacement = readReplacement(record.replacement);
    if (record.replacement !== null && patch.replacement === null) return null;
  }
  return patch;
}

function readQuiet(value: unknown): { start: string; end: string } | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") return null;
  const record = value as { start?: unknown; end?: unknown };
  if (typeof record.start !== "string" || typeof record.end !== "string") return null;
  return { start: record.start, end: record.end };
}

function readReplacement(value: unknown): ReplacementView | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") return null;
  const record = value as { uri?: unknown; label?: unknown; art?: unknown; kind?: unknown };
  if (typeof record.uri !== "string" || typeof record.label !== "string") return null;
  if (record.kind !== "track" && record.kind !== "playlist" && record.kind !== "album") return null;
  return {
    uri: record.uri,
    label: record.label,
    art: typeof record.art === "string" ? record.art : null,
    kind: record.kind,
  };
}
