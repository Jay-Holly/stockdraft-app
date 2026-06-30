import "server-only";

import { syncDayTraderContestLifecycle } from "@/lib/day-trader/contest-lifecycle";
import {
  isDayTraderEntryWindowOpenForContest,
  isDayTraderTradingActiveForContest,
  isDayTraderTradingWeekUnderway,
  isDayTraderTradingWindowOpen,
} from "@/lib/day-trader/contest-period";
import type { DayTraderContestRow, DayTraderEntryRow } from "@/lib/day-trader/types";
import { createClient } from "@/lib/supabase/server";

export type DayTraderContestContext = {
  contest: DayTraderContestRow | null;
  entry: DayTraderEntryRow | null;
  /** Fri 4 PM (prior week) – Mon 9:30 AM: user may submit a new entry. */
  entryOpen: boolean;
  /** Mon 9:30 AM – Fri 4 PM: user may buy/sell. */
  tradingOpen: boolean;
  canEnter: boolean;
  canTrade: boolean;
  /** @deprecated Use tradingOpen */
  windowOpen: boolean;
};

function resolveActiveContest(
  contests: DayTraderContestRow[],
  now: Date
): DayTraderContestRow | null {
  const inEntryWindow = contests.find((contest) =>
    isDayTraderEntryWindowOpenForContest(now, contest)
  );
  if (inEntryWindow) return inEntryWindow;

  return (
    contests.find(
      (contest) =>
        contest.status === "open" &&
        isDayTraderTradingWeekUnderway(now, contest)
    ) ?? null
  );
}

export async function getDayTraderContestContext(
  userId: string,
  now: Date = new Date()
): Promise<DayTraderContestContext> {
  await syncDayTraderContestLifecycle(now);

  const supabase = await createClient();

  const { data: contests, error } = await supabase
    .from("day_trader_contests")
    .select("*")
    .in("status", ["upcoming", "open"])
    .order("week_start_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load Day Trader contests: ${error.message}`);
  }

  const contestRow = resolveActiveContest(
    (contests as DayTraderContestRow[]) ?? [],
    now
  );

  if (!contestRow) {
    return {
      contest: null,
      entry: null,
      entryOpen: false,
      tradingOpen: false,
      canEnter: false,
      canTrade: false,
      windowOpen: false,
    };
  }

  const { data: entry } = await supabase
    .from("day_trader_entries")
    .select("*")
    .eq("contest_id", contestRow.id)
    .eq("user_id", userId)
    .maybeSingle();

  const entryRow = (entry as DayTraderEntryRow | null) ?? null;
  const entryOpen = isDayTraderEntryWindowOpenForContest(now, contestRow);
  const tradingOpen = isDayTraderTradingActiveForContest(now, contestRow);

  return {
    contest: contestRow,
    entry: entryRow,
    entryOpen,
    tradingOpen,
    canEnter: entryOpen && !entryRow,
    canTrade: tradingOpen && Boolean(entryRow),
    windowOpen: isDayTraderTradingWindowOpen(now),
  };
}
