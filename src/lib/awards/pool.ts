import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AWARD_REGULAR_SEASON_POOL,
  AWARD_REGULAR_SEASON_WEEKS,
  AWARD_SEASON_BASE_TOTAL,
  AWARD_WEEKLY_BASE_AMOUNT,
  PLAYOFF_POOL_SEED,
} from "@/lib/awards/constants";
import type { LeagueBonusPoolRow } from "@/lib/awards/types";

export async function appendPlayoffPoolLedger(
  supabase: SupabaseClient,
  leagueId: string,
  entry: {
    weekNumber?: number | null;
    eventType: "seed" | "weekly_rollover" | "allocation" | "payout";
    amountUsd: number;
    balanceAfter: number;
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  await supabase.from("playoff_pool_ledger").insert({
    league_id: leagueId,
    week_number: entry.weekNumber ?? null,
    event_type: entry.eventType,
    amount_usd: entry.amountUsd,
    balance_after: entry.balanceAfter,
    detail_json: entry.detail ?? {},
  });
}

export async function sumLeagueDraftSurcharges(
  supabase: SupabaseClient,
  leagueId: string
): Promise<number> {
  const { data: drafts } = await supabase
    .from("drafts")
    .select("id")
    .eq("league_id", leagueId);

  const draftIds = (drafts ?? []).map((row) => row.id);
  if (draftIds.length === 0) return 0;

  const { data: picks } = await supabase
    .from("draft_picks")
    .select("budget_spent, effective_value, surcharge_percent")
    .in("draft_id", draftIds)
    .eq("pick_type", "crypto")
    .gt("surcharge_percent", 0);

  let total = 0;
  for (const pick of picks ?? []) {
    const spent = Number(pick.budget_spent);
    const effective = Number(pick.effective_value);
    if (spent > effective) {
      total += spent - effective;
    }
  }

  return total;
}

function defaultPoolInsertRow(
  leagueId: string,
  draftSurchargeTotal: number
) {
  return {
    league_id: leagueId,
    season_base_total: AWARD_SEASON_BASE_TOTAL,
    regular_season_weeks: AWARD_REGULAR_SEASON_WEEKS,
    weekly_base_amount: AWARD_WEEKLY_BASE_AMOUNT,
    draft_surcharge_total: draftSurchargeTotal,
    rollover_balance: 0,
    playoff_pool_balance: PLAYOFF_POOL_SEED,
    playoff_pool_seed_amount: PLAYOFF_POOL_SEED,
    regular_season_pool_total: AWARD_REGULAR_SEASON_POOL,
    playoff_allocation_status: "accumulating" as const,
    updated_at: new Date().toISOString(),
  };
}

export async function ensureLeagueBonusPool(
  supabase: SupabaseClient,
  leagueId: string
): Promise<LeagueBonusPoolRow> {
  const { data: existing } = await supabase
    .from("league_bonus_pools")
    .select("*")
    .eq("league_id", leagueId)
    .maybeSingle();

  if (existing) {
    return existing as LeagueBonusPoolRow;
  }

  const draftSurchargeTotal = await sumLeagueDraftSurcharges(
    supabase,
    leagueId
  );

  const row = defaultPoolInsertRow(leagueId, draftSurchargeTotal);

  const { data, error } = await supabase
    .from("league_bonus_pools")
    .insert(row)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not initialize league bonus pool");
  }

  await appendPlayoffPoolLedger(supabase, leagueId, {
    eventType: "seed",
    amountUsd: PLAYOFF_POOL_SEED,
    balanceAfter: PLAYOFF_POOL_SEED,
    detail: { source: "pool_init" },
  });

  return data as LeagueBonusPoolRow;
}

export function weeklyPoolAmount(pool: LeagueBonusPoolRow): number {
  const surchargeShare =
    pool.draft_surcharge_total / pool.regular_season_weeks;
  return pool.weekly_base_amount + surchargeShare;
}

