import type { SupabaseClient } from "@supabase/supabase-js";

import {
  defaultSimSeason,
  simSportUsesWeekNumbers,
  sportsLeagueIdToSimSport,
} from "@/lib/sim/sport";
import {
  hasPickInjuryMapForLeague,
  lookupPickInjuryMapForSymbol,
} from "@/lib/sim/pick-injury-map";
import { lookupPlayerIdForSymbol } from "@/lib/sim/stock-player-map";
import type {
  IrEligibilityResult,
  SimEligibilityContext,
  SimSport,
} from "@/lib/sim/types";

type InjuryRow = {
  start_week: number | null;
  end_week: number | null;
  start_date: string | null;
  end_date: string | null;
};

function addDaysIso(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function resolveSimEligibilityContext(
  sport: SimSport,
  season: string,
  leagueWeekNumber: number,
  seasonAnchorDate?: string | null
): SimEligibilityContext {
  if (simSportUsesWeekNumbers(sport)) {
    return { mode: "week", weekNumber: leagueWeekNumber };
  }

  const anchor = seasonAnchorDate ?? `${season}-01-01`;
  const weekStart = addDaysIso(anchor, (leagueWeekNumber - 1) * 7);
  const weekEnd = addDaysIso(weekStart, 6);
  return { mode: "date", weekStart, weekEnd };
}

function injurySpansWeek(
  injury: InjuryRow,
  context: SimEligibilityContext
): boolean {
  if (context.mode === "week") {
    const start = injury.start_week;
    if (start == null) return false;
    const end = injury.end_week;
    return (
      start <= context.weekNumber &&
      (end == null || context.weekNumber <= end)
    );
  }

  const startDate = injury.start_date;
  if (!startDate) return false;
  const endDate = injury.end_date;
  return (
    startDate <= context.weekEnd &&
    (endDate == null || endDate >= context.weekStart)
  );
}

function injurySpansWeekWithOffset(
  injury: InjuryRow,
  context: SimEligibilityContext,
  weekOffset: number
): boolean {
  if (weekOffset === 0) {
    return injurySpansWeek(injury, context);
  }

  if (context.mode === "week") {
    const start = injury.start_week;
    if (start == null) return false;
    const end = injury.end_week;
    const shiftedStart = start + weekOffset;
    const shiftedEnd = end != null ? end + weekOffset : null;
    return (
      shiftedStart <= context.weekNumber &&
      (shiftedEnd == null || context.weekNumber <= shiftedEnd)
    );
  }

  const offsetDays = weekOffset * 7;
  const shiftedInjury: InjuryRow = {
    start_week: injury.start_week,
    end_week: injury.end_week,
    start_date: injury.start_date
      ? addDaysIso(injury.start_date, offsetDays)
      : null,
    end_date: injury.end_date
      ? addDaysIso(injury.end_date, offsetDays)
      : null,
  };
  return injurySpansWeek(shiftedInjury, context);
}

export async function isPlayerIrEligible(
  supabase: SupabaseClient,
  playerId: string,
  sport: SimSport,
  context: SimEligibilityContext
): Promise<boolean> {
  const { data, error } = await supabase
    .from("sim_player_injuries")
    .select("start_week, end_week, start_date, end_date")
    .eq("player_id", playerId);

  if (error) {
    if (error.code === "PGRST205" || error.message?.includes("sim_player_injuries")) {
      return false;
    }
    throw new Error(`sim_player_injuries lookup failed: ${error.message}`);
  }

  return (data as InjuryRow[] | null)?.some((row) =>
    injurySpansWeek(row, context)
  ) ?? false;
}

async function isPlayerIrEligibleWithWeekOffset(
  supabase: SupabaseClient,
  playerId: string,
  sport: SimSport,
  context: SimEligibilityContext,
  weekOffset: number
): Promise<boolean> {
  const { data, error } = await supabase
    .from("sim_player_injuries")
    .select("start_week, end_week, start_date, end_date")
    .eq("player_id", playerId);

  if (error) {
    if (error.code === "PGRST205" || error.message?.includes("sim_player_injuries")) {
      return false;
    }
    throw new Error(`sim_player_injuries lookup failed: ${error.message}`);
  }

  return (data as InjuryRow[] | null)?.some((row) =>
    injurySpansWeekWithOffset(row, context, weekOffset)
  ) ?? false;
}

async function lookupEditorialPlayerIdByRank(
  supabase: SupabaseClient,
  sport: SimSport,
  season: string,
  injuryRank: number
): Promise<string | null> {
  const { data, error } = await supabase
    .from("sim_player_rankings")
    .select("player_id, sim_players!inner(sport, season)")
    .eq("rank", injuryRank)
    .eq("tier", "editorial")
    .eq("sim_players.sport", sport)
    .eq("sim_players.season", season)
    .maybeSingle();

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.message?.includes("sim_player_rankings")
    ) {
      return null;
    }
    throw new Error(`sim_player_rankings lookup failed: ${error.message}`);
  }

  return (data as { player_id?: string } | null)?.player_id ?? null;
}

