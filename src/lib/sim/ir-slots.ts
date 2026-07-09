import type { SupabaseClient } from "@supabase/supabase-js";

import type { DraftPick } from "@/lib/draft/types";
import { BENCH_START_ROUND, TOTAL_ROUNDS } from "@/lib/draft/types";
import { postDraftIrBaseRound } from "@/lib/draft/draft-constants";
import type { DraftRulesMode } from "@/lib/draft/types";
import {
  IR_OPEN_SYMBOL,
  SPORTS_SIM_IR_SLOT_COUNT,
} from "@/lib/sim/types";

const IR_SLOT_BASE_ORDER = 200;

export function getIrSlotBaseRound(rules: DraftRulesMode = "standard"): number {
  return postDraftIrBaseRound(rules);
}

export function isOpenIrSlot(pick: DraftPick): boolean {
  return (
    pick.pick_type === "ir" &&
    pick.symbol.toUpperCase() === IR_OPEN_SYMBOL
  );
}

export function isOccupiedIrSlot(pick: DraftPick): boolean {
  return (
    pick.pick_type === "ir" &&
    pick.symbol.toUpperCase() !== IR_OPEN_SYMBOL
  );
}

export function countOccupiedIrSlots(picks: DraftPick[]): number {
  return picks.filter(isOccupiedIrSlot).length;
}

export function findOpenIrSlot(picks: DraftPick[]): DraftPick | undefined {
  return picks.find(isOpenIrSlot);
}

export function findOpenStockSlot(picks: DraftPick[]): DraftPick | undefined {
  return picks.find(
    (pick) =>
      pick.pick_type === "stock" &&
      pick.symbol.toUpperCase() === IR_OPEN_SYMBOL
  );
}

export function isOpenStarterSlot(pick: DraftPick): boolean {
  return (
    (pick.pick_type === "stock" || pick.pick_type === "crypto") &&
    pick.symbol.toUpperCase() === IR_OPEN_SYMBOL
  );
}

export function isScoringStarterPick(pick: DraftPick): boolean {
  if (pick.pick_type === "stock") {
    return pick.symbol.toUpperCase() !== IR_OPEN_SYMBOL;
  }
  if (pick.pick_type === "crypto") {
    return pick.symbol.toUpperCase() !== IR_OPEN_SYMBOL;
  }
  return false;
}

export function findOpenStarterSlot(picks: DraftPick[]): DraftPick | undefined {
  return picks.find(isOpenStarterSlot);
}

export function findAllOpenStarterSlots(picks: DraftPick[]): DraftPick[] {
  return picks.filter(isOpenStarterSlot);
}

export async function ensureIrSlotsForDraft(
  supabase: SupabaseClient,
  userId: string,
  draftId: string,
  options?: { rules?: DraftRulesMode }
): Promise<{ created: number }> {
  const irSlotBaseRound = getIrSlotBaseRound(options?.rules ?? "standard");

  const { data: existing, error } = await supabase
    .from("draft_picks")
    .select("id, pick_order, round_number")
    .eq("draft_id", draftId)
    .eq("user_id", userId)
    .eq("pick_type", "ir");

  if (error) {
    throw new Error(`IR slot lookup failed: ${error.message}`);
  }

  const irRows = existing ?? [];
  const missing = SPORTS_SIM_IR_SLOT_COUNT - irRows.length;
  if (missing <= 0) {
    return { created: 0 };
  }

  const maxOrder = Math.max(
    ...irRows.map((row) => row.pick_order ?? 0),
    IR_SLOT_BASE_ORDER - 1
  );

  const inserts = Array.from({ length: missing }, (_, index) => ({
    draft_id: draftId,
    user_id: userId,
    round_number: irSlotBaseRound + irRows.length + index,
    pick_type: "ir",
    symbol: IR_OPEN_SYMBOL,
    price_at_pick: 0,
    budget_spent: 0,
    shares: 0,
    surcharge_percent: 0,
    effective_value: 0,
    pick_order: maxOrder + index + 1,
    acquired_via: "draft",
  }));

  const { error: insertError } = await supabase.from("draft_picks").insert(inserts);
  if (insertError) {
    throw new Error(`IR slot insert failed: ${insertError.message}`);
  }

  return { created: missing };
}

export async function ensureIrSlotsForLeague(
  supabase: SupabaseClient,
  leagueId: string,
  options?: { rules?: DraftRulesMode }
): Promise<{ drafts: number; slotsCreated: number }> {
  const { data: drafts, error } = await supabase
    .from("drafts")
    .select("id, user_id")
    .eq("league_id", leagueId)
    .eq("status", "complete");

  if (error) {
    throw new Error(`Draft lookup failed: ${error.message}`);
  }

  let slotsCreated = 0;
  for (const draft of drafts ?? []) {
    const result = await ensureIrSlotsForDraft(
      supabase,
      draft.user_id,
      draft.id,
      options
    );
    slotsCreated += result.created;
  }

  return { drafts: drafts?.length ?? 0, slotsCreated };
}

/** Guard against accidental IR slot creation during live draft rounds. */
export function irSlotRoundIsPostDraft(
  roundNumber: number,
  rules: DraftRulesMode = "standard"
): boolean {
  return roundNumber >= getIrSlotBaseRound(rules);
}

export { BENCH_START_ROUND, TOTAL_ROUNDS };
