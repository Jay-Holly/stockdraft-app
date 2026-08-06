import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isStockIrEligibleForLeague as isStockIrEligibleForLeague2024,
  loadInjuredSymbolsForLeague as loadInjuredSymbolsForLeague2024,
} from "@/lib/sim/injury-status";
import {
  isSdfl2026StockIrEligible,
  loadSdfl2026InjuredSymbolsForLeague,
} from "@/lib/sim/sdfl-2026-injury-status";
import { sportsLeagueIdToSimSport, defaultSimSeason } from "@/lib/sim/sport";
import type { IrEligibilityResult } from "@/lib/sim/types";

// Single dispatch point used by every call site instead of importing
// injury-status.ts's 2024-era functions directly. Routes SDFL (once its
// season resolves to 2026, which it now does via CURRENT_SIM_SEASON) to the
// isolated sdfl-2026-injury-status.ts path; every other sports-sim league
// (still on 2024 data) keeps using the original 2024 mechanism unchanged.
//
// Lives in its own file rather than inside injury-status.ts to avoid a
// circular import: sdfl-2026-injury-status.ts already imports shared
// week/date-window helpers from injury-status.ts.

type LeagueRef = {
  sports_league_id: string | null;
  sports_standings_season?: number | null;
};

function isSdfl2026(league: LeagueRef): boolean {
  const sport = sportsLeagueIdToSimSport(league.sports_league_id);
  if (!sport) return false;
  return sport === "nfl" && defaultSimSeason(league.sports_standings_season) === "2026";
}

export async function isStockIrEligibleForLeague(
  supabase: SupabaseClient,
  leagueId: string,
  league: LeagueRef,
  symbol: string,
  leagueWeekNumber: number,
  options?: { seasonAnchorDate?: string | null }
): Promise<IrEligibilityResult> {
  if (isSdfl2026(league)) {
    return isSdfl2026StockIrEligible(supabase, leagueId, symbol, leagueWeekNumber, options);
  }
  return isStockIrEligibleForLeague2024(supabase, leagueId, league, symbol, leagueWeekNumber, options);
}

export async function loadInjuredSymbolsForLeague(
  supabase: SupabaseClient,
  leagueId: string,
  league: LeagueRef,
  symbols: string[],
  leagueWeekNumber: number,
  options?: { seasonAnchorDate?: string | null }
): Promise<Set<string>> {
  if (isSdfl2026(league)) {
    return loadSdfl2026InjuredSymbolsForLeague(supabase, leagueId, symbols, leagueWeekNumber, options);
  }
  return loadInjuredSymbolsForLeague2024(supabase, leagueId, league, symbols, leagueWeekNumber, options);
}
