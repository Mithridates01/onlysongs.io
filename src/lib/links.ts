export const SPOTIFY_DASHBOARD_URL = "https://developer.spotify.com/dashboard";

// Starts Spotify sign-in with a POST, for buttons that sit inside another form.
export function startSpotifyConnect(): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/api/spotify/connect";
  document.body.appendChild(form);
  form.submit();
}
