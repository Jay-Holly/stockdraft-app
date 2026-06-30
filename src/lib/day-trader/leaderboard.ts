import "server-only";

import { DAY_TRADER_STARTING_VALUE } from "@/lib/day-trader/constants";
import {
  computeDayTraderEntryValue,
  computeDayTraderFinalMetrics,
  fetchDayTraderPositionQuotes,
} from "@/lib/day-trader/portfolio-value";
import type { DayTraderEntryRow } from "@/lib/day-trader/types";
import { createClient } from "@/lib/supabase/server";

export type DayTraderLeaderboardMetric = "dollar" | "percent";

export type DayTraderLeaderboardRow = {
  rank: number;
  entryId: string;
  userId: string;
  username: string;
  teamName: string;
  enteredAt: string;
  dollarGain: number;
  percentGain: number;
  score: number;
  isLive: boolean;
};

type ScoredEntry = {
  entry: DayTraderEntryRow;
  username: string;
  teamName: string;
  dollarGain: number;
  percentGain: number;
  isLive: boolean;
};

/** Tiebreak: earlier `entered_at` wins when scores match. */
export function compareDayTraderLeaderboardRows(
  a: Pick<ScoredEntry, "dollarGain" | "percentGain" | "entry">,
  b: Pick<ScoredEntry, "dollarGain" | "percentGain" | "entry">,
  metric: DayTraderLeaderboardMetric
): number {
  const scoreA = metric === "dollar" ? a.dollarGain : a.percentGain;
  const scoreB = metric === "dollar" ? b.dollarGain : b.percentGain;

  if (scoreB !== scoreA) {
    return scoreB - scoreA;
  }

  return a.entry.entered_at.localeCompare(b.entry.entered_at);
}

function rankLeaderboardRows(
  rows: ScoredEntry[],
  metric: DayTraderLeaderboardMetric
): DayTraderLeaderboardRow[] {
  const sorted = [...rows].sort((a, b) =>
    compareDayTraderLeaderboardRows(a, b, metric)
  );

  return sorted.map((row, index) => ({
    rank: index + 1,
    entryId: row.entry.id,
    userId: row.entry.user_id,
    username: row.username,
    teamName: row.teamName,
    enteredAt: row.entry.entered_at,
    dollarGain: row.dollarGain,
    percentGain: row.percentGain,
    score: metric === "dollar" ? row.dollarGain : row.percentGain,
    isLive: row.isLive,
  }));
}

async function loadContestEntries(
  contestId: string
): Promise<DayTraderEntryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("day_trader_entries")
    .select("*")
    .eq("contest_id", contestId);

  if (error) {
    throw new Error(`Failed to load Day Trader entries: ${error.message}`);
  }

  return (data as DayTraderEntryRow[]) ?? [];
}

