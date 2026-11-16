// Listening history from the player reads the background checks already make.
// No extra Spotify calls. A row is saved only when what's playing changes, and
// only while both the platform switch and the account's switch are on.
import { prisma } from "./db";

export const HISTORY_SETTING = "listening_history";
export const HISTORY_KEEP_DAYS = 365;

export type ListeningSnapshot = {
  kind: "track" | "episode" | "audiobook" | "ad" | "unknown" | "none";
  itemUri: string | null;
  title: string | null;
  artists: string | null;
  album: string | null;
  showName: string | null;
  durationMs: number | null;
  progressMs: number | null;
  contextType: string | null;
  contextUri: string | null;
  deviceName: string | null;
  deviceType: string | null;
  volumePercent: number | null;
  shuffle: boolean | null;
  repeatState: string | null;
};

type Body = {
  is_playing?: unknown;
  currently_playing_type?: unknown;
  progress_ms?: unknown;
  shuffle_state?: unknown;
  repeat_state?: unknown;
  context?: { type?: unknown; uri?: unknown } | null;
  device?: { name?: unknown; type?: unknown; volume_percent?: unknown } | null;
  item?: {
    type?: unknown;
    uri?: unknown;
    name?: unknown;
    duration_ms?: unknown;
    artists?: { name?: unknown }[];
    album?: { name?: unknown };
    show?: { name?: unknown };
    audiobook?: { name?: unknown };
    authors?: { name?: unknown }[];
  } | null;
};

const text = (value: unknown, max = 300): string | null => (typeof value === "string" && value ? value.slice(0, max) : null);
const int = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null);
const names = (list: { name?: unknown }[] | undefined): string | null =>
  text((list ?? []).map((entry) => text(entry.name)).filter(Boolean).join(", "));

const NOTHING: ListeningSnapshot = {
  kind: "none",
  itemUri: null,
  title: null,
  artists: null,
  album: null,
  showName: null,
  durationMs: null,
  progressMs: null,
  contextType: null,
  contextUri: null,
  deviceName: null,
  deviceType: null,
  volumePercent: null,
  shuffle: null,
  repeatState: null,
};

// What the player shows right now. A paused player counts as nothing playing.
export function snapshot(raw: unknown): ListeningSnapshot {
  const body = (raw && typeof raw === "object" ? raw : {}) as Body;
  if (body.is_playing !== true) return NOTHING;
  const item = body.item ?? null;
  const playing = text(body.currently_playing_type);
  const itemType = text(item?.type);
  const uri = text(item?.uri);
  const kind: ListeningSnapshot["kind"] =
    playing === "ad"
      ? "ad"
      : itemType === "track" || uri?.startsWith("spotify:track:")
        ? "track"
        : itemType === "episode" || uri?.startsWith("spotify:episode:")
          ? item?.audiobook
            ? "audiobook"
            : "episode"
          : itemType === "chapter" || item?.audiobook
            ? "audiobook"
            : "unknown";
  return {
    kind,
    itemUri: uri,
    title: text(item?.name),
    artists: kind === "track" ? names(item?.artists) : kind === "audiobook" ? names(item?.authors) : null,
    album: kind === "track" ? text(item?.album?.name) : null,
    showName: text(item?.show?.name) ?? text(item?.audiobook?.name),
    durationMs: int(item?.duration_ms),
    progressMs: int(body.progress_ms),
    contextType: text(body.context?.type, 40),
    contextUri: text(body.context?.uri),
    deviceName: text(body.device?.name, 120),
    deviceType: text(body.device?.type, 40),
    volumePercent: int(body.device?.volume_percent),
    shuffle: typeof body.shuffle_state === "boolean" ? body.shuffle_state : null,
    repeatState: text(body.repeat_state, 20),
  };
}

// Two reads are "the same" when the same item is playing (or nothing is).
// Volume, device or progress changes alone don't make a new row.
export function changeKey(snap: Pick<ListeningSnapshot, "kind" | "itemUri" | "title">): string {
  if (snap.kind === "none") return "none";
  return `${snap.kind}:${snap.itemUri ?? snap.title ?? ""}`;
}

// The platform switch, cached briefly so a check every few seconds per user
// doesn't read it every time; a change reaches the worker within 30 seconds.
// It starts off.
const CACHE_MS = 30_000;
let cached: { on: boolean; at: number } | null = null;

export async function historyCollectionOn(now = Date.now(), opts?: { fresh?: boolean }): Promise<boolean> {
  if (!opts?.fresh && cached && now - cached.at < CACHE_MS) return cached.on;
  const row = await prisma.appSetting.findUnique({ where: { key: HISTORY_SETTING } });
  const on = (row?.value as { on?: unknown } | null)?.on === true;
  cached = { on, at: now };
  return on;
}

export async function setHistoryCollection(on: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: HISTORY_SETTING },
    create: { key: HISTORY_SETTING, value: { on } },
    update: { value: { on } },
  });
  cached = null;
}

// Called by every check that read the player. Writes only on a change.
// "nothing playing" is saved once after something played, never as a first row.
export async function recordListening(
  user: { id: string; historyEnabled: boolean; timeZone: string | null },
  body: unknown,
  now = new Date(),
): Promise<boolean> {
  if (!user.historyEnabled || !(await historyCollectionOn(now.getTime()))) return false;
  const snap = snapshot(body);
  const last = await prisma.listeningEvent.findFirst({
    where: { userId: user.id },
    orderBy: { at: "desc" },
    select: { kind: true, itemUri: true, title: true },
  });
  const key = changeKey(snap);
  if (last ? changeKey({ kind: last.kind as ListeningSnapshot["kind"], itemUri: last.itemUri, title: last.title }) === key : key === "none") {
    return false;
  }
  await prisma.listeningEvent.create({ data: { userId: user.id, at: now, timeZone: user.timeZone, ...snap } });
  return true;
}

export async function purgeListening(userId?: string): Promise<number> {
  const result = await prisma.listeningEvent.deleteMany({ where: userId ? { userId } : {} });
  return result.count;
}
