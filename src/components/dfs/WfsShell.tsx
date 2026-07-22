"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { PageWatermark } from "@/components/PageWatermark";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/stockdraft-wfs", label: "Lobby" },
  { href: "/stockdraft-wfs/my-teams", label: "My Teams" },
  { href: "/my-account", label: "My Wallet" },
];

export function WfsShell({
  title,
  children,
  watermarkSizeClassName,
  watermarkOpacityClassName,
  hideWatermark = false,
  hideHeaderLogo = false,
}: {
  title: string;
  children: React.ReactNode;
  watermarkSizeClassName?: string;
  watermarkOpacityClassName?: string;
  hideWatermark?: boolean;
  hideHeaderLogo?: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex flex-col">
      {!hideWatermark && (
        <PageWatermark
          logoSrc="/images/leagues/sdwfs.png"
          sizeClassName={watermarkSizeClassName}
          opacityClassName={watermarkOpacityClassName}
        />
      )}
      <header className="px-4 py-4 border-b border-dark-border">
        <div className="max-w-lg mx-auto">
          <div className="flex items-stretch justify-between gap-3 mb-3">
            <div className="flex flex-col justify-center">
              <Logo size="sm" />
              <span className="block text-xs font-semibold uppercase tracking-wider text-gold mt-1">
                {title}
              </span>
            </div>
            {!hideHeaderLogo && (
              <Image
                src="/images/leagues/sdwfs.png"
                alt="SDWFS"
                width={96}
                height={96}
                className="rounded-lg flex-shrink-0 h-auto w-24"
              />
            )}
          </div>
          <nav className="season-nav" aria-label="SDWFS navigation">
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
