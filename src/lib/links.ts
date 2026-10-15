export const SPOTIFY_DASHBOARD_URL = "https://developer.spotify.com/dashboard";

const OPENED_KEY = "spotify-dashboard-opened";

export function openSpotifyDashboard(): boolean {
  const tab = window.open(SPOTIFY_DASHBOARD_URL, "_blank", "noopener,noreferrer");
  if (!tab) return false;
  sessionStorage.setItem(OPENED_KEY, "1");
  return true;
}

export function spotifyDashboardAlreadyOpened(): boolean {
  return sessionStorage.getItem(OPENED_KEY) === "1";
}

// Starts Spotify sign-in with a POST, for buttons that sit inside another form.
export function startSpotifyConnect(): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/api/spotify/connect";
  document.body.appendChild(form);
  form.submit();
}
