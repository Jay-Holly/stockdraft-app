"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { PageWatermark } from "@/components/PageWatermark";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/stockdraft-dfs", label: "Lobby" },
  { href: "/stockdraft-dfs/my-teams", label: "My Teams" },
  { href: "/stockdraft-dfs/free-agents", label: "Free Agents" },
];

export function DfsShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex flex-col">
      <PageWatermark logoSrc="/images/leagues/sddfs.png" />
      <header className="px-4 py-4 border-b border-dark-border">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between gap-3 mb-3">
            <Logo size="sm" />
            <span className="text-xs font-semibold uppercase tracking-wider text-gold">
              {title}
            </span>
          </div>
          <nav className="season-nav" aria-label="SDDFS navigation">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`season-nav-link ${
                  pathname === link.href ? "season-nav-link--active" : ""
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 px-4 py-6 w-full">{children}</main>
    </div>
  );
}
