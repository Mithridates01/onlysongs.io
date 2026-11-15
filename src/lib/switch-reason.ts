import type { ConnectionState } from "./types";

// Why the blocker switch is greyed out, in words the user can act on, or null
// when it can be turned on.
export function switchBlockedReason(connection: ConnectionState, hasSong: boolean, redirectUri: string): string | null {
  if (connection === "disconnected") return "The switch unlocks once you add your Spotify app in Set up Spotify.";
  if (connection === "needs_connect") {
    return `Spotify sign-in didn’t finish. Open Set up Spotify and press Connect. If Spotify shows an error, add ${redirectUri} as a Redirect URI in your Spotify app.`;
  }
  if (connection === "broken") return "Spotify stopped accepting this connection. Reconnect in Set up Spotify to turn the blocker back on.";
  if (!hasSong) return "Pick a replacement song below to turn the blocker on.";
  return null;
}
