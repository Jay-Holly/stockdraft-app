import "server-only";

import { syncDayTraderContestLifecycle } from "@/lib/day-trader/contest-lifecycle";
import { isDayTraderContestWindowOpen } from "@/lib/day-trader/contest-period";
import type { DayTraderContestRow, DayTraderEntryRow } from "@/lib/day-trader/types";
import { createClient } from "@/lib/supabase/server";

export type DayTraderContestContext = {
  contest: DayTraderContestRow | null;
  entry: DayTraderEntryRow | null;
  windowOpen: boolean;
  canEnter: boolean;
};

export async function getDayTraderContestContext(
  userId: string,
  now: Date = new Date()
): Promise<DayTraderContestContext> {
  await syncDayTraderContestLifecycle(now);

  const supabase = await createClient();
  const windowOpen = isDayTraderContestWindowOpen(now);

  const { data: contest } = await supabase
    .from("day_trader_contests")
    .select("*")
    .eq("status", "open")
    .lte("week_start_at", now.toISOString())
    .gt("week_end_at", now.toISOString())
    .order("week_start_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const contestRow = (contest as DayTraderContestRow | null) ?? null;
  if (!contestRow) {
    return {
      contest: null,
      entry: null,
      windowOpen,
      canEnter: false,
    };
  }

  const { data: entry } = await supabase
    .from("day_trader_entries")
    .select("*")
    .eq("contest_id", contestRow.id)
    .eq("user_id", userId)
    .maybeSingle();

  const entryRow = (entry as DayTraderEntryRow | null) ?? null;

  return {
    contest: contestRow,
    entry: entryRow,
    windowOpen,
    canEnter: windowOpen && !entryRow,
  };
}
