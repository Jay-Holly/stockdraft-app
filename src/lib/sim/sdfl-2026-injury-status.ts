import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveSimEligibilityContext,
  isPlayerIrEligible,
} from "@/lib/sim/injury-status";
import {
  hasSdfl2026PickInjuryMapForLeague,
  lookupSdfl2026PickInjuryMapForSymbol,
} from "@/lib/sim/sdfl-2026-pick-injury-map";
import { lookupPlayerIdForSymbol } from "@/lib/sim/stock-player-map";
import type { IrEligibilityResult } from "@/lib/sim/types";

// SDFL 2026 season only. Reuses the shared week/date-window math from
// injury-status.ts, but resolves symbol -> player via the 2026 rank data
// (sim_stock_player_map for S&P symbols, sim_sdfl_2026_pick_injury_map for
// everything else) instead of the 2024 beta trial's cycle-of-100 map. Not
// wired into any live draft-finalize flow yet.

const SPORT = "nfl";
const SEASON = "2026";

async function lookupPlayerIdByRank(
  supabase: SupabaseClient,
  rank: number
): Promise<string | null> {
  const { data, error } = await supabase
    .from("sim_player_rankings")
    .select("player_id, sim_players!inner(sport, season)")
    .eq("rank", rank)
    .eq("tier", "editorial")
    .eq("sim_players.sport", SPORT)
    .eq("sim_players.season", SEASON)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST205" || error.message?.includes("sim_player_rankings")) {
      return null;
    }
    throw new Error(`sim_player_rankings lookup failed: ${error.message}`);
  }

  return (data as { player_id?: string } | null)?.player_id ?? null;
}

export async function isSdfl2026StockIrEligible(
  supabase: SupabaseClient,
  leagueId: string,
  symbol: string,
  leagueWeekNumber: number,
  options?: { seasonAnchorDate?: string | null }
): Promise<IrEligibilityResult> {
  const upper = symbol.toUpperCase();
  if (upper === "__OPEN__" || upper === "SKIP") {
    return { eligible: false, error: "Empty roster slot." };
  }

  let playerId: string | null = null;

  const fallbackRow = await lookupSdfl2026PickInjuryMapForSymbol(supabase, leagueId, upper);
  if (fallbackRow) {
    playerId = await lookupPlayerIdByRank(supabase, fallbackRow.injury_rank);
    if (!playerId) {
      return {
        eligible: false,
        error: `No player found for fallback rank ${fallbackRow.injury_rank}.`,
      };
    }
  } else {
    const map = await lookupPlayerIdForSymbol(supabase, upper, SPORT, SEASON);
    if (map.mapMissing) {
      return {
        eligible: false,
        error: `Stock-to-player mapping is not seeded for SDFL ${SEASON}.`,
      };
    }
    if (!map.playerId) {
      return {
        eligible: false,
        error: `${upper} has no mapped player for SDFL ${SEASON}.`,
      };
    }
    playerId = map.playerId;
  }

  const context = resolveSimEligibilityContext(
    SPORT,
    SEASON,
    leagueWeekNumber,
    options?.seasonAnchorDate
  );
  const eligible = await isPlayerIrEligible(supabase, playerId, SPORT, context);

  return { eligible };
}

/**
 * Injured symbols for a whole SDFL 2026 roster in one shot. Mirrors
 * loadInjuredSymbolsForLeague's batching approach but resolves each symbol
 * through whichever of the two 2026 sources applies to it.
 */
export async function loadSdfl2026InjuredSymbolsForLeague(
  supabase: SupabaseClient,
  leagueId: string,
  symbols: string[],
  leagueWeekNumber: number,
  options?: { seasonAnchorDate?: string | null }
): Promise<Set<string>> {
  const injured = new Set<string>();
  if (symbols.length === 0) return injured;

  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))].filter(
    (s) => s !== "__OPEN__" && s !== "SKIP"
  );
  if (wanted.length === 0) return injured;

  const symbolToRank = new Map<string, number>();

  if (await hasSdfl2026PickInjuryMapForLeague(supabase, leagueId)) {
    const { data: fallbackRows, error: fallbackError } = await supabase
      .from("sim_sdfl_2026_pick_injury_map")
      .select("symbol, injury_rank")
      .eq("league_id", leagueId)
      .in("symbol", wanted);

    if (!fallbackError) {
      for (const row of fallbackRows ?? []) {
        symbolToRank.set(String(row.symbol).toUpperCase(), Number(row.injury_rank));
      }
    }
  }

  const remaining = wanted.filter((s) => !symbolToRank.has(s));
  if (remaining.length > 0) {
    const { data: mapRows, error: mapError } = await supabase
      .from("sim_stock_player_map")
      .select("symbol, sim_player_rankings!inner(rank)")
      .eq("sport", SPORT)
      .eq("season", SEASON)
      .in("symbol", remaining);

    if (!mapError) {
      for (const row of mapRows ?? []) {
        const rank = (row as { sim_player_rankings?: { rank?: number } })
          .sim_player_rankings?.rank;
        if (rank != null) {
          symbolToRank.set(String(row.symbol).toUpperCase(), Number(rank));
        }
      }
    }
  }

  if (symbolToRank.size === 0) return injured;

  const ranks = [...new Set(symbolToRank.values())];
  const { data: rankRows, error: rankError } = await supabase
    .from("sim_player_rankings")
    .select("player_id, rank, sim_players!inner(sport, season)")
    .eq("tier", "editorial")
    .in("rank", ranks)
    .eq("sim_players.sport", SPORT)
    .eq("sim_players.season", SEASON);

  if (rankError || !rankRows?.length) return injured;

  const playerByRank = new Map<number, string>(
    rankRows.map((row) => [Number(row.rank), String(row.player_id)])
  );

  const playerIds = [...new Set([...playerByRank.values()])];
  const { data: injuryRows, error: injuryError } = await supabase
    .from("sim_player_injuries")
    .select("player_id, start_week, end_week, start_date, end_date")
    .in("player_id", playerIds);

  if (injuryError || !injuryRows?.length) return injured;

  const injuriesByPlayer = new Map<string, typeof injuryRows>();
  for (const row of injuryRows) {
    const key = String(row.player_id);
    if (!injuriesByPlayer.has(key)) injuriesByPlayer.set(key, []);
    injuriesByPlayer.get(key)!.push(row);
  }

  const context = resolveSimEligibilityContext(SPORT, SEASON, leagueWeekNumber, options?.seasonAnchorDate);

  for (const [symbol, rank] of symbolToRank) {
    const playerId = playerByRank.get(rank);
    if (!playerId) continue;

    const spans = (injuriesByPlayer.get(playerId) ?? []).some((injury) => {
      if (context.mode === "week") {
        const start = injury.start_week;
        if (start == null) return false;
        const end = injury.end_week;
        return start <= context.weekNumber && (end == null || context.weekNumber <= end);
      }
      const startDate = injury.start_date;
      if (!startDate) return false;
      const endDate = injury.end_date;
      return startDate <= context.weekEnd && (endDate == null || endDate >= context.weekStart);
    });

    if (spans) injured.add(symbol);
  }

  return injured;
}
