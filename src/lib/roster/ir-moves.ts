import type { DraftPick } from "@/lib/draft/types";
import { loadDraftStateDetailed } from "@/lib/draft/server";
import { createClient } from "@/lib/supabase/server";
import { isStockIrEligibleForLeague } from "@/lib/sim/injury-status";
import {
  countOccupiedIrSlots,
  findOpenIrSlot,
  findOpenStockSlot,
  isOccupiedIrSlot,
  isOpenIrSlot,
} from "@/lib/sim/ir-slots";
import { resolveIrResolutionState } from "@/lib/sim/ir-enforcement";
import { IR_OPEN_SYMBOL } from "@/lib/sim/types";
import { requireSeasonLeague } from "@/lib/roster/server";
import {
  enforceIrResolutionClearForLeague,
  enforceSportsSimIrMoveAllowed,
  type RosterMoveResult,
} from "@/lib/season/move-gates";
import { getStockQuote } from "@/lib/roster/quotes";
import { applyIrMoveWeekBaselines } from "@/lib/roster/weekly";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type PickPatch = {
  pick_type?: string;
  symbol?: string;
  price_at_pick?: number;
  budget_spent?: number;
  shares?: number;
  effective_value?: number;
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
      return { error: "Pick update returned no row." };
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
    if (!row) return { error: "Could not update pick." };
    return {};
  }

  return { error: error.message ?? "Pick update failed." };
}

