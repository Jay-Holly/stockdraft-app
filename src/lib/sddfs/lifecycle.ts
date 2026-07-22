import "server-only";

import { getEasternParts } from "@/lib/season/eastern-time";
import {
  activeSddfsContestDateIso,
  ensureTodaysSddfsContests,
} from "@/lib/dfs/contests";
import { fetchLiveSddfsQuotes } from "@/lib/sddfs/live-quotes";
import { createServiceClient } from "@/lib/supabase/service";
import { finalizeSddfsContest } from "@/lib/sddfs/scoring";

type ServiceClient = ReturnType<typeof createServiceClient>;

const MARKET_CLOSE_HOUR_ET = 16;

/** Locks any 'open' contests past lock_at and snapshots each pick's open price. */
async function lockDueContests(
  supabase: ServiceClient
): Promise<{ contestId: string; picksSnapshotted: number }[]> {
  const nowIso = new Date().toISOString();

  const { data: dueContests, error } = await supabase
    .from("sddfs_contests")
    .select("id")
    .eq("status", "open")
    .lte("lock_at", nowIso);

  if (error) {
    throw new Error(`Failed to load due contests: ${error.message}`);
  }
  if (!dueContests || dueContests.length === 0) return [];

  const results: { contestId: string; picksSnapshotted: number }[] = [];

  for (const contest of dueContests) {
    const { data: entries } = await supabase
      .from("sddfs_entries")
      .select("id")
      .eq("contest_id", contest.id);

    const entryIds = (entries ?? []).map((e) => e.id);
    if (entryIds.length === 0) {
      await supabase
        .from("sddfs_contests")
        .update({ status: "locked" })
        .eq("id", contest.id);
      results.push({ contestId: contest.id, picksSnapshotted: 0 });
      continue;
    }

    const { data: picks } = await supabase
      .from("sddfs_entry_picks")
      .select("id, symbol")
      .in("entry_id", entryIds);

    const symbols = [...new Set((picks ?? []).map((p) => p.symbol))];
    const prices = await fetchLiveSddfsQuotes(symbols);

    for (const pick of picks ?? []) {
      const openPrice = prices[pick.symbol.toUpperCase()] ?? 0;
      await supabase
        .from("sddfs_entry_picks")
        .update({ open_price: openPrice })
        .eq("id", pick.id);
    }

    await supabase
      .from("sddfs_contests")
      .update({ status: "locked" })
      .eq("id", contest.id);

    results.push({ contestId: contest.id, picksSnapshotted: picks?.length ?? 0 });
  }

  return results;
}

/** Scores any 'locked' contests once the market has closed for their date. */
async function scoreClosedContests(
  supabase: ServiceClient
): Promise<{ contestId: string; entriesScored: number }[]> {
  const easternNow = getEasternParts(new Date());
  if (easternNow.hour < MARKET_CLOSE_HOUR_ET) return [];

  const contestDate = `${easternNow.year}-${String(easternNow.month).padStart(
    2,
    "0"
  )}-${String(easternNow.day).padStart(2, "0")}`;

  const { data: lockedContests, error } = await supabase
    .from("sddfs_contests")
    .select("id")
    .eq("status", "locked")
    .lte("contest_date", contestDate);

  if (error) {
    throw new Error(`Failed to load locked contests: ${error.message}`);
  }
  if (!lockedContests || lockedContests.length === 0) return [];

  const results: { contestId: string; entriesScored: number }[] = [];

  for (const contest of lockedContests) {
    const { data: entries } = await supabase
      .from("sddfs_entries")
      .select("id")
      .eq("contest_id", contest.id);

    const entryIds = (entries ?? []).map((e) => e.id);

    if (entryIds.length > 0) {
      const { data: picks } = await supabase
        .from("sddfs_entry_picks")
        .select("id, symbol, open_price")
        .in("entry_id", entryIds);

      const symbols = [...new Set((picks ?? []).map((p) => p.symbol))];
      const prices = await fetchLiveSddfsQuotes(symbols);

      for (const pick of picks ?? []) {
        const closePrice = prices[pick.symbol.toUpperCase()] ?? 0;
        const openPrice = pick.open_price ?? 0;
        const pctChange =
          openPrice > 0 ? ((closePrice - openPrice) / openPrice) * 100 : 0;

        await supabase
          .from("sddfs_entry_picks")
          .update({ close_price: closePrice, pct_change: pctChange })
          .eq("id", pick.id);
      }
    }

    const { entriesScored } = await finalizeSddfsContest(supabase, contest.id);
    results.push({ contestId: contest.id, entriesScored });
  }

  return results;
}

export async function runSddfsLifecycle(): Promise<{
  locked: { contestId: string; picksSnapshotted: number }[];
  scored: { contestId: string; entriesScored: number }[];
}> {
  const supabase = createServiceClient();
  const locked = await lockDueContests(supabase);
  const scored = await scoreClosedContests(supabase);
  // Proactively create the next active contest date's rows (a no-op before
  // today's 4 PM ET close) so tomorrow's contests are already open and
  // enterable right after close, instead of waiting for someone to load
  // the lobby.
  await ensureTodaysSddfsContests(supabase, activeSddfsContestDateIso());
  return { locked, scored };
}
