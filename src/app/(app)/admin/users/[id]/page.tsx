import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { isOperator } from "@/lib/admin";
import { last4 } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { redirectUri } from "@/lib/env";
import { currentSession } from "@/lib/http";
import { parseQuietHours } from "@/lib/quiet-hours";
import { readWorkerHeart } from "@/lib/redis";
import { readAllowedShows } from "@/lib/shows";
import { diagnose } from "@/lib/support";

const SIGN_IN_WINDOW_MS = 10 * 60 * 1000;

// Operator only: one account's setup and recent checks, with what is stopping
// it spelled out. Shows no secrets: only the Client ID's last four characters.
export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return null;
  const me = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!isOperator(me)) notFound();

  const { id } = await params;
  const [user, worker, activity, sessions] = await Promise.all([
    prisma.user.findUnique({ where: { id }, include: { spotify: true, settings: true, poll: true } }),
    readWorkerHeart(),
    prisma.activityLog.findMany({ where: { userId: id }, orderBy: { at: "desc" }, take: 15 }),
    prisma.session.findMany({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } }),
  ]);
  if (!user?.settings || !user.poll) notFound();
  const { spotify, settings, poll } = user;

  const findings = diagnose(
    {
      emailVerified: Boolean(user.emailVerifiedAt),
      spotify: spotify
        ? {
            status: spotify.status,
            hasRefreshToken: Boolean(spotify.refreshTokenEnc),
            signInStartedAt: spotify.oauthStateExpiresAt ? new Date(spotify.oauthStateExpiresAt.getTime() - SIGN_IN_WINDOW_MS) : null,
            signInExpiresAt: spotify.oauthStateExpiresAt,
          }
        : null,
      settings: {
        enabled: settings.enabled,
        intervalSeconds: settings.intervalSeconds,
        hasSong: Boolean(settings.replacementUri),
        quietHours: settings.quietHours,
        timeZone: settings.timeZone,
      },
      poll: {
        lastCheckedAt: poll.lastCheckedAt,
        consecutiveFailures: poll.consecutiveFailures,
        lastError: poll.lastError,
        pausedUntil: poll.pausedUntil,
        pauseReason: poll.pauseReason,
      },
      workerOnline: worker.online,
    },
    redirectUri(),
  );
  const quiet = parseQuietHours(settings.quietHours);
  const shows = readAllowedShows(settings.allowedShowIds);

  return (
    <>
      <p className="eyebrow">
        <Link href="/admin">Admin</Link> / account
      </p>
      <h1 className="page-title" style={{ fontSize: "clamp(32px, 4vw, 48px)", overflowWrap: "anywhere" }}>
        {user.email}
      </h1>
      <p className="mono muted" style={{ margin: "0 0 24px" }}>
        id {user.id}
      </p>

      <section className="card" aria-labelledby="diag-h" style={{ marginBottom: 20 }}>
        <h2 id="diag-h">What’s going on</h2>
        <ul className="steps">
          {findings.map((finding) => (
            <li key={finding.text}>
              <span className={finding.level === "problem" ? "pill bad" : "pill"} style={{ marginRight: 8 }}>
                {finding.level === "problem" ? "Problem" : "Note"}
              </span>
              {finding.text}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid two even">
        <section className="card">
          <h2>Account</h2>
          <Facts
            rows={[
              ["Created", <LocalTime key="c" iso={user.createdAt.toISOString()} />],
              ["Email confirmed", user.emailVerifiedAt ? <LocalTime key="v" iso={user.emailVerifiedAt.toISOString()} /> : "No"],
              ["Operator", user.isAdmin ? (user.emailVerifiedAt ? "Yes" : "Flagged, not yet verified") : "No"],
              ["Signed-in devices", String(sessions.length)],
              ["Last seen", sessions[0] ? <LocalTime key="s" iso={sessions[0].lastSeenAt.toISOString()} /> : "—"],
            ]}
          />
        </section>
        <section className="card">
          <h2>Spotify</h2>
          <Facts
            rows={[
              ["Status", spotify?.status ?? "no app saved"],
              ["Client ID", spotify ? `····${last4(spotify.clientId)}` : "—"],
              ["Signed in", spotify?.refreshTokenEnc ? "Yes" : "No"],
              ["Spotify user", spotify?.spotifyUserId ?? "—"],
              ["Token expires", spotify?.expiresAt ? <LocalTime key="e" iso={spotify.expiresAt.toISOString()} /> : "—"],
              ["Last sign-in attempt", spotify?.oauthStateExpiresAt ? <LocalTime key="o" iso={new Date(spotify.oauthStateExpiresAt.getTime() - SIGN_IN_WINDOW_MS).toISOString()} /> : "—"],
            ]}
          />
        </section>
        <section className="card">
          <h2>Blocker</h2>
          <Facts
            rows={[
              ["Switch", settings.enabled ? "On" : "Off"],
              ["Checks every", `${settings.intervalSeconds}s`],
              ["Song", settings.replacementLabel ? `${settings.replacementLabel} (${settings.replacementKind})` : "Not picked"],
              ["Blocks", [settings.blockPodcasts && "podcasts", settings.blockAudiobooks && "audiobooks"].filter(Boolean).join(" and ") || "nothing"],
              ["Quiet hours", quiet ? `${quiet.start}–${quiet.end} (${settings.timeZone})` : `Off (${settings.timeZone})`],
              ["Allow list", shows.length ? shows.map((show) => show.name).join(", ") : "Empty"],
            ]}
          />
        </section>
        <section className="card">
          <h2>Checks</h2>
          <Facts
            rows={[
              ["Last check", <LocalTime key="l" iso={poll.lastCheckedAt?.toISOString()} fallback="never" />],
              ["Failures in a row", String(poll.consecutiveFailures)],
              ["Last error", poll.lastError ?? "—"],
              ["Paused until", poll.pausedUntil ? <LocalTime key="p" iso={poll.pausedUntil.toISOString()} /> : "—"],
              ["Now playing", poll.nowPlayingTitle ? `${poll.nowPlayingTitle} (${poll.nowPlayingKind ?? "?"})` : "—"],
              ["Worker", worker.online ? "Online" : "Offline"],
            ]}
          />
        </section>
      </div>

      <section className="card table-wrap" style={{ marginTop: 20 }} aria-labelledby="act-h">
        <h2 id="act-h">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="help">Nothing recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Result</th>
                <th>Device</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((row) => (
                <tr key={row.id}>
                  <td>
                    <LocalTime iso={row.at.toISOString()} />
                  </td>
                  <td>{[row.showName, row.episodeName].filter(Boolean).join(" · ") || row.action}</td>
                  <td>
                    {row.result}
                    {row.httpStatus ? ` (${row.httpStatus})` : ""}
                  </td>
                  <td>{row.deviceName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