export async function applyWeeklyPoolRollover(
  supabase: SupabaseClient,
  leagueId: string,
  weekNumber: number,
  weeklyPool: number,
  actualPayouts: number
): Promise<void> {
  const rolloverIncrement = Math.max(0, weeklyPool - actualPayouts);

  const { data: pool } = await supabase
    .from("league_bonus_pools")
    .select("rollover_balance, playoff_pool_balance")
    .eq("league_id", leagueId)
    .maybeSingle();

  if (!pool) return;

  const nextRollover = Number(pool.rollover_balance) + rolloverIncrement;
  const nextPlayoff = Number(pool.playoff_pool_balance) + rolloverIncrement;

  await supabase
    .from("league_bonus_pools")
    .update({
      rollover_balance: nextRollover,
      playoff_pool_balance: nextPlayoff,
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", leagueId);

  if (rolloverIncrement > 0) {
    await appendPlayoffPoolLedger(supabase, leagueId, {
      weekNumber,
      eventType: "weekly_rollover",
      amountUsd: rolloverIncrement,
      balanceAfter: nextPlayoff,
      detail: {
        weeklyPool,
        actualPayouts,
      },
    });
  }
}

/** Wipe award + playoff data and re-seed pool for a league reset. */
export async function resetLeagueBonusPoolForSeason(
  leagueId: string,
  supabase: SupabaseClient
): Promise<void> {
  const { data: allocations } = await supabase
    .from("playoff_bonus_allocations")
    .select("id")
    .eq("league_id", leagueId);

  const allocationIds = (allocations ?? []).map((row) => row.id);
  if (allocationIds.length > 0) {
    await supabase
      .from("playoff_bonus_payouts")
      .delete()
      .in("allocation_id", allocationIds);
  }

  await supabase
    .from("playoff_bonus_allocations")
    .delete()
    .eq("league_id", leagueId);
  await supabase.from("playoff_pool_ledger").delete().eq("league_id", leagueId);

  const { data: results } = await supabase
    .from("weekly_award_results")
    .select("id")
    .eq("league_id", leagueId);

  const resultIds = (results ?? []).map((row) => row.id);
  if (resultIds.length > 0) {
    await supabase
      .from("weekly_award_payouts")
      .delete()
      .in("award_result_id", resultIds);
  }

  await supabase
    .from("weekly_award_results")
    .delete()
    .eq("league_id", leagueId);

  const draftSurchargeTotal = await sumLeagueDraftSurcharges(
    supabase,
    leagueId
  );

  const freshRow = defaultPoolInsertRow(leagueId, draftSurchargeTotal);

  await supabase.from("league_bonus_pools").upsert(freshRow, {
    onConflict: "league_id",
  });

  await appendPlayoffPoolLedger(supabase, leagueId, {
    eventType: "seed",
    amountUsd: PLAYOFF_POOL_SEED,
    balanceAfter: PLAYOFF_POOL_SEED,
    detail: { source: "season_reset" },
  });
}

export function poolSummaryFromRow(pool: LeagueBonusPoolRow): {
  weeklyPoolAmount: number;
  rolloverBalance: number;
  playoffPoolBalance: number;
  playoffSeedAmount: number;
  rolloverFromWeeks: number;
  totalAccumulatedPool: number;
} {
  const weeklyPoolAmountValue = weeklyPoolAmount(pool);
  const playoffPoolBalance = Number(pool.playoff_pool_balance);
  const playoffSeedAmount = Number(pool.playoff_pool_seed_amount);
  const rolloverBalance = Number(pool.rollover_balance);

  return {
    weeklyPoolAmount: weeklyPoolAmountValue,
    rolloverBalance,
    playoffPoolBalance,
    playoffSeedAmount,
    rolloverFromWeeks: Math.max(0, playoffPoolBalance - playoffSeedAmount),
    totalAccumulatedPool: playoffPoolBalance,
  };
}
