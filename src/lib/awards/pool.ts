import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AWARD_REGULAR_SEASON_WEEKS,
  AWARD_SEASON_BASE_TOTAL,
  AWARD_WEEKLY_BASE_AMOUNT,
} from "@/lib/awards/constants";
import type { LeagueBonusPoolRow } from "@/lib/awards/types";

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

  const row = {
    league_id: leagueId,
    season_base_total: AWARD_SEASON_BASE_TOTAL,
    regular_season_weeks: AWARD_REGULAR_SEASON_WEEKS,
    weekly_base_amount: AWARD_WEEKLY_BASE_AMOUNT,
    draft_surcharge_total: draftSurchargeTotal,
    rollover_balance: 0,
    playoff_pool_balance: 0,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("league_bonus_pools")
    .insert(row)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not initialize league bonus pool");
  }

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
}
