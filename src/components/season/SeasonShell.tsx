"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/league", label: "League" },
  { href: "/matchups", label: "Matchups" },
  { href: "/awards", label: "Awards" },
  { href: "/my-team", label: "My Team" },
  { href: "/free-agents", label: "Free Agents" },
  { href: "/draft-recap", label: "Draft Recap" },
];

export function SeasonShell({
  title,
  children,
  isSportsSim = false,
}: {
  title: string;
  children: React.ReactNode;
  /** Sports-sim leagues (SDFL/SDHL/SDBA/SDLB) have no Awards/bonus-pool page. */
  isSportsSim?: boolean;
}) {
  const pathname = usePathname();
  const links = isSportsSim
    ? LINKS.filter((link) => link.href !== "/awards")
    : LINKS;

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
            {links.map((link) => (
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
