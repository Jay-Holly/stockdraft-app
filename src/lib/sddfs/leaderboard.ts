import "server-only";

import { fetchLiveSddfsQuotes } from "@/lib/sddfs/live-quotes";
import { computeSddfsPayouts } from "@/lib/sddfs/scoring";
import { createClient } from "@/lib/supabase/server";

export type SddfsLeaderboardPick = {
  sector: string;
  symbol: string;
  pctChange: number | null;
};

export type SddfsLeaderboardRow = {
  rank: number;
  entryId: string;
  userId: string;
  username: string;
  totalScore: number;
  payout: number;
  isLive: boolean;
  isMe: boolean;
  picks: SddfsLeaderboardPick[];
};

export type SddfsContestLeaderboard = {
  prizePool: number;
  isFinal: boolean;
  rows: SddfsLeaderboardRow[];
};

async function loadUsernames(
  userIds: string[]
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .in("id", userIds);

  if (error) {
    throw new Error(`Failed to load profiles: ${error.message}`);
  }

  return new Map((data ?? []).map((p) => [p.id, p.username as string]));
}

/**
 * Contest-wide standings for a single SDDFS contest. Scored contests read
 * the finalized total_score/final_rank/payout straight off sddfs_entries.
 * Open/locked contests project current standings live: open contests have
 * no open_price snapshot yet (0% pending), locked contests re-price every
 * pick against a live quote against its snapshotted open_price.
 */
export async function getSddfsContestLeaderboard(
  contestId: string,
  viewerUserId: string | null
): Promise<SddfsContestLeaderboard> {
  const supabase = await createClient();

  const { data: contest, error: contestError } = await supabase
    .from("sddfs_contests")
    .select("buy_in, status")
    .eq("id", contestId)
    .maybeSingle();

  if (contestError) {
    throw new Error(`Failed to load contest: ${contestError.message}`);
  }
  if (!contest) {
    return { prizePool: 0, isFinal: false, rows: [] };
  }

  const { data: entries, error: entriesError } = await supabase
    .from("sddfs_entries")
    .select("id, user_id, total_score, final_rank, payout")
    .eq("contest_id", contestId);

  if (entriesError) {
    throw new Error(`Failed to load entries: ${entriesError.message}`);
  }
  if (!entries || entries.length === 0) {
    return { prizePool: 0, isFinal: contest.status === "scored", rows: [] };
  }

  const { data: picks, error: picksError } = await supabase
    .from("sddfs_entry_picks")
    .select("entry_id, sector, symbol, open_price, pct_change")
    .in(
      "entry_id",
      entries.map((e) => e.id)
    );

  if (picksError) {
    throw new Error(`Failed to load picks: ${picksError.message}`);
  }

  const picksByEntry = new Map<string, typeof picks>();
  for (const pick of picks ?? []) {
    const list = picksByEntry.get(pick.entry_id) ?? [];
    list.push(pick);
    picksByEntry.set(pick.entry_id, list);
  }

  const usernames = await loadUsernames(entries.map((e) => e.user_id));
  const prizePool = Math.round(contest.buy_in * entries.length * 0.92 * 100) / 100;

  if (contest.status === "scored") {
    const rows: SddfsLeaderboardRow[] = entries
      .map((entry) => ({
        rank: entry.final_rank ?? entries.length,
        entryId: entry.id,
        userId: entry.user_id,
        username: usernames.get(entry.user_id) ?? "Unknown",
        totalScore: Number(entry.total_score ?? 0),
        payout: Number(entry.payout ?? 0),
        isLive: false,
        isMe: entry.user_id === viewerUserId,
        picks: (picksByEntry.get(entry.id) ?? []).map((p) => ({
          sector: p.sector,
          symbol: p.symbol,
          pctChange: p.pct_change,
        })),
      }))
      .sort((a, b) => a.rank - b.rank);

    return { prizePool, isFinal: true, rows };
  }

  // Open or locked: project live standings.
  const allSymbols =
    contest.status === "locked"
      ? [...new Set((picks ?? []).map((p) => p.symbol))]
      : [];
  const liveQuotes = await fetchLiveSddfsQuotes(allSymbols);

  const scoreByEntry = new Map<string, number>();
  const livePicksByEntry = new Map<string, SddfsLeaderboardPick[]>();

  for (const entry of entries) {
    const entryPicks = picksByEntry.get(entry.id) ?? [];
    let total = 0;
    const livePicks: SddfsLeaderboardPick[] = [];

    for (const pick of entryPicks) {
      const openPrice = Number(pick.open_price ?? 0);
      const livePrice = liveQuotes[pick.symbol.toUpperCase()] ?? 0;
      const pctChange =
        openPrice > 0 && livePrice > 0
          ? ((livePrice - openPrice) / openPrice) * 100
          : null;
      total += pctChange ?? 0;
      livePicks.push({ sector: pick.sector, symbol: pick.symbol, pctChange });
    }

    scoreByEntry.set(entry.id, total);
    livePicksByEntry.set(entry.id, livePicks);
  }

  const payouts = computeSddfsPayouts(
    entries.map((e) => ({
      entryId: e.id,
      totalScore: scoreByEntry.get(e.id) ?? 0,
    })),
    prizePool
  );
  const payoutByEntry = new Map(payouts.map((p) => [p.entryId, p]));

  const rows: SddfsLeaderboardRow[] = entries
    .map((entry) => {
      const payout = payoutByEntry.get(entry.id);
      return {
        rank: payout?.finalRank ?? entries.length,
        entryId: entry.id,
        userId: entry.user_id,
        username: usernames.get(entry.user_id) ?? "Unknown",
        totalScore: scoreByEntry.get(entry.id) ?? 0,
        payout: payout?.payout ?? 0,
        isLive: contest.status === "locked",
        isMe: entry.user_id === viewerUserId,
        picks: livePicksByEntry.get(entry.id) ?? [],
      };
    })
    .sort((a, b) => a.rank - b.rank);

  return { prizePool, isFinal: false, rows };
}
