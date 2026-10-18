"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brand } from "./Brand";

const LINKS = [
  ["/dashboard", "Today"],
  ["/activity", "Activity"],
  ["/settings", "Settings"],
  ["/account", "Account"],
];

export function Shell({ admin, children }: { email: string; admin: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const links = admin ? [...LINKS, ["/admin", "Admin"]] : LINKS;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="app">
      <header className="topbar">
        <Brand href="/dashboard" />
        <nav className="nav" aria-label="Main">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? "active" : undefined} aria-current={path === href ? "page" : undefined}>
              {label}
            </Link>
          ))}
          <button type="button" className="linkish" onClick={logout}>
            Sign out
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}
