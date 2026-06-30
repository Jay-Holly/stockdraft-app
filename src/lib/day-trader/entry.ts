import "server-only";

import {
  DAY_TRADER_STARTING_VALUE,
  DAY_TRADER_STOCK_BUDGET,
} from "@/lib/day-trader/constants";
import { getDayTraderContestContext } from "@/lib/day-trader/contest-access";
import {
  getDayTraderEntryBlockedMessage,
  isDayTraderEntryWindowOpenForContest,
  isDayTraderTradingWeekUnderway,
} from "@/lib/day-trader/contest-period";
import { loadLeagueName, loadLeagueStockStarters } from "@/lib/day-trader/starters";
import type { DayTraderContestRow, DayTraderEntryRow } from "@/lib/day-trader/types";
import { fetchStockQuotes } from "@/lib/roster/quotes";
import { createClient } from "@/lib/supabase/server";

export type CreateDayTraderEntryResult =
  | { ok: true; entry: DayTraderEntryRow }
  | { ok: false; error: string };

export type CreateDayTraderEntryOptions = {
  /** Admin beta: skip Fri 4 PM – Mon 9:30 AM entry window check. */
  bypassEntryWindow?: boolean;
  contestId?: string;
};

async function resolveContestForEntry(
  userId: string,
  now: Date,
  contestId?: string
): Promise<DayTraderContestRow | null> {
  if (contestId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("day_trader_contests")
      .select("*")
      .eq("id", contestId)
      .maybeSingle();
    return (data as DayTraderContestRow | null) ?? null;
  }

  const context = await getDayTraderContestContext(userId, now);
  return context.contest;
}

export async function createDayTraderEntry(
  userId: string,
  leagueId: string,
  now: Date = new Date(),
  options?: CreateDayTraderEntryOptions
): Promise<CreateDayTraderEntryResult> {
  const contest = await resolveContestForEntry(userId, now, options?.contestId);
  if (!contest) {
    return { ok: false, error: "No Day Trader contest is accepting entries." };
  }

  if (
    !options?.bypassEntryWindow &&
    !isDayTraderEntryWindowOpenForContest(now, contest)
  ) {
    return {
      ok: false,
      error: getDayTraderEntryBlockedMessage(now, contest),
    };
  }

  if (
    options?.bypassEntryWindow &&
    !isDayTraderEntryWindowOpenForContest(now, contest) &&
    !isDayTraderTradingWeekUnderway(now, contest)
  ) {
    return {
      ok: false,
      error:
        "No active contest week to force entry into. Wait for lifecycle sync or pass contestId.",
    };
  }

  const supabase = await createClient();
  const { data: existingEntry } = await supabase
    .from("day_trader_entries")
    .select("*")
    .eq("contest_id", contest.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingEntry) {
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
      error: `Missing prices for: ${missingPrices.join(", ")}. Try again shortly.`,
    };
  }

  const leagueName = (await loadLeagueName(leagueId)) ?? "League";

  const { data: entry, error: entryError } = await supabase
    .from("day_trader_entries")
    .insert({
      contest_id: contest.id,
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
