import { json } from "@/lib/http";
import { readWorkerHeart } from "@/lib/jobs";

// For an uptime monitor: 503 when no worker has written a heartbeat in 35s.
// Kept apart from /api/health so a stopped worker never fails web deploys.
export async function GET() {
  const heart = await readWorkerHeart();
  return json(heart, heart.online ? 200 : 503);
}
