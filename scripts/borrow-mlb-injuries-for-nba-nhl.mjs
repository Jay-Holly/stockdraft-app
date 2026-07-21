#!/usr/bin/env node
/**
 * Borrow MLB 2024's real injury spans for NBA and NHL, since no free
 * scriptable injury-history source exists for either sport (see
 * seed-sim-nba-2024.mjs / seed-sim-nhl-2024.mjs headers).
 *
 * MLB's 187 real IL spans (2024-03-25 through 2024-09-29) are split at the
 * season midpoint (2024-06-27): spans starting before the midpoint go to
 * NBA, spans starting on/after go to NHL. Each span is reassigned to the
 * player at the SAME sim_player_rankings.rank in the target sport (rank 1's
 * injury history -> whichever player is rank 1 in nba/nhl), so it lines up
 * with the same rank-based pick-injury-map lookup already used everywhere
 * else. Dates/injury text/games_missed are copied as-is from the MLB span;
 * source is tagged "borrowed-from-mlb-2024" so this is never mistaken for
 * real NBA/NHL injury history later.
 *
 * Usage:
 *   node --env-file=.env.local scripts/borrow-mlb-injuries-for-nba-nhl.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SEASON = "2024";
const MIDPOINT_DATE = "2024-06-27";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function loadRankedInjuries(sport) {
  const { data: players, error: playersError } = await supabase
    .from("sim_players")
    .select("player_id")
    .eq("sport", sport)
    .eq("season", SEASON);
  if (playersError) throw playersError;

  const playerIds = (players ?? []).map((row) => row.player_id);
  if (playerIds.length === 0) {
    throw new Error(`No sim_players for sport=${sport} season=${SEASON}.`);
  }

  const { data: rankings, error: rankingsError } = await supabase
    .from("sim_player_rankings")
    .select("player_id, rank")
    .in("player_id", playerIds);
  if (rankingsError) throw rankingsError;

  /** @type {Map<string, number>} */
  const playerIdToRank = new Map(
    (rankings ?? []).map((row) => [row.player_id, row.rank])
  );

  if (sport === "mlb") {
    const { data: injuries, error: injuriesError } = await supabase
      .from("sim_player_injuries")
      .select("*")
      .in("player_id", playerIds);
    if (injuriesError) throw injuriesError;
    return { playerIdToRank, injuries: injuries ?? [] };
  }

  return { playerIdToRank, injuries: [] };
}

async function loadRankToPlayerId(sport) {
  const { data: players, error: playersError } = await supabase
    .from("sim_players")
    .select("player_id")
    .eq("sport", sport)
    .eq("season", SEASON);
  if (playersError) throw playersError;

  const playerIds = (players ?? []).map((row) => row.player_id);
  const { data: rankings, error: rankingsError } = await supabase
    .from("sim_player_rankings")
    .select("player_id, rank")
    .in("player_id", playerIds);
  if (rankingsError) throw rankingsError;

  /** @type {Map<number, string>} */
  const rankToPlayerId = new Map();
  for (const row of rankings ?? []) {
    rankToPlayerId.set(row.rank, row.player_id);
  }
  return rankToPlayerId;
}

async function clearBorrowedInjuries(sport) {
  const { data: players, error } = await supabase
    .from("sim_players")
    .select("player_id")
    .eq("sport", sport)
    .eq("season", SEASON);
  if (error) throw error;

  const ids = (players ?? []).map((row) => row.player_id);
  if (ids.length === 0) return;

  const { error: delErr } = await supabase
    .from("sim_player_injuries")
    .delete()
    .in("player_id", ids);
  if (delErr) throw delErr;
}

async function insertBatched(table, rows, batchSize = 400) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
  }
}

async function main() {
  console.log("Loading MLB 2024 rank -> injury spans...");
  const { playerIdToRank: mlbPlayerIdToRank, injuries: mlbInjuries } =
    await loadRankedInjuries("mlb");

  const rankToSpans = new Map();
  for (const inj of mlbInjuries) {
    const rank = mlbPlayerIdToRank.get(inj.player_id);
    if (!rank) continue;
    if (!rankToSpans.has(rank)) rankToSpans.set(rank, []);
    rankToSpans.get(rank).push(inj);
  }

  console.log(
    `  ${mlbInjuries.length} MLB spans across ${rankToSpans.size} ranked players`
  );

  console.log("Loading NBA / NHL rank -> player_id...");
  const nbaRankToPlayerId = await loadRankToPlayerId("nba");
  const nhlRankToPlayerId = await loadRankToPlayerId("nhl");

  const nbaInjuries = [];
  const nhlInjuries = [];

  for (const [rank, spans] of rankToSpans) {
    const nbaPlayerId = nbaRankToPlayerId.get(rank);
    const nhlPlayerId = nhlRankToPlayerId.get(rank);

    for (const span of spans) {
      const isFirstHalf =
        span.start_date != null && span.start_date < MIDPOINT_DATE;

      if (isFirstHalf && nbaPlayerId) {
        nbaInjuries.push({
          player_id: nbaPlayerId,
          start_week: null,
          end_week: null,
          start_date: span.start_date,
          end_date: span.end_date,
          injury: span.injury,
          status: span.status,
          games_missed: span.games_missed,
          source: "borrowed-from-mlb-2024:first-half",
        });
      } else if (!isFirstHalf && nhlPlayerId) {
        nhlInjuries.push({
          player_id: nhlPlayerId,
          start_week: null,
          end_week: null,
          start_date: span.start_date,
          end_date: span.end_date,
          injury: span.injury,
          status: span.status,
          games_missed: span.games_missed,
          source: "borrowed-from-mlb-2024:second-half",
        });
      }
    }
  }

  console.log("Clearing existing sim_player_injuries for nba/nhl 2024...");
  await clearBorrowedInjuries("nba");
  await clearBorrowedInjuries("nhl");

  console.log(`Inserting ${nbaInjuries.length} borrowed NBA spans...`);
  if (nbaInjuries.length > 0) await insertBatched("sim_player_injuries", nbaInjuries);

  console.log(`Inserting ${nhlInjuries.length} borrowed NHL spans...`);
  if (nhlInjuries.length > 0) await insertBatched("sim_player_injuries", nhlInjuries);

  console.log("\n=== Summary ===");
  console.log(
    `NBA: ${nbaInjuries.length} spans (from MLB spans starting before ${MIDPOINT_DATE})`
  );
  console.log(
    `NHL: ${nhlInjuries.length} spans (from MLB spans starting on/after ${MIDPOINT_DATE})`
  );
  console.log("Source tags: borrowed-from-mlb-2024:first-half / :second-half");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
