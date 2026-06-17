import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-4 flex items-center justify-between max-w-5xl mx-auto w-full">
        <Logo />
        <div className="flex items-center gap-2">
          <Link
            href="/auth?mode=login"
            className="text-sm text-muted hover:text-white px-3 py-2"
          >
            Log in
          </Link>
          <Button href="/auth?mode=signup" variant="primary" className="!px-4 !py-2 text-sm">
            Get started
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <section className="px-4 pt-8 pb-16 max-w-5xl mx-auto w-full text-center">
          <div className="inline-block rounded-full bg-primary/20 border border-primary/40 px-4 py-1.5 text-xs font-semibold text-gold mb-6">
            Fantasy football meets Wall Street
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black leading-tight mb-6">
            Draft stocks.
            <br />
            <span className="text-gold">Dominate</span> the market.
          </h1>

          <p className="text-muted text-base sm:text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            Build your fantasy portfolio, compete in leagues with friends, and
            climb the leaderboard — just like fantasy football, but with real
            stock performance.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button href="/auth?mode=signup" variant="primary" className="!px-8">
              Start drafting free
            </Button>
            <Button href="/auth?mode=login" variant="ghost" className="!px-8">
              I have an account
            </Button>
          </div>
        </section>

        <section className="px-4 pb-20 max-w-5xl mx-auto w-full">
          <div className="grid gap-4 sm:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-dark-card border border-dark-border rounded-2xl p-6"
              >
                <div className="text-2xl mb-3">{feature.icon}</div>
                <h3 className="font-bold mb-2">{feature.title}</h3>
                <p className="text-muted text-sm leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-4 py-16 bg-primary/10 border-y border-primary/20">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-black mb-4">
              Ready to make your picks?
            </h2>
            <p className="text-muted mb-8">
              Join StockDraft and turn market knowledge into bragging rights.
            </p>
            <Button href="/auth?mode=signup" variant="primary" className="!px-10">
              Create your team
            </Button>
          </div>
        </section>
      </main>

      <footer className="px-4 py-8 text-center text-muted text-xs border-t border-dark-border">
        <Logo size="sm" />
        <p className="mt-2">© {new Date().getFullYear()} StockDraft. All rights reserved.</p>
      </footer>
    </div>
  );
}

const features = [
  {
    icon: "📈",
    title: "Draft your lineup",
    description:
      "Pick stocks like players. Build a portfolio that scores based on real market performance.",
  },
  {
    icon: "🏆",
    title: "Compete in leagues",
    description:
      "Create private leagues with friends or join public ones. Weekly head-to-head matchups.",
  },
  {
    icon: "📊",
    title: "Track performance",
    description:
      "Live scores, standings, and stats. See who's the best trader in your group.",
  },
];
