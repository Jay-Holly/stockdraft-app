import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/Button";
import { PageWatermark } from "@/components/PageWatermark";
import { DayTraderEnterForm } from "@/components/day-trader/DayTraderEnterForm";
import { DayTraderLeaderboardLinks } from "@/components/day-trader/DayTraderLeaderboardLinks";
import { DayTraderRulesButton } from "@/components/day-trader/DayTraderRulesButton";
import { DeleteDayTraderEntryButton } from "@/components/day-trader/DeleteDayTraderEntryButton";
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

function DayTraderRulesCard() {
  return (
    <div className="rounded-xl border border-[var(--color-league-accent)] bg-dark/40 p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">How it works</h2>
        <ul className="text-sm text-muted mt-2 space-y-1.5 list-disc list-inside">
          <li>
            Enter with any league where your draft is complete — Day Trader
            copies your team&apos;s 10 starter stocks into a fresh $
            {(DAY_TRADER_STARTING_VALUE / 1000).toLocaleString()}K lineup ($
            {(DAY_TRADER_STOCK_BUDGET / 1000).toLocaleString()}K per
            position). Crypto and bench picks aren&apos;t included.
          </li>
          <li>Free to enter, every week.</li>
          <li>
            Trading runs Mon 9:30 AM – Fri 4:00 PM ET. Buy and sell your 10
            positions as often as you want during that window.
          </li>
          <li>
            Entry for the upcoming week opens Friday at 4:00 PM ET, right
            after the current week closes.
          </li>
          <li>
            Outside trading hours (nights, weekends) your portfolio is
            locked — no trades until the next session opens.
          </li>
          <li>
            Two leaderboards every week: $ Gainer and % Gainer, ranked on
            performance from Monday&apos;s open to Friday&apos;s close.
          </li>
          <li>
            Every week is a fresh contest — entering again resets your
            lineup and starting value, it doesn&apos;t carry gains forward.
          </li>
        </ul>
      </div>
      <div>
        <h2 className="text-sm font-semibold text-white">
          How this differs from StockDuel Free Sim and Player Leagues
        </h2>
        <p className="text-sm text-muted mt-2">
          No draft, no waiver wire, no season-long roster — it&apos;s active
          trading of stocks you already own in a league, over a single week
          instead of a full season, with full freedom to buy and sell rather
          than locking in picks. Once you import your team, you can switch
          out every stock if you want — you&apos;re not stuck with the
          lineup you started with. Any eligible stock is fair game for every
          player.
        </p>
      </div>
    </div>
  );
}

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
      <div className="min-h-screen flex flex-col px-4 py-8" data-league-theme="day-trader">
        <PageWatermark />
        <div className="max-w-md mx-auto w-full flex-1 flex flex-col">
          <Link
            href="/dashboard"
            className="season-nav-link season-nav-link--active self-start mb-4"
          >
            ← Dashboard
          </Link>
          <div className="text-center mb-8">
            <Image
              src="/images/day-trader-logo.png"
              alt="StockDuel Day Trader"
              width={320}
              height={320}
              className="mx-auto"
              priority
            />
            <h1 className="text-xl font-bold mt-4">StockDuel Day Trader</h1>
            <p className="text-muted text-sm mt-2">
              Weekly contest: copy your 10 starters, trade Mon–Fri, compete on $
              and % gain.
            </p>
          </div>
          <div className="mb-6">
            <DayTraderRulesCard />
          </div>
          <form action={joinDayTrader} className="space-y-4 mt-auto">
            <Button type="submit" variant="primary" className="w-full">
              Join Day Trader — It&apos;s Free
            </Button>
            <div className="rounded-xl border border-dark-border bg-dark/40 p-3 text-xs text-muted">
              Brought to you by Robinhood — start a new account with codeword{" "}
              <span className="text-white font-semibold">&quot;Stock Draft&quot;</span>{" "}
              and get $50 off your first stock purchase.
            </div>
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
    <div className="min-h-screen px-4 py-8" data-league-theme="day-trader">
      <PageWatermark />
      <div className="max-w-lg mx-auto space-y-6">
        <Link
          href="/dashboard"
          className="season-nav-link season-nav-link--active inline-block"
        >
          ← Dashboard
        </Link>
        <div className="text-center">
          <Image
            src="/images/day-trader-logo.png"
            alt="StockDuel Day Trader"
            width={320}
            height={320}
            className="mx-auto"
            priority
          />
          <h1 className="text-xl font-bold mt-4">
            {contest?.contest_name ?? "StockDuel Day Trader"}
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
          <div className="mt-3">
            <DayTraderRulesButton />
          </div>
        </div>

        <div className="rounded-xl border border-[var(--color-league-accent)] bg-dark/40 p-4 space-y-2">
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
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                Starters from {context.entry.source_league_name ?? "your league"} ·
                ${DAY_TRADER_STARTING_VALUE.toLocaleString()} starting value
                {!context.tradingOpen ? " · portfolio locked until trading opens" : ""}
              </span>
              <DeleteDayTraderEntryButton entryId={context.entry.id} />
            </div>
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
          <div className="rounded-xl border border-[var(--color-league-accent)] p-4 text-sm text-red-400">
            {DAY_TRADER_ENTRY_MIDWEEK_CLOSED_MESSAGE}
          </div>
        ) : !context.entryOpen ? (
          <div className="rounded-xl border border-[var(--color-league-accent)] p-4 text-sm text-muted">
            {getDayTraderEntryBlockedMessage(now, context.contest)}
          </div>
        ) : eligibleLeagues.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-league-accent)] p-4 text-sm text-muted space-y-3">
            <p>
              Finish a league draft with 10 starter stocks to enter Day Trader.
            </p>
            <Button href="/dashboard" variant="secondary" className="w-full">
              Go to dashboard
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--color-league-accent)] p-4 text-sm text-muted">
            No contest accepting entries right now.
          </div>
        )}

        <div className="rounded-xl border border-[var(--color-league-accent)] bg-dark/40 p-4 text-xs text-muted space-y-1">
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

        <div className="rounded-xl border border-dark-border bg-dark/40 p-3 text-xs text-muted">
          Brought to you by Robinhood — start a new account with codeword{" "}
          <span className="text-white font-semibold">&quot;Stock Draft&quot;</span> and
          get $50 off your first stock purchase.
        </div>

        <DayTraderRulesCard />

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
