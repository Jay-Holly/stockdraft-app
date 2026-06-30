import "server-only";

import { getDayTraderContestContext } from "@/lib/day-trader/contest-access";
import {
  loadDayTraderDollarLeaderboard,
  loadDayTraderPercentLeaderboard,
} from "@/lib/day-trader/leaderboard";
import { loadDayTraderPortfolio } from "@/lib/day-trader/portfolio";
import { isDayTraderAdmin } from "@/lib/day-trader/admin-access";
import { hasJoinedDayTrader } from "@/lib/profile/day-trader";
import type { DayTraderContestRow, DayTraderEntryRow } from "@/lib/day-trader/types";
import { createClient } from "@/lib/supabase/server";

export type DayTraderDashboardSummary = {
  joined: boolean;
  isAdmin: boolean;
  contest: DayTraderContestRow | null;
  entry: DayTraderEntryRow | null;
  windowOpen: boolean;
  canEnter: boolean;
  canTrade: boolean;
  dollarRank: number | null;
  percentRank: number | null;
  totalValue: number | null;
  dollarGain: number | null;
  percentGain: number | null;
  entryCount: number;
};

export async function loadDayTraderDashboardSummary(
  userId: string
): Promise<DayTraderDashboardSummary> {
  const [joined, isAdmin, context] = await Promise.all([
    hasJoinedDayTrader(userId),
    isDayTraderAdmin(userId),
    getDayTraderContestContext(userId),
  ]);

  const base: DayTraderDashboardSummary = {
    joined,
    isAdmin,
    contest: context.contest,
    entry: context.entry,
    windowOpen: context.windowOpen,
    canEnter: context.canEnter,
    canTrade:
      context.windowOpen &&
      context.contest?.status === "open" &&
      Boolean(context.entry),
    dollarRank: null,
    percentRank: null,
    totalValue: null,
    dollarGain: null,
    percentGain: null,
    entryCount: 0,
  };

  if (!context.contest) {
    return base;
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("day_trader_entries")
    .select("*", { count: "exact", head: true })
    .eq("contest_id", context.contest.id);

  base.entryCount = count ?? 0;

  const [dollarBoard, percentBoard] = await Promise.all([
    loadDayTraderDollarLeaderboard(context.contest.id),
    loadDayTraderPercentLeaderboard(context.contest.id),
  ]);

  if (context.entry) {
    base.dollarRank =
      dollarBoard.find((row) => row.entryId === context.entry!.id)?.rank ?? null;
    base.percentRank =
      percentBoard.find((row) => row.entryId === context.entry!.id)?.rank ?? null;

    const portfolio = await loadDayTraderPortfolio(context.entry);
    base.totalValue = portfolio.totalValue;
    base.dollarGain = portfolio.dollarGain;
    base.percentGain = portfolio.percentGain;
  }

  return base;
}
