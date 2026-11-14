import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Next injects inline scripts and styles, so those stay allowed. Album art
// comes from several Spotify CDNs, so images allow any HTTPS host.
const contentSecurityPolicy = [
  "default-src 'self'",
  // Spotify's embed iFrame API (loader on open.spotify.com, code on its CDN) plays search samples.
  `script-src 'self' 'unsafe-inline' https://open.spotify.com https://embed-cdn.spotifycdn.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  // Search results can be sampled in Spotify's embed player.
  "frame-src https://open.spotify.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  // The Connect Spotify form posts here, then redirects to Spotify's sign-in.
  "form-action 'self' https://accounts.spotify.com",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["bullmq", "ioredis"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
