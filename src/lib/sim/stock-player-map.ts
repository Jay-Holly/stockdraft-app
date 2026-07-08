import type { SupabaseClient } from "@supabase/supabase-js";

import type { SimSport } from "@/lib/sim/types";

type MapRow = {
  player_id: string;
};

export async function hasStockPlayerMapForSport(
  supabase: SupabaseClient,
  sport: SimSport,
  season: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from("sim_stock_player_map")
    .select("*", { count: "exact", head: true })
    .eq("sport", sport)
    .eq("season", season);

  if (error) {
    if (error.code === "PGRST205" || error.message?.includes("sim_stock_player_map")) {
      return false;
    }
    throw new Error(`sim_stock_player_map lookup failed: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

export async function lookupPlayerIdForSymbol(
  supabase: SupabaseClient,
  symbol: string,
  sport: SimSport,
  season: string
): Promise<{ playerId: string | null; mapMissing: boolean; mapEmpty: boolean }> {
  const tableReady = await hasStockPlayerMapForSport(supabase, sport, season);
  if (!tableReady) {
    return { playerId: null, mapMissing: true, mapEmpty: true };
  }

  const { data, error } = await supabase
    .from("sim_stock_player_map")
    .select("player_id")
    .eq("symbol", symbol.toUpperCase())
    .eq("sport", sport)
    .eq("season", season)
    .maybeSingle();

  if (error) {
    throw new Error(`sim_stock_player_map lookup failed: ${error.message}`);
  }

  return {
    playerId: (data as MapRow | null)?.player_id ?? null,
    mapMissing: false,
    mapEmpty: false,
  };
}
