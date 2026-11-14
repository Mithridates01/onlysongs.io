import { currentSession, json } from "@/lib/http";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { revokeSession, revokeUserSessions } from "@/lib/sessions";

// POST ends this session. POST ?scope=others ends every other session for the
// account and keeps this one signed in.
export async function POST(request: Request) {
  const session = await currentSession();
  const others = new URL(request.url).searchParams.get("scope") === "others";
  if (others) {
    if (!session) return json({ error: "Sign in required." }, 401);
    const ended = await revokeUserSessions(session.sub, session.sid);
    return json({ ok: true, ended });
  }
  if (session) await revokeSession(session.sid);
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return response;
}
