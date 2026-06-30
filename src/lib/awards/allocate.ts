import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PLAYOFF_BONUS_SHARES,
  PLAYOFF_TOP_SEED_COUNT,
} from "@/lib/awards/constants";
import { appendPlayoffPoolLedger } from "@/lib/awards/pool";
import {
  loadStandingSeeds,
} from "@/lib/matchup/league-teams";
import { sortStandingsForSeeding } from "@/lib/matchup/schedule";
import { createServiceClient } from "@/lib/supabase/service";

/** Split pool by 40/25/20/15; penny remainder goes to 1st seed. */
export function splitPlayoffPoolAmounts(totalPool: number): number[] {
  const amounts = PLAYOFF_BONUS_SHARES.map(
    ({ sharePct }) =>
      Math.floor(((totalPool * sharePct) / 100) * 100) / 100
  );
  const allocated = amounts.reduce((sum, amount) => sum + amount, 0);
  const remainder = Math.round((totalPool - allocated) * 100) / 100;
  if (remainder !== 0) {
    amounts[0] = Math.round((amounts[0] + remainder) * 100) / 100;
  }
  return amounts;
}

export async function refreshPlayoffAllocationStatus(
  supabase: SupabaseClient,
  allocationId: string
): Promise<void> {
  const { data: payouts } = await supabase
    .from("playoff_bonus_payouts")
    .select("status, league_id")
    .eq("allocation_id", allocationId);

  if (!payouts?.length) return;

  const allClaimed = payouts.every(
    (row) => row.status === "claimed" || row.status === "auto_claimed"
  );

  if (allClaimed) {
    await supabase
      .from("playoff_bonus_allocations")
      .update({ status: "complete" })
      .eq("id", allocationId);

    await supabase
      .from("league_bonus_pools")
      .update({
        playoff_allocation_status: "paid_out",
        updated_at: new Date().toISOString(),
      })
      .eq("league_id", payouts[0].league_id);
  }
}

export async function allocatePlayoffBonusPoolIfNeeded(
  leagueId: string,
  allocationWeek: number,
  supabaseOverride?: SupabaseClient
): Promise<{ allocated?: boolean; allocationId?: string; error?: string }> {
  const supabase = supabaseOverride ?? createServiceClient();

  const { data: pool } = await supabase
    .from("league_bonus_pools")
    .select("*")
    .eq("league_id", leagueId)
    .maybeSingle();

  if (!pool) {
    return { error: "League bonus pool not found." };
  }

  if (
    pool.playoff_allocation_status === "allocated" ||
    pool.playoff_allocation_status === "paid_out"
  ) {
    return { allocated: false };
  }

  const { data: existingAllocation } = await supabase
    .from("playoff_bonus_allocations")
    .select("id")
    .eq("league_id", leagueId)
    .eq("allocation_week", allocationWeek)
    .maybeSingle();

  if (existingAllocation?.id) {
    return { allocated: false, allocationId: existingAllocation.id };
  }

  const seeds = sortStandingsForSeeding(
    await loadStandingSeeds(leagueId, supabase)
  );
  if (seeds.length < PLAYOFF_TOP_SEED_COUNT) {
    return {
      error: `Not enough teams for playoff bonus (${seeds.length} found, need ${PLAYOFF_TOP_SEED_COUNT}).`,
    };
  }

  const topSeeds = seeds.slice(0, PLAYOFF_TOP_SEED_COUNT);
  const totalPool = Number(pool.playoff_pool_balance);
  const seedAmount = Number(pool.playoff_pool_seed_amount);
  const rolloverAmount = Math.max(0, totalPool - seedAmount);
  const splitAmounts = splitPlayoffPoolAmounts(totalPool);

  const { data: allocation, error: allocationError } = await supabase
    .from("playoff_bonus_allocations")
    .insert({
      league_id: leagueId,
      allocation_week: allocationWeek,
      total_pool_amount: totalPool,
      seed_amount: seedAmount,
      rollover_amount: rolloverAmount,
      status: "pending_claims",
    })
    .select("id")
    .single();

  if (allocationError || !allocation) {
    return {
      error: allocationError?.message ?? "Could not create playoff allocation.",
    };
  }

  const payoutRows = topSeeds.map((seed, index) => ({
    allocation_id: allocation.id,
    league_id: leagueId,
    user_id: seed.userId,
    seed_rank: index + 1,
    share_pct: PLAYOFF_BONUS_SHARES[index].sharePct,
    amount_usd: splitAmounts[index],
    status: "pending" as const,
  }));

  const { error: payoutError } = await supabase
    .from("playoff_bonus_payouts")
    .insert(payoutRows);

  if (payoutError) {
    return { error: payoutError.message };
  }

  await supabase
    .from("league_bonus_pools")
    .update({
      playoff_allocation_status: "allocated",
      playoff_allocated_at: new Date().toISOString(),
      playoff_allocation_week: allocationWeek,
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", leagueId);

  await appendPlayoffPoolLedger(supabase, leagueId, {
    weekNumber: allocationWeek,
    eventType: "allocation",
    amountUsd: -totalPool,
    balanceAfter: 0,
    detail: {
      allocationId: allocation.id,
      totalPool,
      seedAmount,
      rolloverAmount,
    },
  });

  return { allocated: true, allocationId: allocation.id };
}