async function isStockIrEligibleViaPickInjuryMap(
  supabase: SupabaseClient,
  leagueId: string,
  symbol: string,
  sport: SimSport,
  season: string,
  leagueWeekNumber: number,
  options?: { seasonAnchorDate?: string | null }
): Promise<IrEligibilityResult> {
  const upper = symbol.toUpperCase();
  if (upper === "__OPEN__" || upper === "SKIP") {
    return { eligible: false, error: "Empty roster slot." };
  }

  const mapRow = await lookupPickInjuryMapForSymbol(supabase, leagueId, upper);
  if (!mapRow) {
    return {
      eligible: false,
      error: `${upper} has no league pick injury mapping. Complete the draft or re-seed the injury map.`,
    };
  }

  const playerId = await lookupEditorialPlayerIdByRank(
    supabase,
    sport,
    season,
    mapRow.injury_rank
  );
  if (!playerId) {
    return {
      eligible: false,
      error: `No editorial player found for injury rank ${mapRow.injury_rank} (${sport.toUpperCase()} ${season}).`,
    };
  }

  const context = resolveSimEligibilityContext(
    sport,
    season,
    leagueWeekNumber,
    options?.seasonAnchorDate
  );
  const eligible = await isPlayerIrEligibleWithWeekOffset(
    supabase,
    playerId,
    sport,
    context,
    mapRow.week_offset
  );

  return { eligible };
}

export async function isStockIrEligible(
  supabase: SupabaseClient,
  symbol: string,
  sport: SimSport,
  season: string,
  leagueWeekNumber: number,
  options?: { seasonAnchorDate?: string | null }
): Promise<IrEligibilityResult> {
  const upper = symbol.toUpperCase();
  if (upper === "__OPEN__" || upper === "SKIP") {
    return { eligible: false, error: "Empty roster slot." };
  }

  const map = await lookupPlayerIdForSymbol(supabase, upper, sport, season);
  if (map.mapMissing) {
    return {
      eligible: false,
      error: `Stock-to-player mapping is not seeded for ${sport.toUpperCase()} ${season}. IR eligibility cannot be checked yet.`,
    };
  }
  if (!map.playerId) {
    return {
      eligible: false,
      error: `${upper} has no mapped player for ${sport.toUpperCase()} ${season}.`,
    };
  }

  const context = resolveSimEligibilityContext(
    sport,
    season,
    leagueWeekNumber,
    options?.seasonAnchorDate
  );
  const eligible = await isPlayerIrEligible(
    supabase,
    map.playerId,
    sport,
    context
  );

  return { eligible };
}

export async function isStockIrEligibleForLeague(
  supabase: SupabaseClient,
  leagueId: string,
  league: {
    sports_league_id: string | null;
    sports_standings_season?: number | null;
  },
  symbol: string,
  leagueWeekNumber: number,
  options?: { seasonAnchorDate?: string | null }
): Promise<IrEligibilityResult> {
  const sport = sportsLeagueIdToSimSport(league.sports_league_id);
  if (!sport) {
    return { eligible: false, error: "Not a sports-sim league." };
  }

  const season = defaultSimSeason(league.sports_standings_season);

  if (await hasPickInjuryMapForLeague(supabase, leagueId)) {
    return isStockIrEligibleViaPickInjuryMap(
      supabase,
      leagueId,
      symbol,
      sport,
      season,
      leagueWeekNumber,
      options
    );
  }

  return isStockIrEligible(
    supabase,
    symbol,
    sport,
    season,
    leagueWeekNumber,
    options
  );
}
