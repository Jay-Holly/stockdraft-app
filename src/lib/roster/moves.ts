import { isDraftPoolStock } from "@/lib/draft-pool/server";
import { computeCryptoPick, isStockPickEligible } from "@/lib/draft/engine";
import {
  fetchBuyerCounts,
  incrementLeagueCryptoCount,
  loadDraftStateDetailed,
} from "@/lib/draft/server";
import type { DraftPick } from "@/lib/draft/types";
import { isCryptoSymbol } from "@/lib/draft/engine";
import {
  countLeagueRosteredSymbol,
  getLeagueOffBoardSymbols,
} from "@/lib/league/server";
import { createClient } from "@/lib/supabase/server";
import { findActiveCryptoPick } from "@/lib/roster/crypto-picks";
import {
  computeSharesFromBudget,
  getCryptoQuote,
  getStockQuote,
} from "@/lib/roster/quotes";
import { requireSeasonLeague } from "@/lib/roster/server";
import {
  enforceFreeAgencyOpenForLeague,
  enforceLineupUnlockedForLeague,
  enforceSportsSimIrMoveAllowed,
  type RosterMoveResult,
} from "@/lib/season/move-gates";
import {
  applyCryptoRebalanceWeekBaselines,
  applyIrSwapWeekBaselines,
  syncCryptoBaselinesAfterRebalance,
} from "@/lib/roster/weekly";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type PickPatch = {
  pick_type?: string;
  symbol?: string;
  price_at_pick?: number;
  budget_spent?: number;
  shares?: number;
  effective_value?: number;
  surcharge_percent?: number;
  acquired_via?: string;
};

async function patchDraftPick(
  supabase: SupabaseClient,
  userId: string,
  pickId: string,
  updates: PickPatch
): Promise<{ error?: string }> {
  const { data, error } = await supabase.rpc("patch_my_draft_pick", {
    p_pick_id: pickId,
    p_updates: updates,
  });

  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as DraftPick | null | undefined;
    if (!row?.id) {
      return {
        error:
          "Pick update returned no row. Run migration 017 (patch_my_draft_pick) in Supabase.",
      };
    }
    if (
      updates.symbol &&
      row.symbol.toUpperCase() !== updates.symbol.toUpperCase()
    ) {
      return {
        error: `Pick symbol did not update (still ${row.symbol}). Run migrations 017 and 022 in Supabase.`,
      };
    }
    return {};
  }

  if (
    error.code === "42883" ||
    error.message.includes("patch_my_draft_pick") ||
    error.message.includes("Could not find the function")
  ) {
    const { data: row, error: directError } = await supabase
      .from("draft_picks")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", pickId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (directError) return { error: directError.message };
    if (!row) {
      return {
        error:
          "Could not update pick (0 rows). Run migrations 016 and 017 in Supabase.",
      };
    }
    return {};
  }

  return { error: error.message ?? "Pick update failed." };
}

async function insertDraftPick(
  supabase: SupabaseClient,
  userId: string,
  draftId: string,
  pick: {
    round_number: number;
    pick_type: string;
    symbol: string;
    price_at_pick: number;
    budget_spent: number;
    shares: number;
    surcharge_percent: number;
    effective_value: number;
    pick_order: number;
  }
): Promise<{ error?: string; pick?: DraftPick }> {
  const { data, error } = await supabase.rpc("insert_my_draft_pick", {
    p_draft_id: draftId,
    p_round_number: pick.round_number,
    p_pick_type: pick.pick_type,
    p_symbol: pick.symbol,
    p_price_at_pick: pick.price_at_pick,
    p_budget_spent: pick.budget_spent,
    p_shares: pick.shares,
    p_surcharge_percent: pick.surcharge_percent,
    p_effective_value: pick.effective_value,
    p_pick_order: pick.pick_order,
  });

  if (!error && data) return { pick: data as DraftPick };

  if (!error) {
    return {
      error:
        "Pick insert returned no row. Run migration 017 (insert_my_draft_pick) in Supabase.",
    };
  }

  if (
    error.code === "42883" ||
    error.message.includes("insert_my_draft_pick") ||
    error.message.includes("Could not find the function")
  ) {
    const { data: row, error: directError } = await supabase
      .from("draft_picks")
      .insert({
        draft_id: draftId,
        user_id: userId,
        round_number: pick.round_number,
        pick_type: pick.pick_type,
        symbol: pick.symbol.toUpperCase(),
        price_at_pick: pick.price_at_pick,
        budget_spent: pick.budget_spent,
        shares: pick.shares,
        surcharge_percent: pick.surcharge_percent,
        effective_value: pick.effective_value,
        pick_order: pick.pick_order,
        acquired_via: "draft",
      })
      .select("*")
      .single();

    if (directError) return { error: directError.message };
    return { pick: row as DraftPick };
  }

  return { error: error?.message ?? "Could not insert pick." };
}

