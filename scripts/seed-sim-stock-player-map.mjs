#!/usr/bin/env node
/**
 * Seed sim_stock_player_map for a sports-sim sport/season by joining parallel rank lists:
 *   - Stocks: S&P 500 market-cap rank from src/data/sp500-market-cap-ranks.json
 *             (same single draft_pool every sports-sim league draws from, via
 *             getMarketCapRank / enrichDraftPoolStocks)
 *   - Players: sim_player_rankings.rank for the given sport/season
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-sim-stock-player-map.mjs --sport nfl --season 2024
 *   node --env-file=.env.local scripts/seed-sim-stock-player-map.mjs --sport mlb --season 2024
 *   node --env-file=.env.local scripts/seed-sim-stock-player-map.mjs --sport nfl --season 2026 --total-ranks 503
 *   (defaults to --sport nfl --season 2024 --total-ranks 384 if omitted)
 *
 * Prerequisites:
 *   - Migration 049_sports_sim_ir_slots.sql applied (sim_stock_player_map table)
 *   - sim_players + sim_player_rankings seeded with ranks 1..--total-ranks complete
 *     (e.g. scripts/seed-sim-nfl-2024.mjs, or scripts/seed-sim-nfl-2026-br1000.mjs)
 *   - src/data/sp500-market-cap-ranks.json present (503 S&P ranks; 1..--total-ranks required)
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SPORT = "nfl";
const DEFAULT_SEASON = "2024";
const DEFAULT_TOTAL_RANKS = 384;

const RANKS_JSON_PATH = path.join(
  process.cwd(),
  "src",
  "data",
  "sp500-market-cap-ranks.json"
);

function parseArgs() {
  const args = process.argv.slice(2);
  let sport = DEFAULT_SPORT;
  let season = DEFAULT_SEASON;
  let totalRanks = DEFAULT_TOTAL_RANKS;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sport" && args[i + 1]) {
      sport = args[++i].toLowerCase();
    } else if (args[i] === "--season" && args[i + 1]) {
      season = args[++i];
    } else if (args[i] === "--total-ranks" && args[i + 1]) {
      totalRanks = Number(args[++i]);
    }
  }

  return { sport, season, totalRanks };
}

function loadStockRankToSymbol(totalRanks) {
  if (!fs.existsSync(RANKS_JSON_PATH)) {
    throw new Error(
      `Missing ${RANKS_JSON_PATH}. Run: npm run fetch:market-cap-ranks`
    );
  }

  const payload = JSON.parse(fs.readFileSync(RANKS_JSON_PATH, "utf8"));
  const ranks = payload.ranks;
  if (!ranks || typeof ranks !== "object") {
    throw new Error("sp500-market-cap-ranks.json: expected { ranks: { SYMBOL: rank } }");
  }

  /** @type {Map<number, string>} */
  const rankToSymbol = new Map();

  for (const [symbol, rankRaw] of Object.entries(ranks)) {
    const rank = Number(rankRaw);
    if (!Number.isFinite(rank) || rank < 1) continue;
    if (rankToSymbol.has(rank)) {
      throw new Error(
        `Duplicate market-cap rank ${rank}: ${rankToSymbol.get(rank)} and ${symbol}`
      );
    }
    rankToSymbol.set(rank, symbol.toUpperCase());
  }

  const missingStockRanks = [];
  for (let rank = 1; rank <= totalRanks; rank++) {
    if (!rankToSymbol.has(rank)) missingStockRanks.push(rank);
  }

  return { rankToSymbol, missingStockRanks, totalSymbols: Object.keys(ranks).length };
}

async function loadPlayerRankings(supabase, sport, season, totalRanks) {
  const { count: playerCount, error: playersError } = await supabase
    .from("sim_players")
    .select("*", { count: "exact", head: true })
    .eq("sport", sport)
    .eq("season", season);

  if (playersError) {
    if (
      playersError.code === "PGRST205" ||
      playersError.message?.includes("sim_players")
    ) {
      throw new Error(
        "sim_players table not found. Apply migration 047_sim_foundation.sql."
      );
    }
    throw new Error(`sim_players query failed: ${playersError.message}`);
  }

  if (!playerCount) {
    throw new Error(
      `No sim_players for sport=${sport} season=${season}. Run scripts/seed-sim-nfl-2024.mjs first.`
    );
  }

  // Joins through sim_players for the sport/season filter instead of an
  // .in("player_id", [...ids]) list — with 500+ players that list overflows
  // PostgREST's ~16KB request-header limit (UND_ERR_HEADERS_OVERFLOW).
  const { data: rankings, error: rankingsError } = await supabase
    .from("sim_player_rankings")
    .select("player_id, rank, tier, sim_players!inner(sport, season)")
    .eq("sim_players.sport", sport)
    .eq("sim_players.season", season)
    .order("rank", { ascending: true });

  if (rankingsError) {
    throw new Error(`sim_player_rankings query failed: ${rankingsError.message}`);
  }

  /** @type {Map<number, { player_id: string; tier: string }>} */
  const rankToPlayer = new Map();
  for (const row of rankings ?? []) {
    const rank = Number(row.rank);
    if (!Number.isFinite(rank)) continue;
    if (rankToPlayer.has(rank)) {
      throw new Error(
        `Duplicate player rank ${rank} in sim_player_rankings for ${sport} ${season}`
      );
    }
    rankToPlayer.set(rank, {
      player_id: row.player_id,
      tier: row.tier,
    });
  }

  const missingPlayerRanks = [];
  for (let rank = 1; rank <= totalRanks; rank++) {
    if (!rankToPlayer.has(rank)) missingPlayerRanks.push(rank);
  }

  return { rankToPlayer, missingPlayerRanks, playerCount };
}

