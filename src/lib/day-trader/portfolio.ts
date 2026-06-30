import "server-only";

import { DAY_TRADER_STARTING_VALUE } from "@/lib/day-trader/constants";
import {
  computeDayTraderEntryValue,
  computeDayTraderFinalMetrics,
  fetchDayTraderPositionQuotes,
} from "@/lib/day-trader/portfolio-value";
import type { DayTraderEntryRow } from "@/lib/day-trader/types";
import { createClient } from "@/lib/supabase/server";

export type DayTraderPositionView = {
  id: string;
  symbol: string;
  shares: number;
  slotOrder: number;
  price: number;
  marketValue: number;
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

  const positionViews: DayTraderPositionView[] = positions.map((position) => {
    const price = quotes[position.symbol]?.price ?? 0;
    return {
      ...position,
      price,
      marketValue: position.shares * price,
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