async function logRosterMove(
  supabase: SupabaseClient,
  entry: {
    league_id: string;
    user_id: string;
    move_type:
      | "ir_swap"
      | "crypto_swap"
      | "crypto_rebalance"
      | "waiver_add"
      | "waiver_drop";
    pick_id?: string;
    related_pick_id?: string;
    symbol: string;
    prior_symbol?: string;
    prior_pick_type?: string;
    new_pick_type?: string;
    budget_before?: number;
    budget_after?: number;
    price_at_move?: number;
    shares_after?: number;
    notes?: string;
  }
) {
  const { error } = await supabase.from("roster_moves").insert(entry);
  if (error) {
    console.error("roster_moves insert failed:", error.message);
  }
}

export async function applyIrSwap(
  userId: string,
  starterPickId: string,
  benchPickId: string
): Promise<RosterMoveResult> {
  const season = await requireSeasonLeague(userId);
  if ("error" in season) return { error: season.error };

  const { league } = season;
  const irGate = await enforceSportsSimIrMoveAllowed(league.id, userId, "other");
  if (irGate) return irGate;
  const gate = await enforceLineupUnlockedForLeague(league.id);
  if (gate) return gate;
  const state = await loadDraftStateDetailed(userId, { leagueId: league.id });
  if (!state.ok) return { error: state.error };

  const starter = state.state.picks.find((p) => p.id === starterPickId);
  const bench = state.state.picks.find((p) => p.id === benchPickId);

  if (!starter || starter.pick_type !== "stock") {
    return { error: "Select a valid starter stock to bench." };
  }
  if (!bench || bench.pick_type !== "bench") {
    return { error: "Select a valid bench stock to promote." };
  }
  if (bench.symbol.toUpperCase() === "__OPEN__") {
    return { error: "Select a rostered bench stock to promote, not an empty slot." };
  }

  const starterQuote = await getStockQuote(starter.symbol);
  const benchQuote = await getStockQuote(bench.symbol);

  if (!isStockPickEligible(bench.symbol, benchQuote.price)) {
    return { error: `${bench.symbol} is not eligible ($5+ required).` };
  }

  const transferBudget = starter.shares * starterQuote.price;
  const promotedShares = computeSharesFromBudget(
    transferBudget,
    benchQuote.price
  );

  const supabase = await createClient();

  const demoteResult = await patchDraftPick(supabase, userId, starter.id, {
    pick_type: "bench",
    budget_spent: 0,
    effective_value: 0,
    price_at_pick: starterQuote.price,
    shares: starter.shares,
  });
  if (demoteResult.error) return demoteResult;

  const promoteResult = await patchDraftPick(supabase, userId, bench.id, {
    pick_type: "stock",
    budget_spent: transferBudget,
    effective_value: transferBudget,
    price_at_pick: benchQuote.price,
    shares: promotedShares,
  });
  if (promoteResult.error) return promoteResult;

  await applyIrSwapWeekBaselines(
    supabase,
    league.id,
    userId,
    bench.id,
    transferBudget
  );

  await logRosterMove(supabase, {
    league_id: league.id,
    user_id: userId,
    move_type: "ir_swap",
    pick_id: bench.id,
    related_pick_id: starter.id,
    symbol: bench.symbol,
    prior_symbol: starter.symbol,
    prior_pick_type: "stock",
    new_pick_type: "stock",
    budget_before: bench.budget_spent,
    budget_after: transferBudget,
    price_at_move: benchQuote.price,
    shares_after: promotedShares,
    notes: `Promoted ${bench.symbol} with $${transferBudget.toFixed(2)} from benched ${starter.symbol}`,
  });

  return {};
}

