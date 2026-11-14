import { json, requireUser } from "@/lib/http";
import { revokeUserSessions } from "@/lib/sessions";

// Operator action: end every session for one user.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireUser();
  if (!admin) return json({ error: "Sign in required." }, 401);
  if (!admin.isAdmin) return json({ error: "Not found." }, 404);
  const { id } = await params;
  const ended = await revokeUserSessions(id);
  return json({ ok: true, ended });
}
