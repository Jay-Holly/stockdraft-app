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
import type { PendingAwardPayout, PendingPlayoffPayout } from "@/lib/awards/types";
import { refreshPlayoffAllocationStatus } from "@/lib/awards/allocate";
import { appendPlayoffPoolLedger } from "@/lib/awards/pool";
import { computeSharesFromBudget, getCryptoQuote, getStockQuote } from "@/lib/roster/quotes";
import { findActiveCryptoPick } from "@/lib/roster/crypto-picks";
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

function isEligibleStockOrBenchPick(pick: DraftPick): boolean {
  if (pick.pick_type !== "stock" && pick.pick_type !== "bench") return false;
  if (pick.symbol.toUpperCase() === "__OPEN__") return false;
  return true;
}

export async function applyPlayoffBonusToStock(
  supabase: ClaimSupabase,
  leagueId: string,
  userId: string,
  amountUsd: number,
  targetPickId: string
): Promise<{ error?: string; pickId?: string; symbol?: string }> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return { error: state.error };

  const pick = state.state.picks.find((row) => row.id === targetPickId);
  if (!pick || !isEligibleStockOrBenchPick(pick)) {
    return { error: "Choose one of your starter or bench stocks." };
  }

  const quote = await getStockQuote(pick.symbol);
  if (quote.price <= 0) {
    return { error: "Could not fetch a live price for that stock." };
  }

  const shares = computeSharesFromBudget(amountUsd, quote.price);
  const patch = await patchDraftPick(supabase, userId, pick.id, {
    budget_spent: pick.budget_spent + amountUsd,
    shares: pick.shares + shares,
    effective_value: pick.effective_value + amountUsd,
    price_at_pick: quote.price,
  });
  if (patch.error) return { error: patch.error };

  const weekNumber = await getCurrentWeek(supabase, leagueId, userId);
  await adjustPickWeekBaseline(
    supabase,
    leagueId,
    userId,
    weekNumber,
    pick.id,
    amountUsd
  );

  return { pickId: pick.id, symbol: pick.symbol.toUpperCase() };
}

export async function autoClaimPlayoffBonusForUser(
  supabase: ClaimSupabase,
  leagueId: string,
  userId: string,
  amountUsd: number
): Promise<{ symbol: string; pickId?: string; error?: string }> {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return { symbol: "", error: state.error };

  const stockPicks = state.state.picks
    .filter(isEligibleStockOrBenchPick)
    .sort((a, b) => b.budget_spent - a.budget_spent);

  const target = stockPicks[0];
  if (!target) {
    return {
      symbol: "",
      error: "No eligible stock or bench position to receive bonus.",
    };
  }

  const result = await applyPlayoffBonusToStock(
    supabase,
    leagueId,
    userId,
    amountUsd,
    target.id
  );

  return {
    symbol: result.symbol ?? target.symbol.toUpperCase(),
    pickId: result.pickId,
    error: result.error,
  };
}

export async function autoClaimPlayoffPayoutsForAllocation(
  supabase: ClaimSupabase,
  leagueId: string,
  allocationId: string
): Promise<void> {
  const { data: payouts } = await supabase
    .from("playoff_bonus_payouts")
    .select("id, user_id, amount_usd")
    .eq("allocation_id", allocationId)
    .eq("status", "pending");

  for (const payout of payouts ?? []) {
    const isBot = await isLeagueBotUser(
      supabase,
      leagueId,
      payout.user_id
    );
    if (!isBot) continue;

    const auto = await autoClaimPlayoffBonusForUser(
      supabase,
      leagueId,
      payout.user_id,
      Number(payout.amount_usd)
    );
    if (auto.error) continue;

    await supabase
      .from("playoff_bonus_payouts")
      .update({
        status: "auto_claimed",
        target_pick_id: auto.pickId ?? null,
        target_symbol: auto.symbol ?? null,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", payout.id);
  }

  await refreshPlayoffAllocationStatus(supabase, allocationId);
}

export async function claimPlayoffPayout(
  userId: string,
  payoutId: string,
  targetPickId: string
): Promise<{ error?: string; symbol?: string; amountUsd?: number }> {
  const supabase = await createClient();

  const { data: payout, error } = await supabase
    .from("playoff_bonus_payouts")
    .select("*")
    .eq("id", payoutId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !payout) {
    return { error: "Playoff bonus payout not found." };
  }

  if (payout.status !== "pending") {
    return { error: "This playoff bonus has already been claimed." };
  }

  const deposit = await applyPlayoffBonusToStock(
    supabase,
    payout.league_id,
    userId,
    Number(payout.amount_usd),
    targetPickId
  );

  if (deposit.error) return { error: deposit.error };

  const { error: updateError } = await supabase
    .from("playoff_bonus_payouts")
    .update({
      status: "claimed",
      target_pick_id: deposit.pickId ?? null,
      target_symbol: deposit.symbol ?? null,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", payoutId)
    .eq("user_id", userId)
    .eq("status", "pending");

  if (updateError) return { error: updateError.message };

  await appendPlayoffPoolLedger(supabase, payout.league_id, {
    eventType: "payout",
    amountUsd: -Number(payout.amount_usd),
    balanceAfter: 0,
    detail: {
      payoutId,
      userId,
      targetSymbol: deposit.symbol,
    },
  });

  await refreshPlayoffAllocationStatus(supabase, payout.allocation_id);

  return {
    symbol: deposit.symbol,
    amountUsd: Number(payout.amount_usd),
  };
}

export async function listPendingPlayoffPayouts(
  userId: string,
  leagueId?: string
): Promise<PendingPlayoffPayout[]> {
  const supabase = await createClient();

  let query = supabase
    .from("playoff_bonus_payouts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("seed_rank", { ascending: true });

  if (leagueId) {
    query = query.eq("league_id", leagueId);
  }

  const { data: payouts, error } = await query;
  if (error || !payouts?.length) return [];

  const allocationIds = [...new Set(payouts.map((row) => row.allocation_id))];
  const { data: allocations } = await supabase
    .from("playoff_bonus_allocations")
    .select("id, allocation_week, total_pool_amount")
    .in("id", allocationIds);

  const allocationById = new Map(
    (allocations ?? []).map((row) => [row.id, row] as const)
  );

  return payouts.flatMap((row) => {
    const allocation = allocationById.get(row.allocation_id);
    if (!allocation) return [];
    return [
      {
        ...(row as PendingPlayoffPayout),
        allocation_week: allocation.allocation_week,
        total_pool_amount: Number(allocation.total_pool_amount),
      },
    ];
  });
}

export async function sumPendingClaimAmountForLeague(
  userId: string,
  leagueId: string
): Promise<{ totalUsd: number; weeklyCount: number; playoffCount: number }> {
  const [weekly, playoff] = await Promise.all([
    listPendingAwardPayouts(userId),
    listPendingPlayoffPayouts(userId, leagueId),
  ]);

  const weeklyForLeague = weekly.filter((row) => row.league_id === leagueId);
  const totalUsd =
    weeklyForLeague.reduce((sum, row) => sum + Number(row.amount_usd), 0) +
    playoff.reduce((sum, row) => sum + Number(row.amount_usd), 0);

  return {
    totalUsd,
    weeklyCount: weeklyForLeague.length,
    playoffCount: playoff.length,
  };
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
