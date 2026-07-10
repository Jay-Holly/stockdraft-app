import { Button } from "@/components/Button";

export function DayTraderPromoCard() {
  return (
    <section className="bg-dark-card border border-gold/30 rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Day Trader</h2>
        <p className="text-muted text-sm mt-1">
          Don&apos;t forget to enter one of your teams into Day Trader — it&apos;s
          free every week. Missed this week&apos;s cutoff? Enter now and you&apos;re
          set for next week&apos;s contest.
        </p>
      </div>

      <Button href="/day-trader" variant="primary" className="w-full">
        Enter Day Trader
      </Button>

      <div className="rounded-xl border border-dark-border bg-dark/40 p-3 text-xs text-muted">
        Brought to you by Robinhood — start a new account with codeword{" "}
        <span className="text-white font-semibold">&quot;Stock Draft&quot;</span> and
        get $50 off your first stock purchase.
      </div>
    </section>
  );
}
