import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminCharts } from "@/components/AdminCharts";
import { EarlyAccessRequests } from "@/components/EarlyAccessRequests";
import { earlyAccessStats, loadHealth, loadRetention, loadSwapSeries, loadTopShows } from "@/lib/admin-metrics";
import { loadSeries } from "@/lib/admin-stats";
import { EndSessionsButton } from "@/components/EndSessionsButton";
import { LocalTime } from "@/components/LocalTime";
import { isOperator } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/http";
import { readEmailCounts } from "@/lib/mail-stats";
import { readWorkerHeart } from "@/lib/redis";
import { funnel, setupStage } from "@/lib/setup-stage";

export default async function AdminPage() {
  const session = await currentSession();
  if (!session) return null;
  const me = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!isOperator(me)) notFound();

  const now = new Date();
  const [users, counts, lastSeen, worker, requests, allRequests, series, swaps, health, retention, topShows, mail] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: { spotify: true, settings: true, poll: true },
    }),
    prisma.activityLog.groupBy({
      by: ["userId"],
      where: { result: { in: ["replaced", "replaced_via_next"] } },
      _count: { _all: true },
    }),
    prisma.session.groupBy({ by: ["userId"], _max: { lastSeenAt: true } }),
    readWorkerHeart(),
    prisma.earlyAccessRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.earlyAccessRequest.findMany({ select: { status: true, createdAt: true, decidedAt: true, inviteExpiresAt: true } }),
    loadSeries(90),
    loadSwapSeries(90),
    loadHealth(now),
    loadRetention(now),
    loadTopShows(),
    readEmailCounts(7),
  ]);
  // Waiting requests first, then invites, then everything settled.
  const rank = { pending: 0, invited: 1, declined: 2, joined: 3 } as const;
  const requestRows = requests
    .sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt.getTime() - a.createdAt.getTime())
    .map((row) => ({
      id: row.id,
      email: row.email,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      inviteExpiresAt: row.inviteExpiresAt?.toISOString() ?? null,
    }));
  const blocked = new Map(counts.map((row) => [row.userId, row._count._all]));
  const seen = new Map(lastSeen.map((row) => [row.userId, row._max.lastSeenAt]));
  const stages = new Map(
    users.map((user) => [
      user.id,
      setupStage({
        spotify: user.spotify ? { status: user.spotify.status, hasRefreshToken: Boolean(user.spotify.refreshTokenEnc) } : null,
        hasSong: Boolean(user.settings?.replacementUri),
        enabled: Boolean(user.settings?.enabled),
        swaps: blocked.get(user.id) ?? 0,
      }),
    ]),
  );
  const steps = funnel([...stages.values()]);
  const invites = earlyAccessStats(allRequests, now);
  const healthRows: { label: string; value: number | string; bad?: boolean; help: string }[] = [
    { label: "Blockers on", value: health.blockersOn, help: `of ${users.length} accounts` },
    { label: "Running behind", value: health.behind, bad: health.behind > 0, help: "on, but no recent check" },
    { label: "Failing checks", value: health.failing, bad: health.failing > 0, help: "several failures in a row" },
    { label: "Spotify access lost", value: health.broken, bad: health.broken > 0, help: "need to reconnect" },
    { label: "Paused by Spotify", value: health.paused, help: "rate limit or quota" },
    { label: "Errors, 24 hours", value: health.errors24h, bad: health.errors24h > 0, help: `${health.rateLimited24h} rate limited` },
    {
      label: "Emails, 7 days",
      value: mail ? mail.sent : "—",
      bad: Boolean(mail?.failed),
      help: mail ? `${mail.failed} failed` : "not counted",
    },
  ];

  return (
    <>
      <p className="eyebrow">Operator</p>
      <h1 className="page-title">Admin</h1>
      <p className="lede">
        Worker {worker.online ? "is checking in" : "has no recent heartbeat"}. {health.blockersOn} blocker
        {health.blockersOn === 1 ? "" : "s"} enabled of {users.length} accounts.
      </p>
      <section className="card" aria-labelledby="health-h" style={{ marginBottom: 20 }}>
        <h2 id="health-h">Service health</h2>
        <div className="metric-grid">
          {healthRows.map((row) => (
            <div key={row.label} className="metric">
              <span className="label">{row.label}</span>
              <strong className={row.bad ? "bad" : undefined}>{row.value}</strong>
              <span className="help">{row.help}</span>
            </div>
          ))}
        </div>
      </section>
      <AdminCharts series={series} swaps={swaps} pending={requestRows.filter((row) => row.status === "pending").length} />
      <div className="admin-pair">
        <section className="card" aria-labelledby="funnel-h">
          <h2 id="funnel-h">Setup funnel</h2>
          <p className="help" style={{ margin: 0 }}>
            How far every account has got. The biggest drop is where people get stuck.
          </p>
          <div className="stack" style={{ gap: 10 }}>
            {steps.map((step, i) => {
              const share = steps[0].count ? step.count / steps[0].count : 0;
              const lost = i > 0 ? steps[i - 1].count - step.count : 0;
              return (
                <div key={step.step}>
                  <div className="spread" style={{ fontSize: 14 }}>
                    <span>{step.step}</span>
                    <span className="mono">
                      {step.count}
                      {lost > 0 ? <span className="muted"> · −{lost}</span> : null}
                    </span>
                  </div>
                  <div className="bar" aria-hidden="true">
                    <div style={{ width: `${Math.round(share * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card" aria-labelledby="usage-h">
          <h2 id="usage-h">Coming back</h2>
          <div className="metric-grid">
            <div className="metric">
              <span className="label">Active, 7 days</span>
              <strong>{retention.weekly}</strong>
            </div>
            <div className="metric">
              <span className="label">Active, 30 days</span>
              <strong>{retention.monthly}</strong>
            </div>
            <div className="metric">
              <span className="label">Came back after a week</span>
              <strong>{retention.cameBack ? `${Math.round((retention.cameBack.returned / retention.cameBack.eligible) * 100)}%` : "—"}</strong>
              <span className="help">
                {retention.cameBack
                  ? `${retention.cameBack.returned} of ${retention.cameBack.eligible} accounts 8–90 days old`
                  : "No accounts old enough yet"}
              </span>
            </div>
          </div>
          <h2 style={{ marginTop: 8 }}>Most swapped, 30 days</h2>
          {topShows.length === 0 ? (
            <p className="help">Nothing swapped yet.</p>
          ) : (
            <div>
              {topShows.map((row) => (
                <div key={row.show} className="list-row" style={{ justifyContent: "space-between", padding: "10px 0" }}>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{row.show}</span>
                  <span className="mono">{row.swaps}</span>
                </div>
              ))}
            </div>
          )}
          <p className="help" style={{ margin: 0 }}>
            Totals across everyone; no one’s listening is shown.
          </p>
        </section>
      </div>
      <div style={{ marginTop: 20 }}>
        <EarlyAccessRequests initial={requestRows} stats={invites} />
      </div>
      <section className="card table-wrap" style={{ marginTop: 20 }}>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Setup</th>
              <th>Signed up</th>
              <th>Last seen</th>
              <th>Spotify</th>
              <th>Blocker</th>
              <th>Failures</th>
              <th>Last check</th>
              <th>Blocked</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const stage = stages.get(user.id);
              return (
                <tr key={user.id}>
                  <td>
                    <Link href={`/admin/users/${user.id}`}>{user.email}</Link>
                    {user.isAdmin ? <span className="muted"> · admin</span> : null}
                    {user.emailVerifiedAt ? null : <span className="muted"> · email not confirmed</span>}
                  </td>
                  <td>{stage ? <span className={`pill ${stage.tone}`}>{stage.label}</span> : null}</td>
                  <td>
                    <LocalTime iso={user.createdAt.toISOString()} />
                  </td>
                  <td>
                    <LocalTime iso={seen.get(user.id)?.toISOString()} />
                  </td>
                  <td>{user.spotify?.status ?? "none"}</td>
                  <td>{user.settings?.enabled ? `On · ${user.settings.intervalSeconds}s` : "Off"}</td>
                  <td>{user.poll?.consecutiveFailures ?? 0}</td>
                  <td>
                    <LocalTime iso={user.poll?.lastCheckedAt?.toISOString()} />
                  </td>
                  <td>{blocked.get(user.id) ?? 0}</td>
                  <td>
                    <EndSessionsButton userId={user.id} />
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