async function logRosterMove(
  supabase: SupabaseClient,
  entry: {
    league_id: string;
    user_id: string;
    move_type: "ir_move_to" | "ir_return";
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

async function loadSportsSimLeagueContext(userId: string, leagueId?: string | null) {
  const season = await requireSeasonLeague(userId, leagueId);
  if ("error" in season) return { error: season.error } as const;

  const supabase = await createClient();
  const { data: leagueRow, error } = await supabase
    .from("leagues")
    .select(
      "id, format_type, sports_league_id, sports_standings_season, current_week"
    )
    .eq("id", season.league.id)
    .maybeSingle();

  if (error || !leagueRow || leagueRow.format_type !== "sports_league") {
    return { error: "IR moves are only available in sports-sim leagues." } as const;
  }

  return {
    league: season.league,
    leagueRow,
    supabase,
  } as const;
}

export async function applyMoveToIr(
  userId: string,
  starterPickId: string,
  irSlotPickId: string
): Promise<RosterMoveResult> {
  const context = await loadSportsSimLeagueContext(userId);
  if ("error" in context) return { error: context.error };

  const { league, leagueRow, supabase } = context;
  const gate = await enforceSportsSimIrMoveAllowed(league.id, userId, "move_to_ir");
  if (gate) return gate;

  const state = await loadDraftStateDetailed(userId, { leagueId: league.id });
  if (!state.ok) return { error: state.error };

  const starter = state.state.picks.find((pick) => pick.id === starterPickId);
  const irSlot = state.state.picks.find((pick) => pick.id === irSlotPickId);

  if (!starter || starter.pick_type !== "stock") {
    return { error: "Select a valid active starter to move to IR." };
  }
  if (starter.symbol.toUpperCase() === IR_OPEN_SYMBOL) {
    return { error: "This starter slot is already empty." };
  }
  if (!irSlot || !isOpenIrSlot(irSlot)) {
    return { error: "Select an empty IR slot." };
  }
  if (countOccupiedIrSlots(state.state.picks) >= 3) {
    return { error: "All 3 IR slots are full." };
  }

  const weekNumber = leagueRow.current_week ?? 1;
  const eligibility = await isStockIrEligibleForLeague(
    supabase,
    league.id,
    leagueRow,
    starter.symbol,
    weekNumber
  );
  if (eligibility.error) {
    return { error: eligibility.error };
  }
  if (!eligibility.eligible) {
    return {
      error: `${starter.symbol} is not IR-eligible this week based on the mapped player's injury status.`,
    };
  }

  const quote = await getStockQuote(starter.symbol);
  const transferBudget = starter.shares * quote.price;

  const clearStarter = await patchDraftPick(supabase, userId, starter.id, {
    symbol: IR_OPEN_SYMBOL,
    pick_type: "stock",
    budget_spent: 0,
    effective_value: 0,
    price_at_pick: 0,
    shares: 0,
  });
  if (clearStarter.error) return clearStarter;

  const fillIr = await patchDraftPick(supabase, userId, irSlot.id, {
    symbol: starter.symbol,
    pick_type: "ir",
    budget_spent: transferBudget,
    effective_value: transferBudget,
    price_at_pick: quote.price,
    shares: starter.shares,
  });
  if (fillIr.error) return fillIr;

  await applyIrMoveWeekBaselines(
    supabase,
    league.id,
    userId,
    starter.id,
    irSlot.id,
    transferBudget
  );

  await logRosterMove(supabase, {
    league_id: league.id,
    user_id: userId,
    move_type: "ir_move_to",
    pick_id: irSlot.id,
    related_pick_id: starter.id,
    symbol: starter.symbol,
    prior_symbol: starter.symbol,
    prior_pick_type: "stock",
    new_pick_type: "ir",
    budget_before: starter.budget_spent,
    budget_after: transferBudget,
    price_at_move: quote.price,
    shares_after: starter.shares,
    notes: `Moved ${starter.symbol} to IR; active slot opened for free agency`,
  });

  return {};
}

export async function applyReturnFromIr(
  userId: string,
  irPickId: string,
  openStockPickId?: string
): Promise<RosterMoveResult> {
  const context = await loadSportsSimLeagueContext(userId);
  if ("error" in context) return { error: context.error };

  const { league, leagueRow, supabase } = context;
  const gate = await enforceSportsSimIrMoveAllowed(league.id, userId, "return_from_ir");
  if (gate) return gate;

  const state = await loadDraftStateDetailed(userId, { leagueId: league.id });
  if (!state.ok) return { error: state.error };

  const irPick = state.state.picks.find((pick) => pick.id === irPickId);
  if (!irPick || !isOccupiedIrSlot(irPick)) {
    return { error: "Select a valid IR stock to return to active." };
  }

  const weekNumber = leagueRow.current_week ?? 1;
  const eligibility = await isStockIrEligibleForLeague(
    supabase,
    league.id,
    leagueRow,
    irPick.symbol,
    weekNumber
  );
  if (eligibility.eligible) {
    return {
      error: `${irPick.symbol} is still IR-eligible this week. Use Move to IR only while injured.`,
    };
  }

  const resolution = await resolveIrResolutionState(
    supabase,
    league.id,
    leagueRow,
    state.state.picks,
    weekNumber
  );
  const forcedReturn = resolution.picks.some((row) => row.pickId === irPick.id);
  if (!forcedReturn) {
    return {
      error: `${irPick.symbol} is still IR-eligible or does not require a return yet.`,
    };
  }

  const openStock =
    (openStockPickId
      ? state.state.picks.find((pick) => pick.id === openStockPickId)
      : undefined) ?? findOpenStockSlot(state.state.picks);

  if (!openStock || openStock.pick_type !== "stock") {
    return {
      error:
        "No open active slot. Drop or bench a starter first, then return this stock from IR.",
    };
  }
  if (openStock.symbol.toUpperCase() !== IR_OPEN_SYMBOL) {
    return { error: "Selected active slot is not open." };
  }

  const quote = await getStockQuote(irPick.symbol);
  const transferBudget =
    irPick.shares > 0 ? irPick.shares * quote.price : irPick.budget_spent;

  const fillStarter = await patchDraftPick(supabase, userId, openStock.id, {
    symbol: irPick.symbol,
    pick_type: "stock",
    budget_spent: transferBudget,
    effective_value: transferBudget,
    price_at_pick: quote.price,
    shares: irPick.shares,
  });
  if (fillStarter.error) return fillStarter;

  const clearIr = await patchDraftPick(supabase, userId, irPick.id, {
    symbol: IR_OPEN_SYMBOL,
    pick_type: "ir",
    budget_spent: 0,
    effective_value: 0,
    price_at_pick: 0,
    shares: 0,
  });
  if (clearIr.error) return clearIr;

  await applyIrMoveWeekBaselines(
    supabase,
    league.id,
    userId,
    openStock.id,
    irPick.id,
    transferBudget
  );

  await logRosterMove(supabase, {
    league_id: league.id,
    user_id: userId,
    move_type: "ir_return",
    pick_id: openStock.id,
    related_pick_id: irPick.id,
    symbol: irPick.symbol,
    prior_pick_type: "ir",
    new_pick_type: "stock",
    budget_before: irPick.budget_spent,
    budget_after: transferBudget,
    price_at_move: quote.price,
    shares_after: irPick.shares,
    notes: `Returned ${irPick.symbol} from IR to active roster`,
  });

  const afterState = await loadDraftStateDetailed(userId, { leagueId: league.id });
  if (afterState.ok) {
    const stillBlocked = await resolveIrResolutionState(
      supabase,
      league.id,
      leagueRow,
      afterState.state.picks,
      weekNumber
    );
    if (!stillBlocked.required) {
      await enforceIrResolutionClearForLeague(league.id, userId);
    }
  }

  return {};
}
