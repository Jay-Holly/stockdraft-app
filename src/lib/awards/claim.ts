import type { SupabaseClient } from "@supabase/supabase-js";
import { isCryptoSymbol } from "@/lib/draft/engine";
import { loadDraftStateDetailed } from "@/lib/draft/server";
import type { DraftPick } from "@/lib/draft/types";
import { isBotUserId } from "@/lib/draft/live-draft";
import {
  AWARD_EMOJI,
  AWARD_LABELS,
  type AwardKey,
} from "@/lib/awards/constants";
import type { PendingAwardPayout } from "@/lib/awards/types";
import { computeSharesFromBudget, getCryptoQuote } from "@/lib/roster/quotes";
import { adjustPickWeekBaseline, getCurrentWeek } from "@/lib/roster/weekly";
import { createClient } from "@/lib/supabase/server";

type ClaimSupabase = SupabaseClient;

async function isLeagueBotUser(
  supabase: ClaimSupabase,
  leagueId: string,
  userId: string
): Promise<boolean> {
  if (isBotUserId(userId)) return true;

  const { data } = await supabase
    .from("league_members")
    .select("bot_personality")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(data?.bot_personality);
}

function findActiveCryptoPick(
  picks: DraftPick[],
  symbol: string,
  excludePickId?: string
): DraftPick | undefined {
  const upper = symbol.toUpperCase();
  return picks.find(
    (pick) =>
      pick.pick_type === "crypto" &&
      pick.id !== excludePickId &&
      pick.symbol.toUpperCase() === upper &&
      pick.budget_spent > 0.01
  );
}

async function patchDraftPick(
  supabase: ClaimSupabase,
  userId: string,
  pickId: string,
  updates: Partial<DraftPick>
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("patch_my_draft_pick", {
    p_pick_id: pickId,
    p_updates: updates,
  });

  if (!error) return {};

  const { error: directError } = await supabase
    .from("draft_picks")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", pickId)
    .eq("user_id", userId);

  if (directError) return { error: directError.message };
  return {};
}

async function insertDraftPick(
  supabase: ClaimSupabase,
  userId: string,
  draftId: string,
  pick: {
    round_number: number;
    symbol: string;
    price_at_pick: number;
    budget_spent: number;
    shares: number;
    pick_order: number;
  }
): Promise<{ error?: string; pick?: DraftPick }> {
  const payload = {
    draft_id: draftId,
    user_id: userId,
    round_number: pick.round_number,
    pick_type: "crypto",
    symbol: pick.symbol.toUpperCase(),
    price_at_pick: pick.price_at_pick,
    budget_spent: pick.budget_spent,
    shares: pick.shares,
    surcharge_percent: 0,
    effective_value: pick.budget_spent,
    pick_order: pick.pick_order,
    acquired_via: "draft",
  };

  const { data: row, error } = await supabase
    .from("draft_picks")
    .insert(payload)
    .select("*")
    .single();

  if (error) return { error: error.message };
  return { pick: row as DraftPick };
}

export async function applyAwardToCryptoPool(
  supabase: ClaimSupabase,
  leagueId: string,
  userId: string,
  amountUsd: number,
  targetSymbol: string
): Promise<{ error?: string; pickId?: string; symbol?: string }> {
  const upper = targetSymbol.toUpperCase();
  if (!isCryptoSymbol(upper)) {
    return { error: "Choose a valid crypto flex coin." };
  }

  const quote = await getCryptoQuote(upper);
  if (quote.price <= 0) {
    return { error: "Could not fetch a live price for that coin." };
  }

  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return { error: state.error };

  const existing = findActiveCryptoPick(state.state.picks, upper);
  const shares = computeSharesFromBudget(amountUsd, quote.price);
  let targetPickId = existing?.id;

  if (existing) {
    const patch = await patchDraftPick(supabase, userId, existing.id, {
      budget_spent: existing.budget_spent + amountUsd,
      shares: existing.shares + shares,
      effective_value: existing.effective_value + amountUsd,
      price_at_pick: quote.price,
    });
    if (patch.error) return { error: patch.error };
  } else {
    const anchor =
      state.state.picks.find((pick) => pick.pick_type === "crypto") ??
      state.state.picks[0];
    const maxOrder = Math.max(...state.state.picks.map((pick) => pick.pick_order), 0);
    const insert = await insertDraftPick(supabase, userId, state.state.draft.id, {
      round_number: anchor?.round_number ?? 1,
      symbol: upper,
      price_at_pick: quote.price,
      budget_spent: amountUsd,
      shares,
      pick_order: maxOrder + 1,
    });
    if (insert.error) return { error: insert.error };
    targetPickId = insert.pick?.id;
  }

  if (!targetPickId) {
    return { error: "Could not resolve the target crypto pick." };
  }

  const weekNumber = await getCurrentWeek(supabase, leagueId, userId);
  await adjustPickWeekBaseline(
    supabase,
    leagueId,
    userId,
    weekNumber,
    targetPickId,
    amountUsd
  );

  return { pickId: targetPickId, symbol: upper };
}