export async function applyCryptoRebalance(
  userId: string,
  sourcePickId: string,
  targetSymbol: string,
  sellPercent: number
): Promise<{ error?: string }> {
  const season = await requireSeasonLeague(userId);
  if ("error" in season) return { error: season.error };

  const { league } = season;
  const irGate = await enforceSportsSimIrMoveAllowed(league.id, userId, "other");
  if (irGate) return irGate;

  if (!Number.isFinite(sellPercent) || sellPercent <= 0 || sellPercent > 100) {
    return { error: "Sell percentage must be between 1 and 100." };
  }

  const upper = targetSymbol.toUpperCase();
  if (!isCryptoSymbol(upper)) {
    return { error: "Invalid crypto symbol." };
  }

  const state = await loadDraftStateDetailed(userId, { leagueId: league.id });
  if (!state.ok) return { error: state.error };

  const source = state.state.picks.find((p) => p.id === sourcePickId);
  if (!source || source.pick_type !== "crypto") {
    return { error: "Select a valid crypto position to sell from." };
  }
  if (source.symbol.toUpperCase() === upper) {
    return { error: "Choose a different coin to buy." };
  }
  if (source.budget_spent <= 0 || source.shares <= 0) {
    return { error: "This crypto position has no budget left to sell." };
  }

  const fraction = sellPercent / 100;
  const soldBudget = source.budget_spent * fraction;
  const soldShares = source.shares * fraction;
  const soldEffective = source.effective_value * fraction;

  if (soldBudget < 0.01) {
    return { error: "Sell amount is too small." };
  }

  const remainingBudget = source.budget_spent - soldBudget;
  const remainingShares = source.shares - soldShares;
  const remainingEffective = source.effective_value - soldEffective;

  const targetQuote = await getCryptoQuote(upper);
  if (targetQuote.price <= 0) {
    return { error: "Could not fetch price for the target coin." };
  }

  const existingTarget = findActiveCryptoPick(
    state.state.picks,
    upper,
    source.id
  );

  const supabase = await createClient();
  const buyerCounts =
    state.state.buyerCounts ?? (await fetchBuyerCounts(supabase, league.id));

  let buyBudget = soldBudget;
  let buyEffective = soldBudget;
  let buyShares = 0;
  let buySurcharge = 0;

  if (existingTarget) {
    buyShares = computeSharesFromBudget(soldBudget, targetQuote.price);
    buyEffective = soldBudget;
  } else {
    const buyerCount = buyerCounts[upper] ?? 0;
    const computed = computeCryptoPick(soldBudget, targetQuote.price, buyerCount);
    buyBudget = computed.budgetSpent;
    buyEffective = computed.effectiveValue;
    buyShares = computed.shares;
    buySurcharge = computed.surchargePercent;
    await incrementLeagueCryptoCount(supabase, league.id, upper, buyerCount);
  }

  const normalizedRemaining = {
    budget_spent: remainingBudget < 0.01 ? 0 : remainingBudget,
    shares: remainingShares < 0.000001 ? 0 : remainingShares,
    effective_value: remainingEffective < 0.01 ? 0 : remainingEffective,
  };

  const sourcePatch = await patchDraftPick(supabase, userId, source.id, {
    budget_spent: normalizedRemaining.budget_spent,
    shares: normalizedRemaining.shares,
    effective_value: normalizedRemaining.effective_value,
  });
  if (sourcePatch.error) return sourcePatch;

  if (existingTarget) {
    const targetPatch = await patchDraftPick(supabase, userId, existingTarget.id, {
      budget_spent: existingTarget.budget_spent + soldBudget,
      shares: existingTarget.shares + buyShares,
      effective_value: existingTarget.effective_value + buyEffective,
      price_at_pick: targetQuote.price,
    });
    if (targetPatch.error) return targetPatch;

    await applyCryptoRebalanceWeekBaselines(
      supabase,
      league.id,
      userId,
      source.id,
      existingTarget.id,
      fraction,
      soldBudget,
      buyBudget,
      false
    );
  } else {
    const maxOrder = Math.max(...state.state.picks.map((p) => p.pick_order), 0);
    const insertResult = await insertDraftPick(
      supabase,
      userId,
      state.state.draft.id,
      {
        round_number: source.round_number,
        pick_type: "crypto",
        symbol: upper,
        price_at_pick: targetQuote.price,
        budget_spent: buyBudget,
        shares: buyShares,
        surcharge_percent: buySurcharge,
        effective_value: buyEffective,
        pick_order: maxOrder + 1,
      }
    );
    if (insertResult.error) return { error: insertResult.error };

    await applyCryptoRebalanceWeekBaselines(
      supabase,
      league.id,
      userId,
      source.id,
      insertResult.pick?.id ?? null,
      fraction,
      soldBudget,
      buyBudget,
      true
    );
  }

  await syncCryptoBaselinesAfterRebalance(supabase, league.id, userId);

  const moveType =
    sellPercent === 100 && !existingTarget ? "crypto_swap" : "crypto_rebalance";

  await logRosterMove(supabase, {
    league_id: league.id,
    user_id: userId,
    move_type: moveType,
    pick_id: source.id,
    symbol: upper,
    prior_symbol: source.symbol,
    prior_pick_type: "crypto",
    new_pick_type: "crypto",
    budget_before: source.budget_spent,
    budget_after: normalizedRemaining.budget_spent,
    price_at_move: targetQuote.price,
    shares_after: buyShares,
    notes: `Sold ${sellPercent}% of ${source.symbol} ($${soldBudget.toFixed(2)}) → ${upper}${
      buySurcharge > 0 ? ` (${buySurcharge}% surcharge)` : ""
    }`,
  });

  return {};
}

