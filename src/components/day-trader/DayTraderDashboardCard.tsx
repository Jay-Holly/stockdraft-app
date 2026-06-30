import Link from "next/link";
import { Button } from "@/components/Button";
import { formatPct, formatSignedMoney } from "@/lib/format";
import {
  DAY_TRADER_ENTRY_MIDWEEK_CLOSED_MESSAGE,
  getDayTraderTradingStatusLabel,
} from "@/lib/day-trader/contest-period";
import type { DayTraderDashboardSummary } from "@/lib/day-trader/dashboard-summary";

type DayTraderDashboardCardProps = {
  summary: DayTraderDashboardSummary;
};

export function DayTraderDashboardCard({ summary }: DayTraderDashboardCardProps) {
  const contest = summary.contest;
  const tradingStatusLabel = getDayTraderTradingStatusLabel({
    entryOpen: summary.entryOpen,
    tradingOpen: summary.tradingOpen,
    contestStatus: contest?.status ?? null,
  });

  return (
    <section className="bg-dark-card border border-gold/30 rounded-2xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Day Trader</h2>
          <p className="text-muted text-sm mt-1">
            Weekly contest — enter Fri–Fri, trade Mon–Fri.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted">Entry</p>
          <p className={summary.entryOpen ? "text-emerald-400" : "text-muted"}>
            {summary.entryOpen ? "Open" : "Closed"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Trading</p>
          <p className={summary.tradingOpen ? "text-emerald-400" : "text-muted"}>
            {tradingStatusLabel}
          </p>
        </div>
      </div>

      {contest ? (
        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 space-y-2 text-sm">
          <p className="font-semibold">{contest.contest_name}</p>
          <p className="text-xs text-muted capitalize">
            {contest.status} · {summary.entryCount} entrant
            {summary.entryCount === 1 ? "" : "s"}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">
          No contest accepting entries right now.
        </p>
      )}

      {summary.joined && summary.entry ? (
        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted">$ rank</p>
              <p className="font-semibold">
                {summary.dollarRank != null ? `#${summary.dollarRank}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">% rank</p>
              <p className="font-semibold">
                {summary.percentRank != null ? `#${summary.percentRank}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">$ Gain</p>
              <p
                className={
                  (summary.dollarGain ?? 0) >= 0
                    ? "text-emerald-400 font-semibold"
                    : "text-red-400 font-semibold"
                }
              >
                {summary.dollarGain != null
                  ? formatSignedMoney(summary.dollarGain)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">% Gain</p>
              <p
                className={
                  (summary.percentGain ?? 0) >= 0
                    ? "text-emerald-400 font-semibold"
                    : "text-red-400 font-semibold"
                }
              >
                {summary.percentGain != null
                  ? formatPct(summary.percentGain)
                  : "—"}
              </p>
            </div>
          </div>
        </div>
      ) : summary.joined && summary.canEnter ? (
        <p className="text-sm text-muted">
          You haven&apos;t entered this week&apos;s contest yet.
        </p>
      ) : summary.joined &&
        !summary.entry &&
        !summary.entryOpen &&
        summary.contest?.status === "open" ? (
        <p className="text-sm text-red-400">
          {DAY_TRADER_ENTRY_MIDWEEK_CLOSED_MESSAGE}
        </p>
      ) : !summary.joined ? (
        <p className="text-sm text-muted">
          Join free to copy your starters and trade each week.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {!summary.joined ? (
          <Button href="/day-trader" variant="primary" className="w-full">
            Join Day Trader
          </Button>
        ) : summary.entry ? (
          <Button href="/day-trader" variant="primary" className="w-full">
            {summary.canTrade ? "Trade portfolio" : "View portfolio"}
          </Button>
        ) : summary.canEnter ? (
          <Button href="/day-trader" variant="primary" className="w-full">
            Enter this week
          </Button>
        ) : (
          <Button href="/day-trader" variant="secondary" className="w-full">
            Day Trader hub
          </Button>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            href="/day-trader/leaderboard/dollar-gainer"
            variant="secondary"
            className="w-full text-sm"
          >
            $ Leaderboard
          </Button>
          <Button
            href="/day-trader/leaderboard/percent-gainer"
            variant="secondary"
            className="w-full text-sm"
          >
            % Leaderboard
          </Button>
        </div>

        {summary.isAdmin ? (
          <Link
            href="/admin/day-trader"
            className="block text-center text-sm text-gold hover:text-gold-dark"
          >
            Manage contest settings
          </Link>
        ) : null}
      </div>
    </section>
  );
}
