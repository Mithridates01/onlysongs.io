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
