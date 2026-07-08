import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSportsSimLeague } from "@/lib/season/sdpl-league";

export type PickInjuryMapRow = {
  league_id: string;
  global_pick_number: number;
  symbol: string;
  injury_rank: number;
  cycle_group: number;
  week_offset: number;
};

export function computePickInjuryFields(globalPickNumber: number): {
  injury_rank: number;
  cycle_group: number;
  week_offset: number;
} {
  const injury_rank = ((globalPickNumber - 1) % 100) + 1;
  const cycle_group = Math.floor((globalPickNumber - 1) / 100);
  const week_offset = cycle_group * 2;
  return { injury_rank, cycle_group, week_offset };
}

async function createSeedSupabase(): Promise<SupabaseClient> {
  try {
    return createServiceClient();
  } catch {
    return await createClient();
  }
}

export async function hasPickInjuryMapForLeague(
  supabase: SupabaseClient,
  leagueId: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from("sim_league_pick_injury_map")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId);

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.message?.includes("sim_league_pick_injury_map")
    ) {
      return false;
    }
    throw new Error(`sim_league_pick_injury_map lookup failed: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

export async function lookupPickInjuryMapForSymbol(
  supabase: SupabaseClient,
  leagueId: string,
  symbol: string
): Promise<PickInjuryMapRow | null> {
  const { data, error } = await supabase
    .from("sim_league_pick_injury_map")
    .select(
      "league_id, global_pick_number, symbol, injury_rank, cycle_group, week_offset"
    )
    .eq("league_id", leagueId)
    .eq("symbol", symbol.toUpperCase())
    .maybeSingle();

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.message?.includes("sim_league_pick_injury_map")
    ) {
      return null;
    }
    throw new Error(`sim_league_pick_injury_map lookup failed: ${error.message}`);
  }

  return (data as PickInjuryMapRow | null) ?? null;
}

export async function seedSportsLeaguePickInjuryMapIfMissing(
  leagueId: string
): Promise<{ seeded: boolean; rowCount: number; error?: string }> {
  const supabase = await createSeedSupabase();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("format_type, sports_league_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league) {
    return {
      seeded: false,
      rowCount: 0,
      error: leagueError?.message ?? "League not found.",
    };
  }

  if (
    !isSportsSimLeague({
      formatType: league.format_type,
      sportsLeagueId: league.sports_league_id,
    })
  ) {
    return { seeded: false, rowCount: 0 };
  }

  if (await hasPickInjuryMapForLeague(supabase, leagueId)) {
    return { seeded: false, rowCount: 0 };
  }

  const { data: events, error: eventsError } = await supabase
    .from("league_draft_events")
    .select("global_pick_number, symbol, pick_type")
    .eq("league_id", leagueId)
    .order("global_pick_number", { ascending: true });

  if (eventsError) {
    return { seeded: false, rowCount: 0, error: eventsError.message };
  }

  const rows: PickInjuryMapRow[] = [];
  for (const event of events ?? []) {
    const globalPickNumber = event.global_pick_number;
    const symbol = event.symbol?.trim().toUpperCase();
    if (!globalPickNumber || !symbol) continue;
    if (symbol === "SKIP" || symbol === "__OPEN__") continue;
    if (event.pick_type === "skip") continue;

    const { injury_rank, cycle_group, week_offset } =
      computePickInjuryFields(globalPickNumber);

    rows.push({
      league_id: leagueId,
      global_pick_number: globalPickNumber,
      symbol,
      injury_rank,
      cycle_group,
      week_offset,
    });
  }

  if (rows.length === 0) {
    return {
      seeded: false,
      rowCount: 0,
      error: "No draft events with global_pick_number found for injury map seed.",
    };
  }

  const { error: insertError } = await supabase
    .from("sim_league_pick_injury_map")
    .insert(rows);

  if (insertError) {
    return { seeded: false, rowCount: 0, error: insertError.message };
  }

  return { seeded: true, rowCount: rows.length };
}
