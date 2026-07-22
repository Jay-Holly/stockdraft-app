import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { STANDARD_PLAYER_COUNTS } from "@/lib/league/league-config";

export default function JoinPublicPlayerPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-4 border-b border-dark-border">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Logo size="sm" />
          <Link
            href="/dashboard"
            className="text-xs text-muted hover:text-gold transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Pick a league size</h1>
          <p className="text-muted text-sm mt-1">
            Choose how many teams you want in your league. You&apos;ll see all
            public leagues of that size still waiting for players.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {STANDARD_PLAYER_COUNTS.filter((count) => count !== 2).map((count) => (
            <Link
              key={count}
              href={`/leagues/join-public/player/${count}`}
              className="rounded-xl border border-dark-border bg-dark-card p-3 text-center transition-colors hover:border-gold/60 hover:bg-gold/5"
            >
              <Image
                src={`/images/leagues/SDPL${count}.png`}
                alt={`${count}-team player league`}
                width={120}
                height={120}
                className="mx-auto rounded-lg w-full h-auto"
              />
              <span className="block text-xs mt-1 text-muted">
                {count} teams
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
