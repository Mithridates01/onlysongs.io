import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/http";
import { resultLabel } from "@/lib/outcomes";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const session = await currentSession();
  if (!session) return null;
  const params = await searchParams;
  const before = params.before && !Number.isNaN(Date.parse(params.before)) ? new Date(params.before) : null;
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await prisma.activityLog.findMany({
    where: {
      userId: session.sub,
      at: { gte: cutoff, ...(before ? { lt: before } : {}) },
    },
    orderBy: { at: "desc" },
    take: 50,
  });
  const nextBefore = rows.length === 50 ? rows[rows.length - 1]?.at.toISOString() : null;
  const csv = before ? `/api/activity?format=csv&before=${encodeURIComponent(before.toISOString())}` : "/api/activity?format=csv";

  return (
    <>
      <div className="spread">
        <div>
          <h1 className="page-title">Activity</h1>
          <p className="lede">Swaps and skips from the last 90 days, newest first.</p>
        </div>
        <a className="btn secondary" href={csv}>
          Export CSV
        </a>
      </div>
      {rows.length === 0 ? (
        <section className="card">
          <p>No swaps yet. Music that plays normally is not listed.</p>
        </section>
      ) : (
        <section className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Show</th>
                <th>Episode</th>
                <th>Device</th>
                <th>Action</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <LocalTime iso={row.at.toISOString()} />
                  </td>
                  <td>{row.showName ?? "—"}</td>
                  <td>{row.episodeName ?? "—"}</td>
                  <td>{row.deviceName ?? "—"}</td>
                  <td>{row.action}</td>
                  <td>
                    {resultLabel(row.result)}
                    {row.httpStatus ? <span className="muted"> · {row.httpStatus}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {nextBefore ? (
        <p style={{ marginTop: 16 }}>
          <Link href={`/activity?before=${encodeURIComponent(nextBefore)}`}>Older</Link>
        </p>
      ) : null}
    </>
  );
}
