import { notFound } from "next/navigation";
import { EarlyAccessRequests } from "@/components/EarlyAccessRequests";
import { EndSessionsButton } from "@/components/EndSessionsButton";
import { LocalTime } from "@/components/LocalTime";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/http";
import { readWorkerHeart } from "@/lib/redis";

export default async function AdminPage() {
  const session = await currentSession();
  if (!session) return null;
  const me = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!me?.isAdmin) notFound();

  const [users, counts, worker, requests] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: { spotify: true, settings: true, poll: true },
    }),
    prisma.activityLog.groupBy({
      by: ["userId"],
      where: { result: { in: ["replaced", "replaced_via_next"] } },
      _count: { _all: true },
    }),
    readWorkerHeart(),
    prisma.earlyAccessRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
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
  const enabled = users.filter((user) => user.settings?.enabled).length;

  return (
    <>
      <p className="eyebrow">Operator</p>
      <h1 className="page-title">Admin</h1>
      <p className="lede">
        Worker {worker.online ? "is checking in" : "has no recent heartbeat"}. {enabled} blocker
        {enabled === 1 ? "" : "s"} enabled of {users.length} accounts.
      </p>
      <EarlyAccessRequests initial={requestRows} />
      <section className="card table-wrap" style={{ marginTop: 20 }}>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Spotify</th>
              <th>Blocker</th>
              <th>Failures</th>
              <th>Last check</th>
              <th>Blocked</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.email}
                  {user.isAdmin ? <span className="muted"> · admin</span> : null}
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
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
