import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { CollectSwitch, PurgeButton } from "@/components/ListeningControls";
import { LocalTime } from "@/components/LocalTime";
import { isOperator } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/http";
import { HISTORY_KEEP_DAYS, historyCollectionOn } from "@/lib/listening";
import { loadListeningByUser, loadListeningStats, type Ranked } from "@/lib/listening-stats";

const KIND: Record<string, string> = { track: "Music", episode: "Podcasts", audiobook: "Audiobooks", ad: "Ads", unknown: "Other", none: "Stopped" };

// Operator only: listening history collected by the background checks.
export default async function ListeningPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const session = await currentSession();
  if (!session) return null;
  const me = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!isOperator(me)) notFound();

  const { user: userId } = await searchParams;
  if (userId) return <UserHistory userId={userId} />;

  const [on, stats, byUser, users] = await Promise.all([
    historyCollectionOn(Date.now(), { fresh: true }),
    loadListeningStats(30),
    loadListeningByUser(),
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, email: true, historyEnabled: true } }),
  ]);
  const peak = Math.max(1, ...stats.hours);
  const total = stats.kinds.reduce((sum, row) => sum + row.count, 0);

  return (
    <>
      <p className="eyebrow">Operator</p>
      <h1 className="page-title">Admin</h1>
      <AdminTabs current="/admin/listening" />

      <section className="card" aria-labelledby="collect-h">
        <h2 id="collect-h">Listening history</h2>
        <p className="help" style={{ margin: 0 }}>
          Saved from the checks the worker already makes, only when what’s playing changes. Checks run while someone’s blocker is on and outside quiet
          hours. Rows older than {HISTORY_KEEP_DAYS} days are deleted. Only operators can see this.
        </p>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <CollectSwitch initial={on} />
          <PurgeButton />
        </div>
      </section>

      <section className="card" aria-labelledby="summary-h" style={{ marginTop: 20 }}>
        <h2 id="summary-h">Last 30 days</h2>
        <div className="metric-grid">
          <div className="metric">
            <span className="label">Plays recorded</span>
            <strong>{stats.rows}</strong>
          </div>
          <div className="metric">
            <span className="label">Listeners</span>
            <strong>{stats.people}</strong>
          </div>
          {stats.kinds.map((row) => (
            <div key={row.name} className="metric">
              <span className="label">{KIND[row.name] ?? row.name}</span>
              <strong>{total ? Math.round((row.count / total) * 100) : 0}%</strong>
              <span className="help">{row.count} plays</span>
            </div>
          ))}
          <div className="metric">
            <span className="label">Shuffle on</span>
            <strong>{stats.shuffleShare === null ? "—" : `${Math.round(stats.shuffleShare * 100)}%`}</strong>
            <span className="help">of songs</span>
          </div>
        </div>
        <div>
          <span className="label">When people listen (their local time)</span>
          <div role="img" aria-label="Plays by hour of day" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 90, marginTop: 10 }}>
            {stats.hours.map((count, hour) => (
              <div
                key={hour}
                title={`${hour}:00 · ${count} plays`}
                style={{ flex: 1, height: `${(count / peak) * 100}%`, minHeight: count ? 2 : 0, borderRadius: "3px 3px 0 0", background: "var(--accent)", opacity: 0.8 }}
              />
            ))}
          </div>
          <div className="mono spread" style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>
            <span>12 am</span>
            <span>6 am</span>
            <span>12 pm</span>
            <span>6 pm</span>
            <span>11 pm</span>
          </div>
        </div>
      </section>

      <div className="admin-pair">
        <RankedList title="Top artists" rows={stats.topArtists} />
        <RankedList title="Top songs" rows={stats.topTracks} />
        <RankedList title="Top podcasts and audiobooks" rows={stats.topShows} />
        <RankedList title="Played from" rows={stats.contexts} hint="playlist, album, artist page, liked songs (collection), or none" />
        <RankedList title="Devices" rows={stats.devices} />
      </div>

      <section className="card table-wrap" style={{ marginTop: 20 }} aria-labelledby="people-h">
        <h2 id="people-h">By account</h2>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Collect</th>
              <th>Rows</th>
              <th>Latest</th>
              <th>History</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const row = byUser.get(user.id);
              return (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>
                    <CollectSwitch userId={user.id} initial={user.historyEnabled} label={`Collect history for ${user.email}`} />
                  </td>
                  <td>{row?.rows ?? 0}</td>
                  <td>
                    <LocalTime iso={row?.last?.toISOString()} />
                  </td>
                  <td className="row" style={{ gap: 16 }}>
                    <Link href={`/admin/listening?user=${encodeURIComponent(user.id)}`}>View</Link>
                    {row?.rows ? <PurgeButton userId={user.id} /> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function RankedList({ title, rows, hint }: { title: string; rows: Ranked[]; hint?: string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {hint ? (
        <p className="help" style={{ margin: 0 }}>
          {hint}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="help">Nothing yet.</p>
      ) : (
        <div>
          {rows.map((row) => (
            <div key={row.name} className="list-row" style={{ justifyContent: "space-between", padding: "10px 0" }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{row.name}</span>
              <span className="mono">{row.count}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

async function UserHistory({ userId }: { userId: string }) {
  const [user, rows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, historyEnabled: true } }),
    prisma.listeningEvent.findMany({ where: { userId }, orderBy: { at: "desc" }, take: 200 }),
  ]);
  if (!user) notFound();
  return (
    <>
      <p className="eyebrow">
        <Link href="/admin/listening">Listening</Link>
      </p>
      <h1 className="page-title" style={{ overflowWrap: "anywhere" }}>
        {user.email}
      </h1>
      <AdminTabs current="/admin/listening" />
      <div className="row" style={{ gap: 16, marginBottom: 20 }}>
        <CollectSwitch userId={user.id} initial={user.historyEnabled} label={`Collect history for ${user.email}`} />
        {rows.length ? <PurgeButton userId={user.id} /> : null}
      </div>
      <section className="card table-wrap">
        <h2>Latest {rows.length} changes</h2>
        {rows.length === 0 ? (
          <p className="help">No history for this account.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>What</th>
                <th>By / show</th>
                <th>From</th>
                <th>Device</th>
                <th>Vol</th>
                <th>Shuffle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <LocalTime iso={row.at.toISOString()} />
                  </td>
                  <td>{KIND[row.kind] ?? row.kind}</td>
                  <td>
                    {row.title ?? "—"}
                    {row.album ? <span className="muted"> · {row.album}</span> : null}
                  </td>
                  <td>{row.artists ?? row.showName ?? "—"}</td>
                  <td>{row.contextType ?? "—"}</td>
                  <td>{[row.deviceName, row.deviceType?.toLowerCase()].filter(Boolean).join(" · ") || "—"}</td>
                  <td>{row.volumePercent ?? "—"}</td>
                  <td>{row.shuffle === null ? "—" : row.shuffle ? "on" : "off"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
