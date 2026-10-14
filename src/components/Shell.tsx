"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  ["/dashboard", "Dashboard"],
  ["/settings", "Settings"],
  ["/activity", "Activity"],
  ["/account", "Account"],
];

export function Shell({
  email,
  admin,
  children,
}: {
  email: string;
  admin: boolean;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/dashboard" className="brand">
          <small>onlysongs.io</small>
          <strong>OnlySongs</strong>
        </Link>
        <nav className="nav">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? "active" : undefined}>
              {label}
            </Link>
          ))}
          {admin ? (
            <Link href="/admin" className={path === "/admin" ? "active" : undefined}>
              Admin
            </Link>
          ) : null}
          <button type="button" className="linkish" onClick={logout}>
            Sign out
          </button>
        </nav>
      </header>
      <p className="help" style={{ marginTop: -12 }}>
        {email}
      </p>
      {children}
    </div>
  );
}