async function loadProfilesForUsers(
  userIds: string[]
): Promise<Map<string, { username: string; teamName: string }>> {
  if (userIds.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, team_name")
    .in("id", userIds);

  if (error) {
    throw new Error(`Failed to load profiles: ${error.message}`);
  }

  return new Map(
    (data ?? []).map((profile) => [
      profile.id,
      { username: profile.username, teamName: profile.team_name },
    ])
  );
}

async function scoreEntriesForLeaderboard(
  entries: DayTraderEntryRow[]
): Promise<ScoredEntry[]> {
  if (entries.length === 0) return [];

  const supabase = await createClient();
  const entryIds = entries.map((entry) => entry.id);
  const { data: positions, error: positionsError } = await supabase
    .from("day_trader_positions")
    .select("entry_id, symbol, shares")
    .in("entry_id", entryIds);

  if (positionsError) {
    throw new Error(
      `Failed to load Day Trader positions: ${positionsError.message}`
    );
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

  const profiles = await loadProfilesForUsers(
    entries.map((entry) => entry.user_id)
  );

  return entries.map((entry) => {
    const profile = profiles.get(entry.user_id);
    const startingValue = Number(entry.starting_value) || DAY_TRADER_STARTING_VALUE;

    let dollarGain: number;
    let percentGain: number;
    let isLive = false;

    if (entry.final_dollar_gain != null && entry.final_pct_gain != null) {
      dollarGain = Number(entry.final_dollar_gain);
      percentGain = Number(entry.final_pct_gain);
    } else {
      const entryPositions = positionsByEntry.get(entry.id) ?? [];
      const currentValue = computeDayTraderEntryValue(
        Number(entry.cash_balance),
        entryPositions,
        quotes
      );
      const metrics = computeDayTraderFinalMetrics(startingValue, currentValue);
      dollarGain = metrics.finalDollarGain;
      percentGain = metrics.finalPctGain;
      isLive = true;
    }

    return {
      entry,
      username: profile?.username ?? "Unknown",
      teamName: profile?.teamName ?? "Team",
      dollarGain,
      percentGain,
      isLive,
    };
  });
}

/**
 * Finalized contests: DB ORDER BY gain DESC, entered_at ASC (tiebreak).
 * Open contests: same sort applied in memory on live marks.
 */
export async function loadDayTraderDollarLeaderboard(
  contestId: string
): Promise<DayTraderLeaderboardRow[]> {
  const supabase = await createClient();
  const { data: contest } = await supabase
    .from("day_trader_contests")
    .select("status")
    .eq("id", contestId)
    .maybeSingle();

  if (contest?.status === "finalized") {
    const { data, error } = await supabase
      .from("day_trader_entries")
      .select("*")
      .eq("contest_id", contestId)
      .not("final_dollar_gain", "is", null)
      .order("final_dollar_gain", { ascending: false })
      .order("entered_at", { ascending: true });

    if (error) {
      throw new Error(
        `Failed to load dollar leaderboard: ${error.message}`
      );
    }

    const entries = (data as DayTraderEntryRow[]) ?? [];
    const profiles = await loadProfilesForUsers(
      entries.map((entry) => entry.user_id)
    );

    return entries.map((entry, index) => ({
      rank: index + 1,
      entryId: entry.id,
      userId: entry.user_id,
      username: profiles.get(entry.user_id)?.username ?? "Unknown",
      teamName: profiles.get(entry.user_id)?.teamName ?? "Team",
      enteredAt: entry.entered_at,
      dollarGain: Number(entry.final_dollar_gain),
      percentGain: Number(entry.final_pct_gain ?? 0),
      score: Number(entry.final_dollar_gain),
      isLive: false,
    }));
  }

  const entries = await loadContestEntries(contestId);
  const scored = await scoreEntriesForLeaderboard(entries);
  return rankLeaderboardRows(scored, "dollar");
}

/** Same tiebreak as dollar board: entered_at ASC when final_pct_gain ties. */
export async function loadDayTraderPercentLeaderboard(
  contestId: string
): Promise<DayTraderLeaderboardRow[]> {
  const supabase = await createClient();
  const { data: contest } = await supabase
    .from("day_trader_contests")
    .select("status")
    .eq("id", contestId)
    .maybeSingle();

  if (contest?.status === "finalized") {
    const { data, error } = await supabase
      .from("day_trader_entries")
      .select("*")
      .eq("contest_id", contestId)
      .not("final_pct_gain", "is", null)
      .order("final_pct_gain", { ascending: false })
      .order("entered_at", { ascending: true });

    if (error) {
      throw new Error(
        `Failed to load percent leaderboard: ${error.message}`
      );
    }

    const entries = (data as DayTraderEntryRow[]) ?? [];
    const profiles = await loadProfilesForUsers(
      entries.map((entry) => entry.user_id)
    );

    return entries.map((entry, index) => ({
      rank: index + 1,
      entryId: entry.id,
      userId: entry.user_id,
      username: profiles.get(entry.user_id)?.username ?? "Unknown",
      teamName: profiles.get(entry.user_id)?.teamName ?? "Team",
      enteredAt: entry.entered_at,
      dollarGain: Number(entry.final_dollar_gain ?? 0),
      percentGain: Number(entry.final_pct_gain),
      score: Number(entry.final_pct_gain),
      isLive: false,
    }));
  }

  const entries = await loadContestEntries(contestId);
  const scored = await scoreEntriesForLeaderboard(entries);
  return rankLeaderboardRows(scored, "percent");
}
