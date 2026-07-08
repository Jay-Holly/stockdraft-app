import type { SupabaseClient } from "@supabase/supabase-js";

import type { DraftPick } from "@/lib/draft/types";
import { isStockIrEligibleForLeague } from "@/lib/sim/injury-status";
import { isOccupiedIrSlot } from "@/lib/sim/ir-slots";
import type { IrResolutionState } from "@/lib/sim/types";

export async function resolveIrResolutionState(
  supabase: SupabaseClient,
  leagueId: string,
  league: {
    sports_league_id: string | null;
    sports_standings_season?: number | null;
  },
  picks: DraftPick[],
  leagueWeekNumber: number
): Promise<IrResolutionState> {
  const stale: Array<{ pickId: string; symbol: string }> = [];

  for (const pick of picks) {
    if (!isOccupiedIrSlot(pick)) continue;

    const result = await isStockIrEligibleForLeague(
      supabase,
      leagueId,
      league,
      pick.symbol,
      leagueWeekNumber
    );

    if (!result.eligible && !result.error) {
      stale.push({ pickId: pick.id, symbol: pick.symbol.toUpperCase() });
    }
  }

  if (stale.length === 0) {
    return { required: false, picks: [], message: null };
  }

  const symbols = stale.map((row) => row.symbol).join(", ");
  return {
    required: true,
    picks: stale,
    message: `${symbols} no longer qualifies for IR this week. Drop a starter to open a slot, then move ${stale.length === 1 ? "it" : "them"} back to active before other roster moves.`,
  };
}

export async function runSportsSimIrWeeklyCheck(
  supabase: SupabaseClient,
  leagueId: string,
  weekNumber: number
): Promise<{ staleRosters: number }> {
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("format_type, sports_league_id, sports_standings_season")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league || league.format_type !== "sports_league") {
    return { staleRosters: 0 };
  }

  const { data: drafts, error: draftError } = await supabase
    .from("drafts")
    .select("id, user_id")
    .eq("league_id", leagueId)
    .eq("status", "complete");

  if (draftError || !drafts?.length) {
    return { staleRosters: 0 };
  }

  let staleRosters = 0;
  for (const draft of drafts) {
    const { data: picks } = await supabase
      .from("draft_picks")
      .select("*")
      .eq("draft_id", draft.id)
      .eq("user_id", draft.user_id)
      .eq("pick_type", "ir")
      .neq("symbol", "__OPEN__");

    if (!picks?.length) continue;

    const state = await resolveIrResolutionState(
      supabase,
      leagueId,
      league,
      picks as DraftPick[],
      weekNumber
    );
    if (state.required) staleRosters += 1;
  }

  return { staleRosters };
}
