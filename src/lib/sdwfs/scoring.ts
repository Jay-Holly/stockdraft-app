import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

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
  contestId: string
): Promise<{ entriesScored: number }> {
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

  const { data: picks, error: picksError } = await supabase
    .from("sdwfs_entry_picks")
    .select("entry_id, pct_change")
    .in(
      "entry_id",
      entries.map((e) => e.id)
    );

  if (picksError) {
    throw new Error(`Failed to load picks: ${picksError.message}`);
  }

  const scoreByEntry = new Map<string, number>();
  for (const entry of entries) scoreByEntry.set(entry.id, 0);
  for (const pick of picks ?? []) {
    const current = scoreByEntry.get(pick.entry_id) ?? 0;
    scoreByEntry.set(pick.entry_id, current + (pick.pct_change ?? 0));
  }

  const prizePool = Math.round(contest.buy_in * entries.length * 0.92 * 100) / 100;

  const payouts = computeSdwfsPayouts(
    entries.map((e) => ({
      entryId: e.id,
      totalScore: scoreByEntry.get(e.id) ?? 0,
    })),
    prizePool
  );

  for (const payout of payouts) {
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
  }

  await supabase
    .from("sdwfs_contests")
    .update({ status: "scored" })
    .eq("id", contestId);

  return { entriesScored: payouts.length };
}
