import Link from "next/link";
import { Logo } from "@/components/Logo";

const PACKAGES = [
  {
    title: "NFL Package",
    subtitle: "Weekly matchups",
    description:
      "Draft a portfolio of stocks and face a new opponent each week, just like fantasy football. Lineups lock before the market opens; weekly scores are based on how your picks perform against your matchup.",
  },
  {
    title: "MLB Package",
    subtitle: "Series format",
    description:
      "Play in multi-game series instead of single-week slates. Your roster earns points across a series window, so streaks and momentum matter as much as one-day pops.",
  },
  {
    title: "NBA / NHL Package",
    subtitle: "Near-daily matchups",
    description:
      "Short seasons, fast turnarounds. Swap lineups and settle scores on a near-daily cadence — built for leagues that want constant action while markets are open.",
  },
  {
    title: "Day Trader Mode",
    subtitle: "Free solo play",
    description:
      "Practice with real market rhythm — no league required. Enter free, track intraday moves, and sharpen your reads before joining a full StockDraft season.",
  },
];

export default function GameRulesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-dark">
      <header className="px-4 py-4 border-b border-dark-border">
        <Logo />
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <h1 className="text-2xl font-bold text-white mb-1">Game Rules</h1>
        <p className="text-muted text-sm mb-6">
          StockDraft works like fantasy sports for the stock market. Pick a package
          that fits your league&apos;s schedule — or jump into Day Trader mode to
          practice on your own.
        </p>

        <ul className="space-y-4">
          {PACKAGES.map((pkg) => (
            <li
              key={pkg.title}
              className="rounded-xl border border-dark-border bg-dark-card p-4"
            >
              <h2 className="text-lg font-bold text-gold">{pkg.title}</h2>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted mt-1">
                {pkg.subtitle}
              </p>
              <p className="text-sm text-white/90 mt-2 leading-relaxed">
                {pkg.description}
              </p>
            </li>
          ))}
        </ul>

        <p className="text-center mt-8">
          <Link href="/" className="text-sm text-gold hover:underline">
            ← Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}
