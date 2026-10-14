import { json, requireUser } from "@/lib/http";
import { buildStatus } from "@/lib/status";

export async function GET() {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const status = await buildStatus(user.id);
  if (!status) return json({ error: "Account setup is incomplete." }, 400);
  return json(status);
}
