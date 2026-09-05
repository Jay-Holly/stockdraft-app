import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { prizePoolFromEntries } from "@/lib/contest-fee";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type SddfsPayout = {
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
export function computeSddfsPayouts(
  entries: readonly { entryId: string; totalScore: number }[],
  prizePool: number
): SddfsPayout[] {
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

  const payouts: SddfsPayout[] = [];
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

export async function finalizeSddfsContest(
  supabase: ServiceClient,
  contestId: string,
  options?: { creditWallets?: boolean }
): Promise<{ entriesScored: number }> {
  const creditWallets = options?.creditWallets !== false;

  const { data: contest, error: contestError } = await supabase
    .from("sddfs_contests")
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
    .from("sddfs_entries")
    .select("id")
    .eq("contest_id", contestId);

  if (entriesError) {
    throw new Error(`Failed to load entries: ${entriesError.message}`);
  }
  if (!entries || entries.length === 0) {
    await supabase
      .from("sddfs_contests")
      .update({ status: "scored" })
      .eq("id", contestId);
    return { entriesScored: 0 };
  }

  // PostgREST caps a plain SELECT at 1,000 rows with no error. A contest over
  // ~83 entries (83 * 12 > 1,000) silently lost every pick past that row, and
  // every entry those picks belonged to then failed the "exactly 12 picks"
  // check below and got excluded from ranking and payout entirely — even
  // though its picks were real and correctly priced. Confirmed live on the
  // 2026-09-04 $2 (150 entries) and $5 (100 entries) contests: 67 and 93
  // entries respectively wrongly shut out this way. Page through so nothing
  // past the first page goes missing.
  const entryIds = entries.map((e) => e.id);
  const picks: { entry_id: string; pct_change: number | null }[] = [];
  const SELECT_PAGE_SIZE = 1000;
  for (let from = 0; ; from += SELECT_PAGE_SIZE) {
    const { data: page, error: picksError } = await supabase
      .from("sddfs_entry_picks")
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
  // lineup — the atomic RPC (migration 088) makes this impossible for new
  // entries, but this stays as a second line of defense. Seeding every entry
  // to a score of 0 and only crediting the ones with picks used to mean an
  // empty entry sat at a flat 0%, which beat every real entry on a red day and
  // won it real money. Excluded here entirely: no rank, no payout, and the
  // prize pool itself is sized off paying entrants only, so a phantom entry
  // can no longer inflate the pool it never contributed to.
  const validEntries = entries.filter((e) => pickCountByEntry.get(e.id) === 12);
  const invalidEntries = entries.filter((e) => pickCountByEntry.get(e.id) !== 12);
  if (invalidEntries.length > 0) {
    console.error(
      `[sddfs-scoring] contest ${contestId}: excluding ${invalidEntries.length} entry(ies) with an incomplete lineup from ranking: ${invalidEntries.map((e) => e.id).join(", ")}`
    );
  }

  const prizePool = prizePoolFromEntries(contest.buy_in, validEntries.length);

  const payouts = computeSddfsPayouts(
    validEntries.map((e) => ({
      entryId: e.id,
      totalScore: scoreByEntry.get(e.id) ?? 0,
    })),
    prizePool
  );

  for (const payout of payouts) {
    const { data: entry, error: fetchError } = await supabase
      .from("sddfs_entries")
      .select("user_id")
      .eq("id", payout.entryId)
      .maybeSingle();

    if (fetchError || !entry) {
      throw new Error(
        `Failed to fetch entry ${payout.entryId}: ${fetchError?.message}`
      );
    }

    const { error: updateError } = await supabase
      .from("sddfs_entries")
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
          description: `SDDFS contest win - Rank #${payout.finalRank}`,
        });

      if (walletError) {
        throw new Error(
          `Failed to credit wallet for entry ${payout.entryId}: ${walletError.message}`
        );
      }
    }
  }

  await supabase
    .from("sddfs_contests")
    .update({ status: "scored" })
    .eq("id", contestId);

  return { entriesScored: payouts.length };
}
