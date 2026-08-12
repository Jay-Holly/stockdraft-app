import "server-only";

import {
  activeSdwfsContestWeekIso,
  ensureThisWeeksSdwfsContests,
} from "@/lib/wfs/contests";
import { fetchLiveSdwfsQuotes } from "@/lib/sdwfs/live-quotes";
import { createServiceClient } from "@/lib/supabase/service";
import { finalizeSdwfsContest } from "@/lib/sdwfs/scoring";
import { isUsableQuote, safePctChange } from "@/lib/market/quote-guards";

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

  // Gather every pick across every due contest BEFORE quoting. Fetching per
  // contest meant one near-identical round of lookups per buy-in tier within
  // the same minute; the later rounds got rate-limited into returning nothing,
  // silently leaving those picks with no baseline at all. One fetch covers the
  // whole lock.
  const picksByContest = new Map<string, { id: string; symbol: string }[]>();

  for (const contest of dueContests) {
    const { data: entries } = await supabase
      .from("sdwfs_entries")
      .select("id")
      .eq("contest_id", contest.id);

    const entryIds = (entries ?? []).map((e) => e.id);
    if (entryIds.length === 0) {
      picksByContest.set(contest.id, []);
      continue;
    }

    const { data: picks } = await supabase
      .from("sdwfs_entry_picks")
      .select("id, symbol")
      .in("entry_id", entryIds);

    picksByContest.set(contest.id, picks ?? []);
  }

  const allSymbols = [
    ...new Set([...picksByContest.values()].flat().map((p) => p.symbol)),
  ];
  const prices =
    allSymbols.length > 0
      ? await fetchLiveSdwfsQuotes(allSymbols, { verifyAgainstSecondSource: true })
      : {};

  const results: { contestId: string; picksSnapshotted: number }[] = [];

  for (const contest of dueContests) {
    const picks = picksByContest.get(contest.id) ?? [];

    for (const pick of picks) {
      const openPrice = prices[pick.symbol.toUpperCase()];

      // Never persist a baseline we don't trust — every later score is
      // measured against it. Leaving it null scores the pick neutral.
      if (!isUsableQuote(openPrice)) {
        console.error(
          `[sdwfs] no usable open quote for ${pick.symbol} (pick ${pick.id}); leaving baseline unset`
        );
        continue;
      }

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

  // Batched for the same reason as the lock: one quote round covering every
  // contest being scored, so later tiers can't be rate-limited into picks that
  // score neutral through no fault of the player.
  const picksByContest = new Map<
    string,
    { id: string; symbol: string; open_price: number | null }[]
  >();

  for (const contest of lockedContests) {
    const { data: entries } = await supabase
      .from("sdwfs_entries")
      .select("id")
      .eq("contest_id", contest.id);

    const entryIds = (entries ?? []).map((e) => e.id);
    if (entryIds.length === 0) {
      picksByContest.set(contest.id, []);
      continue;
    }

    const { data: picks } = await supabase
      .from("sdwfs_entry_picks")
      .select("id, symbol, open_price")
      .in("entry_id", entryIds);

    picksByContest.set(contest.id, picks ?? []);
  }

  const allSymbols = [
    ...new Set([...picksByContest.values()].flat().map((p) => p.symbol)),
  ];
  const prices =
    allSymbols.length > 0
      ? await fetchLiveSdwfsQuotes(allSymbols, { verifyAgainstSecondSource: true })
      : {};

  const results: { contestId: string; entriesScored: number }[] = [];

  for (const contest of lockedContests) {
    const picks = picksByContest.get(contest.id) ?? [];

    for (const pick of picks) {
      const closePrice = prices[pick.symbol.toUpperCase()];
      const pctChange = safePctChange(pick.open_price, closePrice);

      if (pctChange === null) {
        console.error(
          `[sdwfs] unscoreable pick ${pick.id} (${pick.symbol}): open=${pick.open_price} close=${closePrice}; scoring neutral`
        );
      }

      await supabase
        .from("sdwfs_entry_picks")
        .update({
          close_price: isUsableQuote(closePrice) ? closePrice : null,
          pct_change: pctChange,
        })
        .eq("id", pick.id);
    }

    // A pick with a real open but still no close after this run means the
    // quote fetch failed for it, not that it's genuinely unscoreable —
    // finalizing anyway pads it to 0% and can hand out rankings and real
    // payouts that don't reflect what actually happened. Leave the contest
    // locked so the next run retries; only a pick whose open itself was
    // never usable is treated as permanently neutral by design.
    const stillMissingClose = picks.some(
      (pick) =>
        isUsableQuote(pick.open_price) &&
        !isUsableQuote(prices[pick.symbol.toUpperCase()])
    );

    if (stillMissingClose) {
      console.error(
        `[sdwfs] contest ${contest.id} has picks still missing a close price; holding off finalize, will retry next run`
      );
      continue;
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
