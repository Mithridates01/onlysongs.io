import type { ConnectionStatus } from "@prisma/client";
import type { ConnectionState } from "./types";

// What the dashboard and the operator see for a Spotify connection row.
export function connectionState(
  status: ConnectionStatus | undefined,
  hasRefresh: boolean,
  hasRow: boolean,
  quotaPaused: boolean,
): ConnectionState {
  if (!hasRow || !status || status === "disconnected") return "disconnected";
  if (status === "broken") return "broken";
  if (!hasRefresh) return "needs_connect";
  return quotaPaused ? "quota_paused" : "connected";
}
