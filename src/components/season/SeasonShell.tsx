"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/league", label: "League" },
  { href: "/my-team", label: "My Team" },
  { href: "/free-agents", label: "Free Agents" },
];

export function SeasonShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-4 border-b border-dark-border">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between gap-3 mb-3">
            <Logo size="sm" />
            <span className="text-xs text-gold font-semibold uppercase tracking-wider">
              {title}
            </span>
          </div>
          <nav className="season-nav" aria-label="Season navigation">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`season-nav-link ${pathname === link.href ? "season-nav-link--active" : ""}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">{children}</main>
    </div>
  );
}
