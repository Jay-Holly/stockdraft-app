import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/components/Logo";
import { SPORTS_LEAGUE_FORMATS } from "@/lib/league/league-config";

export default function JoinPublicSportsSimPage() {
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
          <h1 className="text-2xl font-bold">Pick a Sports Sim league</h1>
          <p className="text-muted text-sm mt-1">
            Choose which sport you want to join. You&apos;ll see all public
            leagues still waiting for players.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {SPORTS_LEAGUE_FORMATS.map((format) => (
            <Link
              key={format.id}
              href={`/leagues/join-public/sports-sim/${format.id}`}
              className="rounded-xl border border-dark-border bg-dark-card p-4 text-center transition-colors hover:border-gold/60 hover:bg-gold/5"
            >
              {format.logoSrc ? (
                <Image
                  src={format.logoSrc}
                  alt=""
                  width={72}
                  height={90}
                  className="mx-auto mb-2 rounded"
                />
              ) : (
                <span className="mx-auto mb-2 flex h-[90px] w-[72px] items-center justify-center rounded border border-dashed border-dark-border text-xs text-muted">
                  {format.label}
                </span>
              )}
              <span className="block text-sm font-semibold text-white">
                {format.label}
              </span>
              <span className="block text-xs mt-0.5 text-muted">
                {format.description}
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
