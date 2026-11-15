// The Content-Security-Policy, built per request in middleware. Scripts run only
// with this request's nonce; 'strict-dynamic' extends trust to the chunks those
// load. Search samples play in Spotify's embed iframe (frame-src), driven by
// postMessage, so no Spotify script runs on our pages. Edge-safe: no Node APIs.
export function buildCsp(nonce: string, dev = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // React's style={} attributes need inline styles.
    "style-src 'self' 'unsafe-inline'",
    // Album art comes from several Spotify CDNs.
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-src https://open.spotify.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    // The Connect Spotify form posts here, then redirects to Spotify's sign-in.
    "form-action 'self' https://accounts.spotify.com",
    "object-src 'none'",
  ].join("; ");
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
