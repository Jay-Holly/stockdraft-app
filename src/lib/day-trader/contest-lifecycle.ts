import "server-only";

import { DAY_TRADER_STARTING_VALUE } from "@/lib/day-trader/constants";
import {
  getDayTraderUpcomingWeekBounds,
  getDayTraderWeekBounds,
  isDayTraderTradingWindowOpen,
} from "@/lib/day-trader/contest-period";
import {
  computeDayTraderEntryValue,
  computeDayTraderFinalMetrics,
  fetchDayTraderPositionQuotes,
} from "@/lib/day-trader/portfolio-value";
import type { DayTraderContestRow } from "@/lib/day-trader/types";
import { createServiceClient } from "@/lib/supabase/service";

export type DayTraderLifecycleResult = {
  finalized: Array<{ contestId: string; entriesUpdated: number }>;
  opened: Array<{ contestId: string }>;
  created: Array<{ contestId: string; weekStart: string }>;
  skipped: string[];
};

type ServiceClient = ReturnType<typeof createServiceClient>;

async function loadLatestFinalizedContest(
  supabase: ServiceClient
): Promise<DayTraderContestRow | null> {
  const { data } = await supabase
    .from("day_trader_contests")
    .select("*")
    .eq("status", "finalized")
    .order("week_start_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as DayTraderContestRow | null) ?? null;
}

async function finalizeContest(
  supabase: ServiceClient,
  contest: DayTraderContestRow
): Promise<number> {
  const { data: entries, error: entriesError } = await supabase
    .from("day_trader_entries")
    .select("id, starting_value, cash_balance, final_value")
    .eq("contest_id", contest.id);

  if (entriesError) {
    throw new Error(`Failed to load entries: ${entriesError.message}`);
  }

  const pending =
    entries?.filter((entry) => entry.final_value == null) ?? [];

  if (pending.length === 0) {
    await supabase
      .from("day_trader_contests")
      .update({ status: "finalized", updated_at: new Date().toISOString() })
      .eq("id", contest.id);
    return 0;
  }

  const entryIds = pending.map((entry) => entry.id);
  const { data: positions, error: positionsError } = await supabase
    .from("day_trader_positions")
    .select("entry_id, symbol, shares")
    .in("entry_id", entryIds);

  if (positionsError) {
    throw new Error(`Failed to load positions: ${positionsError.message}`);
  }

  const positionsByEntry = new Map<
    string,
    Array<{ symbol: string; shares: number }>
  >();
  for (const position of positions ?? []) {
    const list = positionsByEntry.get(position.entry_id) ?? [];
    list.push({
      symbol: position.symbol,
      shares: Number(position.shares),
    });
    positionsByEntry.set(position.entry_id, list);
  }

  const allSymbols = [
    ...new Set(
      (positions ?? []).map((position) => String(position.symbol).toUpperCase())
    ),
  ];
  const quotes = await fetchDayTraderPositionQuotes(
    allSymbols.map((symbol) => ({ symbol }))
  );

  let updated = 0;
  for (const entry of pending) {
    const entryPositions = positionsByEntry.get(entry.id) ?? [];
    const finalValue = computeDayTraderEntryValue(
      Number(entry.cash_balance),
      entryPositions,
      quotes
    );
    const startingValue = Number(entry.starting_value) || DAY_TRADER_STARTING_VALUE;
    const { finalDollarGain, finalPctGain } = computeDayTraderFinalMetrics(
      startingValue,
      finalValue
    );

    const { error: updateError } = await supabase
      .from("day_trader_entries")
      .update({
        final_value: finalValue,
        final_dollar_gain: finalDollarGain,
        final_pct_gain: finalPctGain,
      })
      .eq("id", entry.id);

    if (updateError) {
      throw new Error(
        `Failed to snapshot entry ${entry.id}: ${updateError.message}`
      );
    }
    updated += 1;
  }

  await supabase
    .from("day_trader_contests")
    .update({ status: "finalized", updated_at: new Date().toISOString() })
    .eq("id", contest.id);

  return updated;
}

async function ensureContestRow(
  supabase: ServiceClient,
  weekStart: Date,
  weekEnd: Date,
  now: Date
): Promise<{ action: "created" | "opened" | "unchanged"; contestId: string }> {
  const weekStartIso = weekStart.toISOString();
  const { data: existing, error: loadError } = await supabase
    .from("day_trader_contests")
    .select("*")
    .eq("week_start_at", weekStartIso)
    .maybeSingle();

  if (loadError) {
    throw new Error(`Failed to load contest: ${loadError.message}`);
  }

  if (existing) {
    const contest = existing as DayTraderContestRow;
    if (
      contest.status === "upcoming" &&
      isDayTraderTradingWindowOpen(now) &&
      now >= new Date(contest.week_start_at) &&
      now < new Date(contest.week_end_at)
    ) {
      await supabase
        .from("day_trader_contests")
        .update({ status: "open", updated_at: now.toISOString() })
        .eq("id", contest.id);
      return { action: "opened", contestId: contest.id };
    }
    return { action: "unchanged", contestId: contest.id };
  }

  const template = await loadLatestFinalizedContest(supabase);
  const status = isDayTraderTradingWindowOpen(now) ? "open" : "upcoming";

  const { data: created, error: createError } = await supabase
    .from("day_trader_contests")
    .insert({
      week_start_at: weekStartIso,
      week_end_at: weekEnd.toISOString(),
      status,
      contest_name: template?.contest_name ?? "Day Trader",
      dollar_prize_text: template?.dollar_prize_text ?? "",
      percent_prize_text: template?.percent_prize_text ?? "",
      updated_at: now.toISOString(),
    })
    .select("id")
    .single();

  if (createError || !created) {
    throw new Error(
      `Failed to create contest: ${createError?.message ?? "unknown error"}`
    );
  }

  return {
    action: status === "open" ? "opened" : "created",
    contestId: created.id,
  };
}

/**
 * Finalize overdue contests, open upcoming ones, and ensure the next contest row exists.
 * Safe to call from cron and on dashboard/API visits (step 2+).
 */
export async function syncDayTraderContestLifecycle(
  now: Date = new Date(),
  options?: { supabase?: ServiceClient }
): Promise<DayTraderLifecycleResult> {
  const supabase = options?.supabase ?? createServiceClient();
  const result: DayTraderLifecycleResult = {
    finalized: [],
    opened: [],
    created: [],
    skipped: [],
  };

  const nowIso = now.toISOString();
  const { data: overdue, error: overdueError } = await supabase
    .from("day_trader_contests")
    .select("*")
    .in("status", ["upcoming", "open", "closed"])
    .lte("week_end_at", nowIso);

  if (overdueError) {
    throw new Error(`Failed to load overdue contests: ${overdueError.message}`);
  }

  for (const contest of (overdue ?? []) as DayTraderContestRow[]) {
    const entriesUpdated = await finalizeContest(supabase, contest);
    result.finalized.push({ contestId: contest.id, entriesUpdated });
  }

  const { data: readyToOpen, error: openError } = await supabase
    .from("day_trader_contests")
    .select("*")
    .eq("status", "upcoming")
    .lte("week_start_at", nowIso)
    .gt("week_end_at", nowIso);

  if (openError) {
    throw new Error(`Failed to load upcoming contests: ${openError.message}`);
  }

  for (const contest of (readyToOpen ?? []) as DayTraderContestRow[]) {
    if (!isDayTraderTradingWindowOpen(now)) {
      result.skipped.push(`open-deferred:${contest.id}`);
      continue;
    }
    await supabase
      .from("day_trader_contests")
      .update({ status: "open", updated_at: nowIso })
      .eq("id", contest.id);
    result.opened.push({ contestId: contest.id });
  }

  const ensureBounds = isDayTraderTradingWindowOpen(now)
    ? getDayTraderWeekBounds(now)
    : getDayTraderUpcomingWeekBounds(now);

  const ensured = await ensureContestRow(
    supabase,
    ensureBounds.weekStart,
    ensureBounds.weekEnd,
    now
  );

  if (ensured.action === "created") {
    result.created.push({
      contestId: ensured.contestId,
      weekStart: ensureBounds.weekStart.toISOString(),
    });
  } else if (ensured.action === "opened") {
    result.opened.push({ contestId: ensured.contestId });
  }

  return result;
}
