import "server-only";

import {
  activeSdwfsContestWeekIso,
  ensureThisWeeksSdwfsContests,
} from "@/lib/wfs/contests";
import { fetchLiveSdwfsQuotes } from "@/lib/sdwfs/live-quotes";
import { createServiceClient } from "@/lib/supabase/service";
import { finalizeSdwfsContest } from "@/lib/sdwfs/scoring";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Locks any 'open' contests past lock_at (Monday 9 AM ET) and snapshots
 * each pick's open price using a live Monday-morning quote.
 */
async function lockDueContests(
  supabase: ServiceClient
): Promise<{ contestId: string; picksSnapshotted: number }[]> {
  const nowIso = new Date().toISOString();

  const { data: dueContests, error } = await supabase
    .from("sdwfs_contests")
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
      .from("sdwfs_entries")
      .select("id")
      .eq("contest_id", contest.id);

    const entryIds = (entries ?? []).map((e) => e.id);
    if (entryIds.length === 0) {
      await supabase
        .from("sdwfs_contests")
        .update({ status: "locked" })
        .eq("id", contest.id);
      results.push({ contestId: contest.id, picksSnapshotted: 0 });
      continue;
    }

    const { data: picks } = await supabase
      .from("sdwfs_entry_picks")
      .select("id, symbol")
      .in("entry_id", entryIds);

    const symbols = [...new Set((picks ?? []).map((p) => p.symbol))];
    const prices = await fetchLiveSdwfsQuotes(symbols);

    for (const pick of picks ?? []) {
      const openPrice = prices[pick.symbol.toUpperCase()] ?? 0;
      await supabase
        .from("sdwfs_entry_picks")
        .update({ open_price: openPrice })
        .eq("id", pick.id);
    }

    await supabase
      .from("sdwfs_contests")
      .update({ status: "locked" })
      .eq("id", contest.id);

    results.push({ contestId: contest.id, picksSnapshotted: picks?.length ?? 0 });
  }

  return results;
}

/**
 * Scores any 'locked' contests once past their score_at (Friday 4 PM ET
 * close). Each pick's return is Monday's snapshotted open_price vs a live
 * Friday-close quote — cumulative week return, not day-over-day.
 */
async function scoreClosedContests(
  supabase: ServiceClient
): Promise<{ contestId: string; entriesScored: number }[]> {
  const nowIso = new Date().toISOString();

  const { data: lockedContests, error } = await supabase
    .from("sdwfs_contests")
    .select("id")
    .eq("status", "locked")
    .lte("score_at", nowIso);

  if (error) {
    throw new Error(`Failed to load locked contests: ${error.message}`);
  }
  if (!lockedContests || lockedContests.length === 0) return [];

  const results: { contestId: string; entriesScored: number }[] = [];

  for (const contest of lockedContests) {
    const { data: entries } = await supabase
      .from("sdwfs_entries")
      .select("id")
      .eq("contest_id", contest.id);

    const entryIds = (entries ?? []).map((e) => e.id);

    if (entryIds.length > 0) {
      const { data: picks } = await supabase
        .from("sdwfs_entry_picks")
        .select("id, symbol, open_price")
        .in("entry_id", entryIds);

      const symbols = [...new Set((picks ?? []).map((p) => p.symbol))];
      const prices = await fetchLiveSdwfsQuotes(symbols);

      for (const pick of picks ?? []) {
        const closePrice = prices[pick.symbol.toUpperCase()] ?? 0;
        const openPrice = pick.open_price ?? 0;
        const pctChange =
          openPrice > 0 ? ((closePrice - openPrice) / openPrice) * 100 : 0;

        await supabase
          .from("sdwfs_entry_picks")
          .update({ close_price: closePrice, pct_change: pctChange })
          .eq("id", pick.id);
      }
    }

    const { entriesScored } = await finalizeSdwfsContest(supabase, contest.id);
    results.push({ contestId: contest.id, entriesScored });
  }

  return results;
}

export async function runSdwfsLifecycle(): Promise<{
  locked: { contestId: string; picksSnapshotted: number }[];
  scored: { contestId: string; entriesScored: number }[];
}> {
  const supabase = createServiceClient();
  const locked = await lockDueContests(supabase);
  const scored = await scoreClosedContests(supabase);
  // Proactively create the next active week's contest rows (a no-op before
  // this week's Friday 4 PM ET close) so next week's contests are already
  // open and enterable right after close, instead of waiting for someone
  // to load the lobby.
  await ensureThisWeeksSdwfsContests(supabase, activeSdwfsContestWeekIso());
  return { locked, scored };
}