export async function applyCryptoSwap(
  userId: string,
  pickId: string,
  newSymbol: string
): Promise<{ error?: string }> {
  return applyCryptoRebalance(userId, pickId, newSymbol, 100);
}

export async function applyWaiverClaim(
  userId: string,
  droppedPickId: string,
  addSymbol: string
): Promise<RosterMoveResult> {
  const season = await requireSeasonLeague(userId);
  if ("error" in season) return { error: season.error };

  const upper = addSymbol.toUpperCase();
  const { league } = season;
  const irGate = await enforceSportsSimIrMoveAllowed(league.id, userId, "other");
  if (irGate) return irGate;
  const gate = await enforceFreeAgencyOpenForLeague(league.id);
  if (gate) return gate;
  const state = await loadDraftStateDetailed(userId, { leagueId: league.id });
  if (!state.ok) return { error: state.error };

  const benchPick = state.state.picks.find((p) => p.id === droppedPickId);
  const openStockPick = state.state.picks.find((p) => p.id === droppedPickId);
  const targetPick = benchPick ?? openStockPick;

  if (!targetPick) {
    return { error: "Select a valid roster slot." };
  }

  const isOpenStockClaim =
    targetPick.pick_type === "stock" &&
    targetPick.symbol.toUpperCase() === "__OPEN__";
  const isBenchClaim = targetPick.pick_type === "bench";

  if (!isBenchClaim && !isOpenStockClaim) {
    return { error: "Select an open bench slot or open active slot to add a free agent." };
  }

  const droppedSymbol = targetPick.symbol.toUpperCase();
  const isOpenSlot = droppedSymbol === "__OPEN__";

  const offBoard = await getLeagueOffBoardSymbols(league.id);
  if (offBoard.has(upper)) {
    return { error: `${upper} is already rostered in this league.` };
  }

  if (!(await isDraftPoolStock(upper))) {
    return { error: `${upper} is not in the S&P 500 pool.` };
  }

  const quote = await getStockQuote(upper);
  if (!isStockPickEligible(upper, quote.price)) {
    return { error: `${upper} must trade at $5+ per share.` };
  }

  const supabase = await createClient();

  const patchResult = await patchDraftPick(supabase, userId, targetPick.id, {
    symbol: upper,
    pick_type: isOpenStockClaim ? "stock" : "bench",
    budget_spent: 0,
    effective_value: 0,
    shares: 0,
    price_at_pick: quote.price,
    acquired_via: "waiver",
  });
  if (patchResult.error) return patchResult;

  const addedCount = await countLeagueRosteredSymbol(league.id, upper);
  if (addedCount < 1) {
    return {
      error: `${upper} was not added to your league roster. Run migrations 017 and 022 in Supabase.`,
    };
  }

  if (droppedSymbol !== upper && !isOpenSlot) {
    const droppedCount = await countLeagueRosteredSymbol(league.id, droppedSymbol);
    if (droppedCount === 0) {
      const offAfter = await getLeagueOffBoardSymbols(league.id);
      if (offAfter.has(droppedSymbol)) {
        return {
          error: `${droppedSymbol} was dropped but is still off-board. Run migration 022 in Supabase.`,
        };
      }

      await logRosterMove(supabase, {
        league_id: league.id,
        user_id: userId,
        move_type: "waiver_drop",
        pick_id: targetPick.id,
        symbol: droppedSymbol,
        prior_pick_type: isOpenStockClaim ? "stock" : "bench",
        budget_before: targetPick.budget_spent,
        budget_after: 0,
        notes: `Released ${droppedSymbol} to league free agency`,
      });
    }
  }

  await logRosterMove(supabase, {
    league_id: league.id,
    user_id: userId,
    move_type: "waiver_add",
    pick_id: targetPick.id,
    symbol: upper,
    prior_symbol: isOpenSlot ? undefined : droppedSymbol,
    prior_pick_type: isOpenStockClaim ? "stock" : "bench",
    new_pick_type: isOpenStockClaim ? "stock" : "bench",
    budget_before: targetPick.budget_spent,
    budget_after: 0,
    price_at_move: quote.price,
    shares_after: 0,
    notes: isOpenSlot
      ? isOpenStockClaim
        ? `Added FA ${upper} to open active slot at $0 until promoted`
        : `Added FA ${upper} to open bench slot at $0 until IR promote`
      : `Dropped ${droppedSymbol}, added FA ${upper} to bench at $0 until IR promote`,
  });

  return {};
}

