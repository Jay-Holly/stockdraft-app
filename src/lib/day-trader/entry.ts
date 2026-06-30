import "server-only";

import {
  DAY_TRADER_STARTING_VALUE,
  DAY_TRADER_STOCK_BUDGET,
} from "@/lib/day-trader/constants";
import { getDayTraderContestContext } from "@/lib/day-trader/contest-access";
import { isDayTraderContestWindowOpen } from "@/lib/day-trader/contest-period";
import { loadLeagueName, loadLeagueStockStarters } from "@/lib/day-trader/starters";
import type { DayTraderEntryRow } from "@/lib/day-trader/types";
import { isUsMarketOpen } from "@/lib/market/hours";
import { fetchStockQuotes } from "@/lib/roster/quotes";
import { createClient } from "@/lib/supabase/server";

export type CreateDayTraderEntryResult =
  | { ok: true; entry: DayTraderEntryRow }
  | { ok: false; error: string };

export async function createDayTraderEntry(
  userId: string,
  leagueId: string,
  now: Date = new Date()
): Promise<CreateDayTraderEntryResult> {
  if (!isDayTraderContestWindowOpen(now)) {
    return {
      ok: false,
      error: "Day Trader entries are only accepted Mon–Fri, 9:30 AM – 4:00 PM ET.",
    };
  }

  if (!isUsMarketOpen(now)) {
    return {
      ok: false,
      error: "Market is closed. Try again during regular trading hours.",
    };
  }

  const context = await getDayTraderContestContext(userId, now);
  if (!context.contest) {
    return { ok: false, error: "No open Day Trader contest this week." };
  }

  if (context.entry) {
    return { ok: false, error: "You already entered this week's contest." };
  }

  const starters = await loadLeagueStockStarters(userId, leagueId);
  if (!starters.ok) {
    return { ok: false, error: starters.error };
  }

  const symbols = starters.picks.map((pick) => pick.symbol);
  const quotes = await fetchStockQuotes(symbols);

  const missingPrices = symbols.filter(
    (symbol) => (quotes.get(symbol)?.price ?? 0) <= 0
  );
  if (missingPrices.length > 0) {
    return {
      ok: false,
      error: `Missing live prices for: ${missingPrices.join(", ")}.`,
    };
  }

  const leagueName = (await loadLeagueName(leagueId)) ?? "League";
  const supabase = await createClient();

  const { data: entry, error: entryError } = await supabase
    .from("day_trader_entries")
    .insert({
      contest_id: context.contest.id,
      user_id: userId,
      source_league_id: leagueId,
      source_league_name: leagueName,
      starting_value: DAY_TRADER_STARTING_VALUE,
      cash_balance: 0,
    })
    .select("*")
    .single();

  if (entryError || !entry) {
    if (entryError?.code === "23505") {
      return { ok: false, error: "You already entered this week's contest." };
    }
    return {
      ok: false,
      error: entryError?.message ?? "Could not create Day Trader entry.",
    };
  }

  const positionRows = starters.picks.map((pick, index) => {
    const price = quotes.get(pick.symbol)!.price;
    const shares = DAY_TRADER_STOCK_BUDGET / price;
    return {
      entry_id: entry.id,
      symbol: pick.symbol,
      shares,
      slot_order: index,
      source_pick_id: pick.id,
    };
  });

  const { error: positionsError } = await supabase
    .from("day_trader_positions")
    .insert(positionRows);

  if (positionsError) {
    await supabase.from("day_trader_entries").delete().eq("id", entry.id);
    return {
      ok: false,
      error: positionsError.message ?? "Could not copy starter positions.",
    };
  }

  return { ok: true, entry: entry as DayTraderEntryRow };
}
