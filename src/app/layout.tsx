import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OnlySongs",
  description: "OnlySongs replaces a playing Spotify podcast with a song you chose.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
