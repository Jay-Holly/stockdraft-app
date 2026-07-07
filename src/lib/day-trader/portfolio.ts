import "server-only";

import { DAY_TRADER_STARTING_VALUE } from "@/lib/day-trader/constants";
import {
  computeDayTraderEntryValue,
  computeDayTraderFinalMetrics,
  fetchDayTraderPositionQuotes,
} from "@/lib/day-trader/portfolio-value";
import { buildDayTraderPositionGainMetrics } from "@/lib/day-trader/position-gains";
import type { DayTraderEntryRow } from "@/lib/day-trader/types";
import { createClient } from "@/lib/supabase/server";

export type DayTraderPositionView = {
  id: string;
  symbol: string;
  shares: number;
  slotOrder: number;
  price: number;
  marketValue: number;
  dailyGainPercent: number;
  dailyDollarGain: number;
  weekGainPercent: number;
  weekDollarGain: number;
};

export type DayTraderPortfolioView = {
  entryId: string;
  cashBalance: number;
  startingValue: number;
  totalValue: number;
  dollarGain: number;
  percentGain: number;
  positionCount: number;
  positions: DayTraderPositionView[];
};

export async function loadDayTraderPortfolio(
  entry: DayTraderEntryRow
): Promise<DayTraderPortfolioView> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("day_trader_positions")
    .select("id, symbol, shares, slot_order")
    .eq("entry_id", entry.id)
    .order("slot_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to load positions: ${error.message}`);
  }

  const positions = (rows ?? []).map((row) => ({
    id: row.id,
    symbol: String(row.symbol).toUpperCase(),
    shares: Number(row.shares),
    slotOrder: row.slot_order,
  }));

  const quotes = await fetchDayTraderPositionQuotes(
    positions.map((position) => ({ symbol: position.symbol }))
  );
  const gainMetrics = await buildDayTraderPositionGainMetrics(
    entry.user_id,
    entry.source_league_id,
    positions.map((position) => ({
      symbol: position.symbol,
      shares: position.shares,
      price: quotes[position.symbol]?.price ?? 0,
    })),
    quotes
  );

  const positionViews: DayTraderPositionView[] = positions.map((position) => {
    const price = quotes[position.symbol]?.price ?? 0;
    const gains = gainMetrics[position.symbol];
    return {
      id: position.id,
      symbol: position.symbol,
      shares: position.shares,
      slotOrder: position.slotOrder,
      price,
      marketValue: position.shares * price,
      dailyGainPercent: gains?.dailyGainPercent ?? 0,
      dailyDollarGain: gains?.dailyDollarGain ?? 0,
      weekGainPercent: gains?.weekGainPercent ?? 0,
      weekDollarGain: gains?.weekDollarGain ?? 0,
    };
  });

  const cashBalance = Number(entry.cash_balance);
  const startingValue =
    Number(entry.starting_value) || DAY_TRADER_STARTING_VALUE;
  const totalValue = computeDayTraderEntryValue(
    cashBalance,
    positionViews,
    quotes
  );
  const { finalDollarGain, finalPctGain } = computeDayTraderFinalMetrics(
    startingValue,
    totalValue
  );

  return {
    entryId: entry.id,
    cashBalance,
    startingValue,
    totalValue,
    dollarGain: finalDollarGain,
    percentGain: finalPctGain,
    positionCount: positionViews.length,
    positions: positionViews,
  };
}
