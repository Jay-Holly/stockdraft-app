import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";
import { DayTraderEnterForm } from "@/components/day-trader/DayTraderEnterForm";
import {
  DAY_TRADER_STARTING_VALUE,
  DAY_TRADER_STOCK_BUDGET,
} from "@/lib/day-trader/constants";
import { getDayTraderContestContext } from "@/lib/day-trader/contest-access";
import { listDayTraderEligibleLeagues } from "@/lib/day-trader/eligible-leagues";
import {
  hasJoinedDayTrader,
  markDayTraderJoined,
} from "@/lib/profile/day-trader";

function formatContestRange(weekStart: string, weekEnd: string): string {
  const start = new Date(weekStart);
  const end = new Date(weekEnd);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
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

  let positions: Array<{ symbol: string; shares: number }> = [];
  if (context.entry) {
    const { data } = await supabase
      .from("day_trader_positions")
      .select("symbol, shares, slot_order")
      .eq("entry_id", context.entry.id)
      .order("slot_order", { ascending: true });

    positions =
      data?.map((row) => ({
        symbol: row.symbol,
        shares: Number(row.shares),
      })) ?? [];
  }

  const contest = context.contest;

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
              {formatContestRange(contest.week_start_at, contest.week_end_at)}
            </p>
          ) : (
            <p className="text-muted text-sm mt-2">
              Contest opens Mon 9:30 AM ET and closes Fri 4:00 PM ET.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Trading window</span>
            <span className={context.windowOpen ? "text-emerald-400" : "text-muted"}>
              {context.windowOpen ? "Open" : "Closed"}
            </span>
          </div>
          {contest ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Contest status</span>
              <span className="capitalize">{contest.status}</span>
            </div>
          ) : null}
        </div>

        {context.entry ? (
          <div className="rounded-xl border border-gold/30 bg-gold/5 p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-gold">You&apos;re in this week</p>
              <p className="text-xs text-muted mt-1">
                Starters copied from {context.entry.source_league_name ?? "your league"}.
                Starting value ${DAY_TRADER_STARTING_VALUE.toLocaleString()}.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {positions.map((position) => (
                <div
                  key={position.symbol}
                  className="rounded-lg bg-primary/20 px-2 py-1.5 text-center text-xs font-semibold"
                >
                  {position.symbol}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">
              Trading UI arrives in the next step. Your portfolio is locked in for
              this week.
            </p>
          </div>
        ) : context.canEnter && eligibleLeagues.length > 0 ? (
          <DayTraderEnterForm eligibleLeagues={eligibleLeagues} />
        ) : !context.windowOpen ? (
          <div className="rounded-xl border border-dark-border p-4 text-sm text-muted">
            Entries open Mon–Fri, 9:30 AM – 4:00 PM ET when a contest is active.
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
            No open contest right now. Check back when the weekly window opens.
          </div>
        )}

        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-xs text-muted space-y-1">
          <p>
            Entry copies 10 stock starters only — no bench or crypto. Each stock
            is reset to ${DAY_TRADER_STOCK_BUDGET.toLocaleString()} at entry price.
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
