import { declineRequest, sendInvite } from "@/lib/early-access";
import { json, parseJson, requireUser } from "@/lib/http";
import { log } from "@/lib/log";
import { adminDecisionBody } from "@/lib/schemas";

// Operator only. "approve" sends (or re-sends) the 14-day invite email.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireUser();
  if (!admin) return json({ error: "Sign in required." }, 401);
  if (!admin.isAdmin) return json({ error: "Not found." }, 404);
  const body = await parseJson(request, adminDecisionBody);
  if (!body.ok) return body.response;
  const { id } = await params;
  if (body.data.action === "decline") {
    await declineRequest(id);
    return json({ ok: true, status: "declined" });
  }
  try {
    const sent = await sendInvite(id);
    if (!sent.ok) return json({ error: sent.error }, 409);
  } catch (error) {
    log.error("invite email failed", { message: error instanceof Error ? error.message : "unknown" });
    return json({ error: "The invite was saved but the email failed to send. Try Resend." }, 502);
  }
  return json({ ok: true, status: "invited" });
}