export async function applyBenchDrop(
  userId: string,
  benchPickId: string
): Promise<RosterMoveResult & { releasedSymbol?: string }> {
  const season = await requireSeasonLeague(userId);
  if ("error" in season) return { error: season.error };

  const { league } = season;
  const irGate = await enforceSportsSimIrMoveAllowed(league.id, userId, "other");
  if (irGate) return irGate;
  const gate = await enforceFreeAgencyOpenForLeague(league.id);
  if (gate) return gate;
  const state = await loadDraftStateDetailed(userId, { leagueId: league.id });
  if (!state.ok) return { error: state.error };

  const benchPick = state.state.picks.find((p) => p.id === benchPickId);
  if (!benchPick || benchPick.pick_type !== "bench") {
    return { error: "Select a valid bench slot to drop." };
  }

  const droppedSymbol = benchPick.symbol.toUpperCase();
  if (droppedSymbol === "__OPEN__") {
    return { error: "This bench slot is already empty." };
  }

  const supabase = await createClient();
  const patchResult = await patchDraftPick(supabase, userId, benchPick.id, {
    symbol: "__OPEN__",
    pick_type: "bench",
    budget_spent: 0,
    effective_value: 0,
    shares: 0,
    price_at_pick: 0,
    acquired_via: "waiver",
  });
  if (patchResult.error) return patchResult;

  const droppedCount = await countLeagueRosteredSymbol(league.id, droppedSymbol);
  if (droppedCount > 0) {
    return {
      error: `${droppedSymbol} is still rostered in this league and was not released.`,
    };
  }

  const offAfter = await getLeagueOffBoardSymbols(league.id);
  if (offAfter.has(droppedSymbol)) {
    return {
      error: `${droppedSymbol} was dropped but is still off-board. Run migration 022 in Supabase.`,
    };
  }

  await logRosterMove(supabase, {
    league_id: league.id,
    user_id: userId,
    move_type: "waiver_drop",
    pick_id: benchPick.id,
    symbol: droppedSymbol,
    prior_pick_type: "bench",
    budget_before: benchPick.budget_spent,
    budget_after: 0,
    notes: `Released ${droppedSymbol} to league free agency (empty bench slot)`,
  });

  return { releasedSymbol: droppedSymbol };
}
