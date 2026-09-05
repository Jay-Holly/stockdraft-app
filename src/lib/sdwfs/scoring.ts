import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { prizePoolFromEntries } from "@/lib/contest-fee";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type SdwfsPayout = {
  entryId: string;
  totalScore: number;
  finalRank: number;
  payout: number;
};

/**
 * Ranks entries by total_score desc, splits the pool evenly across the paid
 * places (1st-3rd, 50/30/20) whenever entries tie within or across that
 * range, so a tie straddling e.g. 2nd/3rd still sums to the 2nd+3rd share.
 */
export function computeSdwfsPayouts(
  entries: readonly { entryId: string; totalScore: number }[],
  prizePool: number
): SdwfsPayout[] {
  const placeShares = [0.5, 0.3, 0.2]; // 1st, 2nd, 3rd

  const sorted = [...entries].sort((a, b) => b.totalScore - a.totalScore);

  // Group entries by score so ties share a rank band.
  const groups: { totalScore: number; entryIds: string[] }[] = [];
  for (const entry of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.totalScore === entry.totalScore) {
      last.entryIds.push(entry.entryId);
    } else {
      groups.push({ totalScore: entry.totalScore, entryIds: [entry.entryId] });
    }
  }

  const payouts: SdwfsPayout[] = [];
  let placeIndex = 0; // 0-based index into placeShares for the next unassigned place

  for (const group of groups) {
    const placesInGroup = group.entryIds.length;
    const shareIndices = Array.from(
      { length: placesInGroup },
      (_, i) => placeIndex + i
    ).filter((i) => i < placeShares.length);

    const totalShareForGroup = shareIndices.reduce(
      (sum, i) => sum + placeShares[i],
      0
    );
    const perEntryPayout =
      totalShareForGroup > 0
        ? (totalShareForGroup * prizePool) / placesInGroup
        : 0;

    for (const entryId of group.entryIds) {
      payouts.push({
        entryId,
        totalScore: group.totalScore,
        finalRank: placeIndex + 1,
        payout: Math.round(perEntryPayout * 100) / 100,
      });
    }

    placeIndex += placesInGroup;
  }

  return payouts;
}

export async function finalizeSdwfsContest(
  supabase: ServiceClient,
  contestId: string,
  options?: { creditWallets?: boolean }
): Promise<{ entriesScored: number }> {
  const creditWallets = options?.creditWallets !== false;

  const { data: contest, error: contestError } = await supabase
    .from("sdwfs_contests")
    .select("id, buy_in, status")
    .eq("id", contestId)
    .maybeSingle();

  if (contestError) {
    throw new Error(`Failed to load contest: ${contestError.message}`);
  }
  if (!contest) {
    throw new Error(`Contest ${contestId} not found`);
  }
  if (contest.status === "scored") {
    return { entriesScored: 0 };
  }

  const { data: entries, error: entriesError } = await supabase
    .from("sdwfs_entries")
    .select("id")
    .eq("contest_id", contestId);

  if (entriesError) {
    throw new Error(`Failed to load entries: ${entriesError.message}`);
  }
  if (!entries || entries.length === 0) {
    await supabase
      .from("sdwfs_contests")
      .update({ status: "scored" })
      .eq("id", contestId);
    return { entriesScored: 0 };
  }

  // Same 1,000-row PostgREST cap as the SDDFS twin of this function — a
  // contest over ~83 entries would silently lose picks past that row and
  // wrongly exclude their entries from ranking and payout. Not yet triggered
  // here (no SDWFS contest has crossed that size), but the failure mode is
  // identical, so fixed the same way pre-emptively.
  const entryIds = entries.map((e) => e.id);
  const picks: { entry_id: string; pct_change: number | null }[] = [];
  const SELECT_PAGE_SIZE = 1000;
  for (let from = 0; ; from += SELECT_PAGE_SIZE) {
    const { data: page, error: picksError } = await supabase
      .from("sdwfs_entry_picks")
      .select("entry_id, pct_change")
      .in("entry_id", entryIds)
      .range(from, from + SELECT_PAGE_SIZE - 1);

    if (picksError) {
      throw new Error(`Failed to load picks: ${picksError.message}`);
    }
    picks.push(...(page ?? []));
    if (!page || page.length < SELECT_PAGE_SIZE) break;
  }

  const pickCountByEntry = new Map<string, number>();
  const scoreByEntry = new Map<string, number>();
  for (const entry of entries) {
    pickCountByEntry.set(entry.id, 0);
    scoreByEntry.set(entry.id, 0);
  }
  for (const pick of picks ?? []) {
    pickCountByEntry.set(pick.entry_id, (pickCountByEntry.get(pick.entry_id) ?? 0) + 1);
    const current = scoreByEntry.get(pick.entry_id) ?? 0;
    scoreByEntry.set(pick.entry_id, current + (pick.pct_change ?? 0));
  }

  // An entry with fewer than 12 picks never paid its fee and never had a real
  // lineup — see the matching comment in sddfs/scoring.ts. Excluded entirely
  // from ranking, payout, and the prize pool's entrant count.
  const validEntries = entries.filter((e) => pickCountByEntry.get(e.id) === 12);
  const invalidEntries = entries.filter((e) => pickCountByEntry.get(e.id) !== 12);
  if (invalidEntries.length > 0) {
    console.error(
      `[sdwfs-scoring] contest ${contestId}: excluding ${invalidEntries.length} entry(ies) with an incomplete lineup from ranking: ${invalidEntries.map((e) => e.id).join(", ")}`
    );
  }

  const prizePool = prizePoolFromEntries(contest.buy_in, validEntries.length);

  const payouts = computeSdwfsPayouts(
    validEntries.map((e) => ({
      entryId: e.id,
      totalScore: scoreByEntry.get(e.id) ?? 0,
    })),
    prizePool
  );

  for (const payout of payouts) {
    const { data: entry, error: fetchError } = await supabase
      .from("sdwfs_entries")
      .select("user_id")
      .eq("id", payout.entryId)
      .maybeSingle();

    if (fetchError || !entry) {
      throw new Error(
        `Failed to fetch entry ${payout.entryId}: ${fetchError?.message}`
      );
    }

    const { error: updateError } = await supabase
      .from("sdwfs_entries")
      .update({
        total_score: payout.totalScore,
        final_rank: payout.finalRank,
        payout: payout.payout,
      })
      .eq("id", payout.entryId);

    if (updateError) {
      throw new Error(
        `Failed to update entry ${payout.entryId}: ${updateError.message}`
      );
    }

    // Credit winner's wallet if they won prize money (only if creditWallets enabled)
    if (creditWallets && payout.payout > 0) {
      const { error: walletError } = await supabase
        .from("wallet_transactions")
        .insert({
          user_id: entry.user_id,
          type: "win",
          amount: payout.payout,
          status: "completed",
          description: `SDWFS weekly contest win - Rank #${payout.finalRank}`,
        });

      if (walletError) {
        throw new Error(
          `Failed to credit wallet for entry ${payout.entryId}: ${walletError.message}`
        );
      }
    }
  }

  await supabase
    .from("sdwfs_contests")
    .update({ status: "scored" })
    .eq("id", contestId);

  return { entriesScored: payouts.length };
}
