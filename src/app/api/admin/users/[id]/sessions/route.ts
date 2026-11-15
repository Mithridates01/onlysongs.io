import { json, requireOperator } from "@/lib/http";
import { revokeUserSessions } from "@/lib/sessions";

// Operator action: end every session for one user.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Anyone else, signed in or not, gets the same answer as a missing route.
  if (!(await requireOperator())) return json({ error: "Not found." }, 404);
  const { id } = await params;
  const ended = await revokeUserSessions(id);
  return json({ ok: true, ended });
}
