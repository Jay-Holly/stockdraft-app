import "server-only";

import { loadDraftStateDetailed } from "@/lib/draft/server";
import type { DraftPick } from "@/lib/draft/types";
import { getSeasonWeekContext } from "@/lib/league/season-weeks";
import {
  computeWeekDollarGain,
  computeWeekGainPercent,
} from "@/lib/roster/scoring-math";
import {
  ensureWeekBaselines,
  loadWeekBaselineMap,
} from "@/lib/roster/weekly";
import { createClient } from "@/lib/supabase/server";

export type DayTraderPositionGainMetrics = {
  dailyGainPercent: number;
  dailyDollarGain: number;
  weekGainPercent: number;
  weekDollarGain: number;
};

type PositionInput = {
  symbol: string;
  shares: number;
  price: number;
};

type QuoteInput = {
  price: number;
  changePercent: number;
  prevClose: number;
};

function computeDailyDollarGain(
  shares: number,
  price: number,
  prevClose: number
): number {
  if (shares <= 0 || price <= 0) return 0;
  return shares * (price - prevClose);
}

async function loadSymbolWeekOpenPriceMap(
  userId: string,
  sourceLeagueId: string | null
): Promise<Map<string, number>> {
  if (!sourceLeagueId) return new Map();

  const supabase = await createClient();
  const [weekContext, draftState] = await Promise.all([
    getSeasonWeekContext(sourceLeagueId, userId),
    loadDraftStateDetailed(userId, { leagueId: sourceLeagueId }),
  ]);

  if (!draftState.ok) return new Map();

  const picks = draftState.state.picks.filter((pick) => pick.pick_type !== "skip");
  await ensureWeekBaselines(
    supabase,
    sourceLeagueId,
    userId,
    weekContext.currentWeek,
    picks
  );

  const baselineMap = await loadWeekBaselineMap(
    supabase,
    sourceLeagueId,
    userId,
    weekContext.currentWeek
  );

  const byPickId = new Map<string, DraftPick>(
    picks.map((pick) => [pick.id, pick])
  );
  const bySymbol = new Map<string, number>();

  for (const [pickId, weekOpenValue] of baselineMap.entries()) {
    const pick = byPickId.get(pickId);
    if (!pick || pick.pick_type === "bench" || pick.pick_type === "skip") {
      continue;
    }

    const shares = pick.shares > 0 ? pick.shares : 0;
    if (shares > 0 && weekOpenValue > 0) {
      bySymbol.set(pick.symbol.toUpperCase(), weekOpenValue / shares);
    }
  }

  return bySymbol;
}

export async function buildDayTraderPositionGainMetrics(
  userId: string,
  sourceLeagueId: string | null,
  positions: readonly PositionInput[],
  quotes: Record<string, QuoteInput>
): Promise<Record<string, DayTraderPositionGainMetrics>> {
  const weekOpenPriceBySymbol = await loadSymbolWeekOpenPriceMap(
    userId,
    sourceLeagueId
  );
  const metrics: Record<string, DayTraderPositionGainMetrics> = {};

  for (const position of positions) {
    const symbol = position.symbol.toUpperCase();
    const quote = quotes[symbol];
    const price = quote?.price ?? position.price;
    const prevClose = quote?.prevClose ?? price;
    const changePercent = quote?.changePercent ?? 0;
    const currentValue = position.shares * price;
    const weekOpenPrice = weekOpenPriceBySymbol.get(symbol) ?? 0;
    const weekOpenValue = weekOpenPrice > 0 ? position.shares * weekOpenPrice : 0;

    metrics[symbol] = {
      dailyGainPercent: changePercent,
      dailyDollarGain: computeDailyDollarGain(
        position.shares,
        price,
        prevClose
      ),
      weekDollarGain: computeWeekDollarGain(currentValue, weekOpenValue),
      weekGainPercent: computeWeekGainPercent(currentValue, weekOpenValue),
    };
  }

  return metrics;
}
