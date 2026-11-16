import Link from "next/link";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/listening", label: "Listening" },
] as const;

export function AdminTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav className="seg" aria-label="Admin sections" style={{ marginBottom: 24 }}>
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className="seg-link" aria-current={tab.href === current ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