async function verifyDraftPoolSymbols(supabase, symbols) {
  const { data, error } = await supabase
    .from("draft_pool")
    .select("symbol")
    .in("symbol", symbols);

  if (error) {
    console.warn(`draft_pool verification skipped: ${error.message}`);
    return new Set(symbols);
  }

  return new Set((data ?? []).map((row) => row.symbol.toUpperCase()));
}

async function main() {
  const { sport, season, totalRanks } = parseArgs();

  if (!["nfl", "mlb", "nba", "nhl"].includes(sport)) {
    console.error(
      `Unknown sport "${sport}". Expected one of: nfl, mlb, nba, nhl.`
    );
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error(
      "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
    );
    process.exit(1);
  }

  console.log(`Seeding sim_stock_player_map for sport=${sport} season=${season}\n`);
  console.log(
    "Stock rank source: src/data/sp500-market-cap-ranks.json (S&P 500 market-cap order used by SDFL)"
  );

  const { rankToSymbol, missingStockRanks, totalSymbols } = loadStockRankToSymbol(totalRanks);
  console.log(
    `Loaded ${totalSymbols} S&P market-cap ranks; ranks 1-${totalRanks} missing: ${missingStockRanks.length}`
  );

  if (missingStockRanks.length > 0) {
    console.error(
      `PREREQUISITE FAILED: SDFL stock pool is not rank-ordered 1-${totalRanks}.`,
      "Missing market-cap ranks:",
      missingStockRanks.slice(0, 20).join(", "),
      missingStockRanks.length > 20 ? "…" : ""
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { rankToPlayer, missingPlayerRanks, playerCount } =
    await loadPlayerRankings(supabase, sport, season, totalRanks);

  console.log(
    `Loaded ${playerCount} sim_players; player ranks 1-${totalRanks} missing: ${missingPlayerRanks.length}`
  );

  if (missingPlayerRanks.length > 0) {
    console.error(
      `PREREQUISITE FAILED: sim_player_rankings is not complete 1-${totalRanks}.`,
      "Missing ranks:",
      missingPlayerRanks.slice(0, 20).join(", "),
      missingPlayerRanks.length > 20 ? "…" : ""
    );
    process.exit(1);
  }

  const draftPoolSymbols = await verifyDraftPoolSymbols(
    supabase,
    [...rankToSymbol.entries()]
      .filter(([rank]) => rank <= totalRanks)
      .map(([, symbol]) => symbol)
  );

  const notInDraftPool = [];
  const rows = [];
  const unmatchedStockRanks = [];

  for (let rank = 1; rank <= totalRanks; rank++) {
    const symbol = rankToSymbol.get(rank);
    const player = rankToPlayer.get(rank);

    if (!symbol) {
      unmatchedStockRanks.push(rank);
      continue;
    }
    if (!player) continue;

    if (!draftPoolSymbols.has(symbol)) {
      notInDraftPool.push({ rank, symbol });
    }

    rows.push({
      symbol,
      player_id: player.player_id,
      sport,
      season,
      map_rank: rank,
    });
  }

  if (unmatchedStockRanks.length > 0) {
    console.error("Unmatched stock ranks (no S&P symbol):", unmatchedStockRanks);
    process.exit(1);
  }

  if (notInDraftPool.length > 0) {
    console.warn(
      `Warning: ${notInDraftPool.length} rank-mapped symbols not in draft_pool table ` +
        `(still inserting; ranks file is canonical for SDFL mapping).`
    );
    for (const row of notInDraftPool.slice(0, 5)) {
      console.warn(`  rank ${row.rank}: ${row.symbol}`);
    }
  }

  const { error: deleteError } = await supabase
    .from("sim_stock_player_map")
    .delete()
    .eq("sport", sport)
    .eq("season", season);

  if (deleteError) {
    if (
      deleteError.code === "PGRST205" ||
      deleteError.message?.includes("sim_stock_player_map")
    ) {
      throw new Error(
        "sim_stock_player_map table not found. Apply migration 049_sports_sim_ir_slots.sql."
      );
    }
    throw new Error(`Clear existing map failed: ${deleteError.message}`);
  }

  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("sim_stock_player_map").insert(chunk);
    if (error) {
      throw new Error(`Insert failed at batch ${i / BATCH + 1}: ${error.message}`);
    }
    inserted += chunk.length;
  }

  console.log("\n--- Summary ---");
  console.log(`Rows inserted: ${inserted}`);
  console.log(`Unmatched stock ranks (1-${totalRanks}): ${unmatchedStockRanks.length}`);
  console.log(`Sample: rank 1 → ${rankToSymbol.get(1)} / ${rankToPlayer.get(1)?.player_id}`);
  console.log(
    `Sample: rank ${totalRanks} → ${rankToSymbol.get(totalRanks)} / ${rankToPlayer.get(totalRanks)?.player_id}`
  );
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
