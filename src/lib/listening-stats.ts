// Summaries of listening history for the admin Listening tab.
import { DAY_MS } from "./day";
import { prisma } from "./db";

export type Ranked = { name: string; count: number };

export type ListeningStats = {
  rows: number;
  people: number;
  kinds: Ranked[];
  topArtists: Ranked[];
  topTracks: Ranked[];
  topShows: Ranked[];
  devices: Ranked[];
  contexts: Ranked[];
  // 24 counts, index = hour of day in each listener's own time zone.
  hours: number[];
  shuffleShare: number | null;
};

const ranked = (rows: { name: string | null; count: bigint }[]): Ranked[] =>
  rows.filter((row) => row.name).map((row) => ({ name: row.name!, count: Number(row.count) }));

// Plays (rows) over the last `days`, nothing-playing rows left out.
export async function loadListeningStats(days = 30, now = new Date()): Promise<ListeningStats> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const [totals, kinds, artists, tracks, shows, devices, contexts, hours, shuffle] = await Promise.all([
    prisma.$queryRaw<{ rows: bigint; people: bigint }[]>`
      SELECT count(*) AS rows, count(DISTINCT user_id) AS people
      FROM listening_events WHERE at >= ${since} AND kind <> 'none'`,
    prisma.$queryRaw<{ name: string | null; count: bigint }[]>`
      SELECT kind AS name, count(*) AS count FROM listening_events
      WHERE at >= ${since} AND kind <> 'none' GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ name: string | null; count: bigint }[]>`
      SELECT split_part(artists, ', ', 1) AS name, count(*) AS count FROM listening_events
      WHERE at >= ${since} AND kind = 'track' AND artists IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    prisma.$queryRaw<{ name: string | null; count: bigint }[]>`
      SELECT title || ' — ' || coalesce(split_part(artists, ', ', 1), '') AS name, count(*) AS count FROM listening_events
      WHERE at >= ${since} AND kind = 'track' AND title IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    prisma.$queryRaw<{ name: string | null; count: bigint }[]>`
      SELECT show_name AS name, count(*) AS count FROM listening_events
      WHERE at >= ${since} AND kind IN ('episode', 'audiobook') AND show_name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    prisma.$queryRaw<{ name: string | null; count: bigint }[]>`
      SELECT lower(device_type) AS name, count(*) AS count FROM listening_events
      WHERE at >= ${since} AND kind <> 'none' AND device_type IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ name: string | null; count: bigint }[]>`
      SELECT coalesce(context_type, 'none') AS name, count(*) AS count FROM listening_events
      WHERE at >= ${since} AND kind <> 'none' GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ hour: number; count: bigint }[]>`
      SELECT extract(hour FROM at AT TIME ZONE coalesce(time_zone, 'UTC'))::int AS hour, count(*) AS count
      FROM listening_events WHERE at >= ${since} AND kind <> 'none' GROUP BY 1`.catch(() => [] as { hour: number; count: bigint }[]),
    prisma.$queryRaw<{ on: bigint; known: bigint }[]>`
      SELECT count(*) FILTER (WHERE shuffle) AS on, count(shuffle) AS known
      FROM listening_events WHERE at >= ${since} AND kind = 'track'`,
  ]);
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const row of hours) byHour[row.hour] = Number(row.count);
  const known = Number(shuffle[0]?.known ?? 0);
  return {
    rows: Number(totals[0]?.rows ?? 0),
    people: Number(totals[0]?.people ?? 0),
    kinds: ranked(kinds),
    topArtists: ranked(artists),
    topTracks: ranked(tracks),
    topShows: ranked(shows),
    devices: ranked(devices),
    contexts: ranked(contexts),
    hours: byHour,
    shuffleShare: known ? Number(shuffle[0]?.on ?? 0) / known : null,
  };
}

// Rows and the latest row per account, for the per-account table.
export async function loadListeningByUser(): Promise<Map<string, { rows: number; last: Date | null }>> {
  const rows = await prisma.listeningEvent.groupBy({ by: ["userId"], _count: { _all: true }, _max: { at: true } });
  return new Map(rows.map((row) => [row.userId, { rows: row._count._all, last: row._max.at }]));
}
