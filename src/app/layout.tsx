import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import "./globals.css";

// Self-hosted by next/font at build time, so the CSP stays font-src 'self'.
const sora = Sora({ subsets: ["latin"], weight: ["200", "300", "400", "500"], variable: "--font-display" });
const geist = Geist({ subsets: ["latin"], variable: "--font-body" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "OnlySongs",
  description: "OnlySongs replaces a playing Spotify podcast or audiobook with a song you chose.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0B0C10", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${geist.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
