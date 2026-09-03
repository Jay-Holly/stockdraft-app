import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSportsSimLeague } from "@/lib/season/sdpl-league";
import { isCryptoSymbol } from "@/lib/draft/engine";

// SDFL 2026 season only. This is a separate mechanism from
// sim_league_pick_injury_map (the 2024 beta trial cycle-of-100 approach) and
// does not read or write that table. It is not wired into any live draft
// flow yet — a deliberate future cutover, not automatic.

export const SDFL_2026_FALLBACK_RANK_START = 700;
export const SDFL_2026_FALLBACK_RANK_FLOOR = 504;

export type Sdfl2026PickInjuryMapRow = {
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

export async function hasSdfl2026PickInjuryMapForLeague(
  supabase: SupabaseClient,
  leagueId: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from("sim_sdfl_2026_pick_injury_map")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId);

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.message?.includes("sim_sdfl_2026_pick_injury_map")
    ) {
      return false;
    }
    throw new Error(`sim_sdfl_2026_pick_injury_map lookup failed: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

export async function lookupSdfl2026PickInjuryMapForSymbol(
  supabase: SupabaseClient,
  leagueId: string,
  symbol: string
): Promise<Sdfl2026PickInjuryMapRow | null> {
  const { data, error } = await supabase
    .from("sim_sdfl_2026_pick_injury_map")
    .select("league_id, global_pick_number, symbol, injury_rank")
    .eq("league_id", leagueId)
    .eq("symbol", symbol.toUpperCase())
    .maybeSingle();

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.message?.includes("sim_sdfl_2026_pick_injury_map")
    ) {
      return null;
    }
    throw new Error(`sim_sdfl_2026_pick_injury_map lookup failed: ${error.message}`);
  }

  return (data as Sdfl2026PickInjuryMapRow | null) ?? null;
}

/**
 * Seeds the off-S&P-500 fallback pool for one SDFL 2026 league's finished
 * draft: every drafted symbol that isn't an S&P 500 stock gets the next
 * rank counting down from 700, in draft order. S&P symbols get no row here
 * — they're covered by sim_stock_player_map directly.
 */
export async function seedSdfl2026PickInjuryMapIfMissing(
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
    league.sports_league_id !== "sdfl"
  ) {
    return { seeded: false, rowCount: 0 };
  }

  if (await hasSdfl2026PickInjuryMapForLeague(supabase, leagueId)) {
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

  const rows: Sdfl2026PickInjuryMapRow[] = [];
  const seenSymbols = new Set<string>();
  let nextRank = SDFL_2026_FALLBACK_RANK_START;

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

    if (nextRank < SDFL_2026_FALLBACK_RANK_FLOOR) {
      return {
        seeded: false,
        rowCount: rows.length,
        error: `Ran out of fallback ranks (${SDFL_2026_FALLBACK_RANK_FLOOR}-${SDFL_2026_FALLBACK_RANK_START}) for league ${leagueId}.`,
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
    .from("sim_sdfl_2026_pick_injury_map")
    .insert(rows);

  if (insertError) {
    return { seeded: false, rowCount: 0, error: insertError.message };
  }

  return { seeded: true, rowCount: rows.length };
}
