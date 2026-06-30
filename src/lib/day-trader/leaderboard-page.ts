import "server-only";

import {
  loadDayTraderDollarLeaderboard,
  loadDayTraderPercentLeaderboard,
  type DayTraderLeaderboardMetric,
  type DayTraderLeaderboardRow,
} from "@/lib/day-trader/leaderboard";
import { resolveDayTraderLeaderboardContest } from "@/lib/day-trader/resolve-contest";
import type { DayTraderContestRow } from "@/lib/day-trader/types";
import { createClient } from "@/lib/supabase/server";

export type DayTraderLeaderboardPageData = {
  userId: string | null;
  contest: DayTraderContestRow | null;
  rows: DayTraderLeaderboardRow[];
};

export async function loadDayTraderLeaderboardPage(
  metric: DayTraderLeaderboardMetric,
  contestId?: string | null
): Promise<DayTraderLeaderboardPageData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const contest = await resolveDayTraderLeaderboardContest(contestId);
  const rows = contest
    ? metric === "dollar"
      ? await loadDayTraderDollarLeaderboard(contest.id)
      : await loadDayTraderPercentLeaderboard(contest.id)
    : [];

  return {
    userId: user?.id ?? null,
    contest,
    rows,
  };
}
