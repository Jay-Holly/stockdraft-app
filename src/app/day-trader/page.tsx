import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";
import { DayTraderEnterForm } from "@/components/day-trader/DayTraderEnterForm";
import { DayTraderLeaderboardLinks } from "@/components/day-trader/DayTraderLeaderboardLinks";
import { DayTraderTradingPanel } from "@/components/day-trader/DayTraderTradingPanel";
import {
  DAY_TRADER_STARTING_VALUE,
  DAY_TRADER_STOCK_BUDGET,
} from "@/lib/day-trader/constants";
import { getDayTraderContestContext } from "@/lib/day-trader/contest-access";
import {
  DAY_TRADER_ENTRY_MIDWEEK_CLOSED_MESSAGE,
  getDayTraderEntryBlockedMessage,
  getDayTraderTradingStatusLabel,
  isDayTraderTradingWeekUnderway,
} from "@/lib/day-trader/contest-period";
import { listDayTraderEligibleLeagues } from "@/lib/day-trader/eligible-leagues";
import { loadDayTraderPortfolio } from "@/lib/day-trader/portfolio";
import {
  hasJoinedDayTrader,
  markDayTraderJoined,
} from "@/lib/profile/day-trader";
import { formatDayTraderContestRange } from "@/lib/day-trader/format-contest";

export default async function DayTraderPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?mode=daytrader");
  }

  if (!(await hasJoinedDayTrader(user.id))) {
    async function joinDayTrader() {
      "use server";
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) redirect("/auth?mode=daytrader");

      const result = await markDayTraderJoined(user.id);
      if (result.error) throw new Error(result.error);
      redirect("/day-trader");
    }

    return (
      <div className="min-h-screen flex flex-col px-4 py-8">
        <div className="max-w-md mx-auto w-full flex-1 flex flex-col">
          <div className="text-center mb-8">
            <Logo size="lg" />
            <h1 className="text-xl font-bold mt-4">Day Trader</h1>
            <p className="text-muted text-sm mt-2">
              Weekly contest: copy your 10 starters, trade Mon–Fri, compete on $
              and % gain.
            </p>
          </div>
          <form action={joinDayTrader} className="space-y-4 mt-auto">
            <Button type="submit" variant="primary" className="w-full">
              Join Day Trader — It&apos;s Free
            </Button>
            <Link
              href="/dashboard"
              className="block text-center text-sm text-muted hover:text-white"
            >
              Back to dashboard
            </Link>
          </form>
        </div>
      </div>
    );
  }

  const now = new Date();
  const [context, eligibleLeagues] = await Promise.all([
    getDayTraderContestContext(user.id, now),
    listDayTraderEligibleLeagues(user.id),
  ]);

  const portfolio = context.entry
    ? await loadDayTraderPortfolio(context.entry)
    : null;

  const contest = context.contest;
  const tradingStatusLabel = getDayTraderTradingStatusLabel({
    entryOpen: context.entryOpen,
    tradingOpen: context.tradingOpen,
    contestStatus: contest?.status ?? null,
  });

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <Logo size="lg" />
          <h1 className="text-xl font-bold mt-4">
            {contest?.contest_name ?? "Day Trader"}
          </h1>
          {contest ? (
            <p className="text-muted text-sm mt-2">
              {formatDayTraderContestRange(
                contest.week_start_at,
                contest.week_end_at
              )}
            </p>
          ) : (
            <p className="text-muted text-sm mt-2">
              Trading runs Mon 9:30 AM – Fri 4:00 PM ET. Entry opens Friday
              4:00 PM ET for the upcoming week.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Entry</span>
            <span className={context.entryOpen ? "text-emerald-400" : "text-muted"}>
              {context.entryOpen ? "Open" : "Closed"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Trading</span>
            <span
              className={
                context.tradingOpen ? "text-emerald-400" : "text-muted"
              }
            >
              {tradingStatusLabel}
            </span>
          </div>
        </div>

        {!(context.entry && portfolio) ? <DayTraderLeaderboardLinks /> : null}

        {context.entry && portfolio ? (
          <div className="space-y-3">
            <p className="text-xs text-muted text-center">
              Starters from {context.entry.source_league_name ?? "your league"} ·
              ${DAY_TRADER_STARTING_VALUE.toLocaleString()} starting value
              {!context.tradingOpen ? " · portfolio locked until trading opens" : ""}
            </p>
            <DayTraderTradingPanel
              initialPortfolio={portfolio}
              canTrade={context.canTrade}
              tradingOpen={context.tradingOpen}
              contestStatus={contest?.status ?? null}
            />
          </div>
        ) : context.canEnter && eligibleLeagues.length > 0 ? (
          <DayTraderEnterForm eligibleLeagues={eligibleLeagues} />
        ) : context.contest &&
          !context.entry &&
          !context.entryOpen &&
          isDayTraderTradingWeekUnderway(now, context.contest) ? (
          <div className="rounded-xl border border-dark-border p-4 text-sm text-red-400">
            {DAY_TRADER_ENTRY_MIDWEEK_CLOSED_MESSAGE}
          </div>
        ) : !context.entryOpen ? (
          <div className="rounded-xl border border-dark-border p-4 text-sm text-muted">
            {getDayTraderEntryBlockedMessage(now, context.contest)}
          </div>
        ) : eligibleLeagues.length === 0 ? (
          <div className="rounded-xl border border-dark-border p-4 text-sm text-muted space-y-3">
            <p>
              Finish a league draft with 10 starter stocks to enter Day Trader.
            </p>
            <Button href="/dashboard" variant="secondary" className="w-full">
              Go to dashboard
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-dark-border p-4 text-sm text-muted">
            No contest accepting entries right now.
          </div>
        )}

        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-xs text-muted space-y-1">
          <p>
            Enter Fri 4:00 PM – Mon 9:30 AM ET (weekends included). Starters
            lock at entry using the latest available prices.
          </p>
          <p>
            Trading opens Mon 9:30 AM ET. Sells credit cash at market price;
            max 10 symbols.
          </p>
          <p>One entry per user per week.</p>
        </div>

        <Link
          href="/dashboard"
          className="block text-center text-sm text-muted hover:text-white"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
