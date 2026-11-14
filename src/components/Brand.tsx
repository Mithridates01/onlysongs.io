import Link from "next/link";

// The OnlySongs mark: a small lavender orb, the same motif as the dashboard.
export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <defs>
          <radialGradient id="brand-orb" cx="50%" cy="45%" r="50%">
            <stop offset="0" stopColor="#ECE8FF" />
            <stop offset=".45" stopColor="#B4A8F5" />
            <stop offset="1" stopColor="#8F80E8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="15" cy="15" r="14" fill="url(#brand-orb)" />
        <circle cx="15" cy="15" r="14" fill="none" stroke="#B4A8F5" strokeOpacity=".35" />
      </svg>
      OnlySongs
    </Link>
  );
}
