import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  applyStandardDraftOrderMethod,
  parseDraftOrderMethodSetting,
  type DraftOrderMethodSetting,
} from "@/lib/league/draft-order";
import {
  applySportsLeagueDraftOrder,
  type SportsLeagueDraftOrderContext,
} from "@/lib/league/sports-league-draft-order";
import { parseSportsLeagueId } from "@/lib/league/sports-league-standings";

export async function loadLeagueMemberIds(
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<string[]> {
  const supabase = supabaseOverride ?? (await createClient());
  const { data: members } = await supabase
    .from("league_members")
    .select("user_id, draft_slot")
    .eq("league_id", leagueId)
    .order("draft_slot", { ascending: true, nullsFirst: false });

  return (members ?? []).map((member) => member.user_id);
}

export async function persistDraftSlotOrder(
  leagueId: string,
  draftOrder: string[],
  supabaseOverride?: SupabaseClient
): Promise<{ error?: string }> {
  const supabase = supabaseOverride ?? (await createClient());

  for (let slot = 0; slot < draftOrder.length; slot++) {
    const { error } = await supabase
      .from("league_members")
      .update({ draft_slot: slot })
      .eq("league_id", leagueId)
      .eq("user_id", draftOrder[slot]);

    if (error) return { error: error.message };
  }

  return {};
}

export async function resolveDraftOrderForLeague(
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<{ draftOrder: string[]; error?: string }> {
  const supabase = supabaseOverride ?? (await createClient());

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select(
      "format_type, sports_league_id, player_count, draft_order_method, sports_standings_season"
    )
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league) {
    return { draftOrder: [], error: leagueError?.message ?? "League not found." };
  }

  const memberIds = await loadLeagueMemberIds(leagueId, supabase);
  if (memberIds.length < 2) {
    return { draftOrder: memberIds };
  }

  const playerCount = league.player_count ?? memberIds.length;
  let draftOrder: string[];

  if (league.format_type === "sports_league") {
    const sportsLeagueId = parseSportsLeagueId(league.sports_league_id);
    if (!sportsLeagueId) {
      return { draftOrder: [], error: "Invalid sports league format." };
    }

    const context: SportsLeagueDraftOrderContext = {
      leagueId,
      sportsLeagueId,
      playerCount,
      standingsSeason: league.sports_standings_season ?? null,
    };

    draftOrder = applySportsLeagueDraftOrder(memberIds, context);
  } else {
    const method = parseDraftOrderMethodSetting(league.draft_order_method);
    draftOrder = applyStandardDraftOrderMethod(
      memberIds,
      playerCount,
      leagueId,
      method
    );
  }

  const persist = await persistDraftSlotOrder(leagueId, draftOrder, supabase);
  if (persist.error) {
    return { draftOrder: [], error: persist.error };
  }

  return { draftOrder };
}

/** @deprecated use resolveDraftOrderForLeague */
export async function buildDraftOrder(leagueId: string): Promise<string[]> {
  const result = await resolveDraftOrderForLeague(leagueId);
  return result.draftOrder;
}

export function previewStandardDraftOrder(
  memberIds: string[],
  playerCount: number,
  leagueId: string,
  method: DraftOrderMethodSetting
): string[] {
  return applyStandardDraftOrderMethod(
    memberIds,
    playerCount,
    leagueId,
    method
  );
}
