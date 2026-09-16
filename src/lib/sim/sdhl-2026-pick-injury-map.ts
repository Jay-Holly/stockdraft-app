import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSportsSimLeague } from "@/lib/season/sdpl-league";
import { isCryptoSymbol } from "@/lib/draft/engine";

// SDHL 2026 season only. Mirrors sdfl-2026-pick-injury-map.ts. Separate
// mechanism from sim_league_pick_injury_map (the 2024 beta cycle-of-100
// approach still used by SDBA/SDLB) and from sim_sdfl_2026_pick_injury_map —
// does not read or write either.

export const SDHL_2026_FALLBACK_RANK_START = 700;
export const SDHL_2026_FALLBACK_RANK_FLOOR = 504;

export type Sdhl2026PickInjuryMapRow = {
  league_id: string;
  global_pick_number: number;
  symbol: string;
  injury_rank: number;
};

async function createSeedSupabase(): Promise<SupabaseClient> {
  try {
    return createServiceClient();
  } catch {
    return await createClient();
  }
}

function loadSp500Symbols(): Set<string> {
  const rankPath = path.join(
    process.cwd(),
    "src",
    "data",
    "sp500-market-cap-ranks.json"
  );
  const payload = JSON.parse(fs.readFileSync(rankPath, "utf8"));
  return new Set(Object.keys(payload.ranks ?? {}).map((s) => s.toUpperCase()));
}

export async function hasSdhl2026PickInjuryMapForLeague(
  supabase: SupabaseClient,
  leagueId: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from("sim_sdhl_2026_pick_injury_map")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId);

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.message?.includes("sim_sdhl_2026_pick_injury_map")
    ) {
      return false;
    }
    throw new Error(`sim_sdhl_2026_pick_injury_map lookup failed: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

export async function lookupSdhl2026PickInjuryMapForSymbol(
  supabase: SupabaseClient,
  leagueId: string,
  symbol: string
): Promise<Sdhl2026PickInjuryMapRow | null> {
  const { data, error } = await supabase
    .from("sim_sdhl_2026_pick_injury_map")
    .select("league_id, global_pick_number, symbol, injury_rank")
    .eq("league_id", leagueId)
    .eq("symbol", symbol.toUpperCase())
    .maybeSingle();

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.message?.includes("sim_sdhl_2026_pick_injury_map")
    ) {
      return null;
    }
    throw new Error(`sim_sdhl_2026_pick_injury_map lookup failed: ${error.message}`);
  }

  return (data as Sdhl2026PickInjuryMapRow | null) ?? null;
}

/**
 * Seeds the off-S&P-500 fallback pool for one SDHL 2026 league's finished
 * draft: every drafted symbol that isn't an S&P 500 stock gets the next
 * rank counting down from 700, in draft order. S&P symbols get no row here
 * — they're covered by sim_stock_player_map directly.
 */
export async function seedSdhl2026PickInjuryMapIfMissing(
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
    }) ||
    league.sports_league_id !== "sdhl"
  ) {
    return { seeded: false, rowCount: 0 };
  }

  if (await hasSdhl2026PickInjuryMapForLeague(supabase, leagueId)) {
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

  const sp500Symbols = loadSp500Symbols();

  const rows: Sdhl2026PickInjuryMapRow[] = [];
  const seenSymbols = new Set<string>();
  let nextRank = SDHL_2026_FALLBACK_RANK_START;

  for (const event of events ?? []) {
    const globalPickNumber = event.global_pick_number;
    const symbol = event.symbol?.trim().toUpperCase();
    if (!globalPickNumber || !symbol) continue;
    if (symbol === "SKIP" || symbol === "__OPEN__") continue;
    if (event.pick_type === "skip") continue;
    if (isCryptoSymbol(symbol)) continue;
    if (sp500Symbols.has(symbol)) continue;
    if (seenSymbols.has(symbol)) continue;
    seenSymbols.add(symbol);

    if (nextRank < SDHL_2026_FALLBACK_RANK_FLOOR) {
      return {
        seeded: false,
        rowCount: rows.length,
        error: `Ran out of fallback ranks (${SDHL_2026_FALLBACK_RANK_FLOOR}-${SDHL_2026_FALLBACK_RANK_START}) for league ${leagueId}.`,
      };
    }

    rows.push({
      league_id: leagueId,
      global_pick_number: globalPickNumber,
      symbol,
      injury_rank: nextRank,
    });
    nextRank -= 1;
  }

  if (rows.length === 0) {
    return { seeded: false, rowCount: 0 };
  }

  const { error: insertError } = await supabase
    .from("sim_sdhl_2026_pick_injury_map")
    .insert(rows);

  if (insertError) {
    return { seeded: false, rowCount: 0, error: insertError.message };
  }

  return { seeded: true, rowCount: rows.length };
}
