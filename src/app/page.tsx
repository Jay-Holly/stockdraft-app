import Link from "next/link";
import { FireEffect } from "@/components/FireEffect";
import { StockDraftLogo } from "@/components/StockDraftLogo";

export default function HomePage() {
  return (
    <div className="relative min-h-[100dvh] flex flex-col bg-dark overflow-hidden">
      <FireEffect />

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-5 pb-36 pt-10 sm:pb-44">
        <div className="w-full max-w-sm mx-auto flex flex-col items-center text-center">
          <h1 className="mb-6 text-xl sm:text-2xl font-bold tracking-tight text-white leading-snug">
            Where Real Markets Meet Fantasy Sports
          </h1>

          <StockDraftLogo />

          <p className="mt-6 text-sm sm:text-base text-muted leading-relaxed max-w-[320px]">
            Draft stocks like players. Win your league. Learn the markets.
            They&apos;ve never had a season.{" "}
            <span className="text-gold font-semibold">Until now.</span>
          </p>

          <div className="mt-10 w-full flex flex-col gap-3">
            <Link
              href="/auth"
              className="w-full rounded-2xl bg-gold text-dark font-bold text-base py-4 px-6 shadow-[0_4px_24px_rgba(255,214,0,0.35)] hover:bg-gold-dark active:scale-[0.98] transition-all"
            >
              Create Account 🔥
            </Link>

            <Link
              href="/auth?mode=daytrader"
              className="w-full rounded-2xl border-2 border-ember bg-primary/40 text-white font-semibold text-base py-4 px-6 hover:bg-primary/60 hover:border-ember-light active:scale-[0.98] transition-all backdrop-blur-sm"
            >
              ⚡ Day Trader — Enter Free
            </Link>
          </div>

          <Link
            href="/auth?mode=login"
            className="mt-6 text-sm text-muted hover:text-gold transition-colors underline underline-offset-4 decoration-muted/40 hover:decoration-gold/60"
          >
            View Demo
          </Link>
        </div>
      </main>
    </div>
  );
}