export async function autoClaimAwardForUser(
  supabase: ClaimSupabase,
  leagueId: string,
  userId: string,
  amountUsd: number
): Promise<{ symbol: string; pickId?: string; error?: string }> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return { symbol: "BTC", error: state.error };

  const cryptoPicks = state.state.picks
    .filter((pick) => pick.pick_type === "crypto" && pick.budget_spent > 0.01)
    .sort((a, b) => b.budget_spent - a.budget_spent);

  const symbol = cryptoPicks[0]?.symbol.toUpperCase() ?? "BTC";
  const result = await applyAwardToCryptoPool(
    supabase,
    leagueId,
    userId,
    amountUsd,
    symbol
  );

  return {
    symbol: result.symbol ?? symbol,
    pickId: result.pickId,
    error: result.error,
  };
}

export async function claimAwardPayout(
  userId: string,
  payoutId: string,
  targetSymbol: string
): Promise<{ error?: string; symbol?: string; amountUsd?: number }> {
  const supabase = await createClient();

  const { data: payout, error } = await supabase
    .from("weekly_award_payouts")
    .select("*")
    .eq("id", payoutId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !payout) {
    return { error: "Award payout not found." };
  }

  if (payout.status !== "pending") {
    return { error: "This award has already been claimed." };
  }

  const deposit = await applyAwardToCryptoPool(
    supabase,
    payout.league_id,
    userId,
    Number(payout.amount_usd),
    targetSymbol
  );

  if (deposit.error) return { error: deposit.error };

  const { error: updateError } = await supabase
    .from("weekly_award_payouts")
    .update({
      status: "claimed",
      target_pick_id: deposit.pickId ?? null,
      target_symbol: deposit.symbol ?? targetSymbol.toUpperCase(),
      claimed_at: new Date().toISOString(),
    })
    .eq("id", payoutId)
    .eq("user_id", userId)
    .eq("status", "pending");

  if (updateError) return { error: updateError.message };

  return {
    symbol: deposit.symbol,
    amountUsd: Number(payout.amount_usd),
  };
}

export async function listPendingAwardPayouts(
  userId: string
): Promise<PendingAwardPayout[]> {
  const supabase = await createClient();

  const { data: payouts, error } = await supabase
    .from("weekly_award_payouts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error || !payouts?.length) return [];

  const resultIds = payouts.map((row) => row.award_result_id);
  const { data: results } = await supabase
    .from("weekly_award_results")
    .select("id, award_key, week_number")
    .in("id", resultIds);

  const resultById = new Map(
    (results ?? []).map((row) => [row.id, row] as const)
  );

  return payouts.flatMap((row) => {
    const result = resultById.get(row.award_result_id);
    if (!result) return [];

    const awardKey = result.award_key as AwardKey;
    return [
      {
        ...(row as PendingAwardPayout),
        award_key: awardKey,
        award_label: AWARD_LABELS[awardKey],
        award_emoji: AWARD_EMOJI[awardKey],
        week_number: result.week_number,
      },
    ];
  });
}

export { isLeagueBotUser };
