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
      <div className="spread" style={{ alignItems: "flex-end", marginBottom: 28 }}>
        <div>
          <p className="eyebrow">Last 90 days</p>
          <h1 className="page-title">Activity</h1>
          <p className="lede" style={{ margin: 0 }}>
            Each time OnlySongs stepped in, newest first.
          </p>
        </div>
        <a className="btn secondary" href={csv}>
          Export CSV
        </a>
      </div>
      {rows.length === 0 ? (
        <section className="card">
          <p>Nothing yet. Music that plays normally isn’t listed here.</p>
        </section>
      ) : (
        <section className="card" style={{ gap: 0, padding: "8px 24px" }}>
          {rows.map((row, index) => {
            const swapped = row.result === "replaced" || row.result === "replaced_via_next";
            const kept = row.result === "allow_listed";
            return (
              <div key={row.id} className="list-row" style={index === 0 ? { borderTop: 0 } : undefined}>
                <span className="mono" style={{ width: 150, flex: "none", color: "var(--muted)" }}>
                  <LocalTime iso={row.at.toISOString()} />
                </span>
                <div className="row" style={{ flex: "1 1 320px", minWidth: 0, flexWrap: "nowrap", gap: 14 }}>
                  <span className={kept ? "dot" : "dot apricot"} aria-hidden="true" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, lineHeight: 1.4 }}>{row.episodeName ?? (row.action === "error" ? "Spotify paused checks" : "—")}</div>
                    <div className="help" style={{ fontSize: 13 }}>
                      {[row.showName, row.deviceName].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                </div>
                <span className={swapped ? "pill good" : "pill"} style={{ flex: "none" }}>
                  {swapped ? (row.result === "replaced" ? "Back to your song" : "Skipped ahead") : resultLabel(row.result)}
                  {row.httpStatus && !swapped ? <span className="muted"> · {row.httpStatus}</span> : null}
                </span>
              </div>
            );
          })}
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
