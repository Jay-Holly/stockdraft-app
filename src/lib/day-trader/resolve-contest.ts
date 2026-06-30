import "server-only";

import { syncDayTraderContestLifecycle } from "@/lib/day-trader/contest-lifecycle";
import type { DayTraderContestRow } from "@/lib/day-trader/types";
import { createClient } from "@/lib/supabase/server";

export async function resolveDayTraderLeaderboardContest(
  contestId?: string | null,
  now: Date = new Date()
): Promise<DayTraderContestRow | null> {
  await syncDayTraderContestLifecycle(now);

  const supabase = await createClient();
  const trimmedId = contestId?.trim();

  if (trimmedId) {
    const { data } = await supabase
      .from("day_trader_contests")
      .select("*")
      .eq("id", trimmedId)
      .maybeSingle();

    return (data as DayTraderContestRow | null) ?? null;
  }

  const { data: openContest } = await supabase
    .from("day_trader_contests")
    .select("*")
    .in("status", ["open", "closed"])
    .order("week_start_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (openContest) {
    return openContest as DayTraderContestRow;
  }

  const { data: finalizedContest } = await supabase
    .from("day_trader_contests")
    .select("*")
    .eq("status", "finalized")
    .order("week_start_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (finalizedContest as DayTraderContestRow | null) ?? null;
}

export function formatDayTraderContestRange(
  weekStart: string,
  weekEnd: string
): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${fmt.format(new Date(weekStart))} – ${fmt.format(new Date(weekEnd))}`;
}
