import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadFranchiseRealTeamMap } from "@/lib/matchup/sdfl-schedule";

// SDFL 2026 season only. Not wired into any live draft-start flow yet — a
// deliberate future cutover, same as the other sdfl-2026-* files.
//
// Real 2026 NFL Draft, round 1, ORIGINAL pick order — i.e. which team held
// each slot 1-32 based on final regular-season standings, before any of
// this year's draft-day trades moved picks between teams. Sourced from
// NFL.com / Tankathon draft-order coverage, cross-checked; trade notes
// (e.g. "pick 10, from Bengals") were reversed to recover the original
// owner. All 32 real teams appear exactly once.
export const SDFL_2026_ORIGINAL_DRAFT_ORDER: readonly string[] = [
  "LV", // 1
  "NYJ", // 2
  "ARI", // 3
  "TEN", // 4
  "NYG", // 5
  "CLE", // 6
  "WAS", // 7
  "NO", // 8
  "KC", // 9
  "CIN", // 10
  "MIA", // 11
  "DAL", // 12
  "ATL", // 13
  "BAL", // 14
  "TB", // 15
  "IND", // 16
  "DET", // 17
  "MIN", // 18
  "CAR", // 19
  "GB", // 20
  "PIT", // 21
  "LAC", // 22
  "PHI", // 23
  "JAX", // 24
  "CHI", // 25
  "BUF", // 26
  "SF", // 27
  "HOU", // 28
  "LA", // 29 (Rams)
  "DEN", // 30
  "NE", // 31
  "SEA", // 32
];

const REAL_TEAM_TO_ORIGINAL_SLOT: ReadonlyMap<string, number> = new Map(
  SDFL_2026_ORIGINAL_DRAFT_ORDER.map((team, index) => [team, index + 1])
);

export function getOriginalDraftSlotForRealTeam(team: string): number | null {
  return REAL_TEAM_TO_ORIGINAL_SLOT.get(team.toUpperCase()) ?? null;
}

/**
 * SDFL 2026 stock-draft order for one league: each franchise picks in the
 * same position its mapped real team held in the actual 2026 NFL Draft's
 * original (pre-trade) round 1 order. Returns userIds, pick 1 first — same
 * shape as applyStandardDraftOrderMethod's output.
 *
 * Franchises with no real-team mapping yet (identity not claimed) are
 * appended at the end in whatever order they were encountered, since they
 * have no draft slot to sort by.
 */
export async function computeSdfl2026DraftOrder(
  supabase: SupabaseClient,
  leagueId: string
): Promise<string[]> {
  const teamByFranchise = await loadFranchiseRealTeamMap(supabase, leagueId);

  const ranked: Array<{ userId: string; slot: number }> = [];
  const unranked: string[] = [];

  for (const [userId, team] of teamByFranchise) {
    const slot = getOriginalDraftSlotForRealTeam(team);
    if (slot == null) {
      unranked.push(userId);
    } else {
      ranked.push({ userId, slot });
    }
  }

  ranked.sort((a, b) => a.slot - b.slot);

  return [...ranked.map((row) => row.userId), ...unranked];
}
