import "server-only";

import { loadDraftStateDetailed } from "@/lib/draft/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchPricesForPicks,
  isTrustworthyBaselineValue,
  pickMarketValue,
} from "@/lib/roster/weekly";
import { computeScoringWeekGainPercent } from "@/lib/roster/scoring-math";
import { filterScoringRosterPicks } from "@/lib/roster/crypto-picks";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Per-game (single real-game-day) scoring for SDBA/SDHL/SDLB — each
 * league_matchups row with a game_date is won by whichever side has the
 * better single-day stock/crypto % gain, same box-score model as the
 * weekly SDFL/SDPL/SDAI leagues use per week (see computeScoringWeekGainPercent
 * in lib/roster/scoring-math.ts, reused unchanged here). This module is the
 * day-granularity counterpart of lib/roster/weekly.ts's week-open/week-close
 * baseline capture — it intentionally does not replicate weekly.ts's hybrid
 * weekend-scoring-window logic, since a single game day has no such window
 * to reconcile.
 */

async function loadUserPicks(userId: string, leagueId: string) {
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return [];
  return state.state.picks.filter((pick) => pick.pick_type !== "skip");
}

/** The most recent prior game_date this user has a captured close for, in this league. */
async function loadPriorDayCloseValues(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  gameDate: string
): Promise<Map<string, number>> {
  const { data: priorDateRow } = await supabase
    .from("roster_day_baselines")
    .select("game_date")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .lt("game_date", gameDate)
    .not("value_at_close", "is", null)
    .order("game_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!priorDateRow?.game_date) return new Map();

  const { data: priorRows } = await supabase
    .from("roster_day_baselines")
    .select("pick_id, value_at_close")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("game_date", priorDateRow.game_date);

  return new Map(
    (priorRows ?? [])
      .filter((row) => row.value_at_close != null)
      .map((row) => [row.pick_id as string, Number(row.value_at_close)])
  );
}

/**
 * Fills in this game's open baseline for every pick missing one — chained
 * from the user's most recent prior game close in this league (so a day's
 * open always equals the previous game's close, same invariant
 * captureWeekBaselinesForUser enforces for weeks), falling back to a live
 * quote only for a team's very first game_date baseline of the season.
 */
export async function ensureDayBaselinesForUser(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
  gameDate: string
): Promise<void> {
  const picks = filterScoringRosterPicks(await loadUserPicks(userId, leagueId));
  if (picks.length === 0) return;

  const { data: existingRows } = await supabase
    .from("roster_day_baselines")
    .select("pick_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("game_date", gameDate);

  const existingPickIds = new Set((existingRows ?? []).map((r) => r.pick_id));
  const missingPicks = picks.filter((pick) => !existingPickIds.has(pick.id));
  if (missingPicks.length === 0) return;

  const priorCloseByPick = await loadPriorDayCloseValues(
    supabase,
    leagueId,
    userId,
    gameDate
  );

  const picksNeedingLivePrice = missingPicks.filter(
    (pick) => !priorCloseByPick.has(pick.id)
  );
  const prices =
    picksNeedingLivePrice.length > 0
      ? await fetchPricesForPicks(picksNeedingLivePrice)
      : new Map<string, number>();

  const rows = missingPicks.flatMap((pick) => {
    const carried = priorCloseByPick.get(pick.id);
    const value =
      carried != null
        ? carried
        : pickMarketValue(
            pick,
            prices.get(pick.symbol.toUpperCase()) ?? pick.price_at_pick
          );
    if (!isTrustworthyBaselineValue(pick, value)) return [];
    return [
      {
        league_id: leagueId,
        user_id: userId,
        game_date: gameDate,
        pick_id: pick.id,
        value_at_open: value,
      },
    ];
  });

  if (rows.length === 0) return;

  await supabase.from("roster_day_baselines").upsert(rows, {
    onConflict: "league_id,user_id,game_date,pick_id",
    ignoreDuplicates: true,
  });
}

/** Snapshots today's live price as this game's close, for every league member — call at a game's finalize_at. */
export async function captureDayCloseForLeague(
  leagueId: string,
  gameDate: string,
  supabaseOverride?: SupabaseClient
): Promise<void> {
  const supabase = supabaseOverride ?? (await createClient());
  const { data: drafts } = await supabase
    .from("drafts")
    .select("user_id")
    .eq("league_id", leagueId);

  for (const draft of drafts ?? []) {
    await ensureDayBaselinesForUser(supabase, leagueId, draft.user_id, gameDate);

    const picks = filterScoringRosterPicks(
      await loadUserPicks(draft.user_id, leagueId)
    );
    if (picks.length === 0) continue;

    const prices = await fetchPricesForPicks(picks);

    for (const pick of picks) {
      const closeValue = pickMarketValue(
        pick,
        prices.get(pick.symbol.toUpperCase()) ?? pick.price_at_pick
      );
      if (!isTrustworthyBaselineValue(pick, closeValue)) continue;

      const { data: existing } = await supabase
        .from("roster_day_baselines")
        .select("value_at_open")
        .eq("league_id", leagueId)
        .eq("user_id", draft.user_id)
        .eq("game_date", gameDate)
        .eq("pick_id", pick.id)
        .maybeSingle();

      const openValue = existing?.value_at_open ?? closeValue;

      await supabase.from("roster_day_baselines").upsert(
        {
          league_id: leagueId,
          user_id: draft.user_id,
          game_date: gameDate,
          pick_id: pick.id,
          value_at_open: openValue,
          value_at_close: closeValue,
        },
        { onConflict: "league_id,user_id,game_date,pick_id" }
      );
    }
  }
}

/** This user's single-game % gain for one game_date — the multi-asset-league counterpart of computeScoringWeekGainPercentForUser. */
export async function computeGameScorePercentForUser(
  userId: string,
  leagueId: string,
  gameDate: string,
  supabaseOverride?: SupabaseClient
): Promise<number> {
  const supabase = supabaseOverride ?? (await createClient());
  await ensureDayBaselinesForUser(supabase, leagueId, userId, gameDate);

  const picks = filterScoringRosterPicks(await loadUserPicks(userId, leagueId));
  if (picks.length === 0) return 0;

  const { data: baselineRows } = await supabase
    .from("roster_day_baselines")
    .select("pick_id, value_at_open, value_at_close")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("game_date", gameDate);

  const baselineByPick = new Map(
    (baselineRows ?? []).map((row) => [row.pick_id as string, row])
  );

  const prices = await fetchPricesForPicks(picks);

  const scoringInputs = picks.map((pick) => {
    const baseline = baselineByPick.get(pick.id);
    const weekOpenValue =
      baseline?.value_at_open != null
        ? Number(baseline.value_at_open)
        : pickMarketValue(
            pick,
            prices.get(pick.symbol.toUpperCase()) ?? pick.price_at_pick
          );
    const currentValue =
      baseline?.value_at_close != null
        ? Number(baseline.value_at_close)
        : pickMarketValue(
            pick,
            prices.get(pick.symbol.toUpperCase()) ?? pick.price_at_pick
          );
    return { pickId: pick.id, currentValue, weekOpenValue };
  });

  return computeScoringWeekGainPercent(scoringInputs);
}
