/**
 * Sports League draft order — FUTURE REQUIREMENT (not fully implemented).
 *
 * Draft pick order for SDFL / SDHL / SDBA / SDLB should eventually mirror each
 * format's real-world prior-season standings (NFL, NHL, NBA, MLB). That data is
 * factual, publicly available, and used only as internal design logic.
 *
 * PUBLIC DISPLAY RESTRICTION (non-negotiable):
 * - Never show real pro team names, logos, marks, or branding in the user-facing app.
 * - Users only see StockDraft-owned identities (SDFL, SDHL, SDBA, SDLB franchises).
 * - Referencing NFL / NHL / NBA / MLB in code, comments, and internal sync logic is fine.
 *
 * ANNUAL REFRESH TIMING (design target — day after each league's championship):
 * - NFL (SDFL): day after the Super Bowl
 * - NHL (SDHL): day after the Stanley Cup Final
 * - NBA (SDBA): day after the NBA Finals
 * - MLB (SDLB): day after the World Series
 *
 * Implementation sketch (later):
 * 1. `pro_league_standings_snapshots` table keyed by pro_league + season_year
 * 2. Scheduled job checks championship calendar; ingests final standings next day
 * 3. Map real finish rank → fictional SDFL/SDHL/SDBA/SDLB franchise slot
 * 4. Assign StockDraft league_members to pick positions by that rank order
 *
 * Until then, sports leagues fall back to standard random shuffle at draft start.
 */

import type { SportsLeagueId } from "@/lib/league/sports-league-standings";
import { applyStandardDraftOrderMethod } from "@/lib/league/draft-order";

export type SportsLeagueDraftOrderContext = {
  leagueId: string;
  sportsLeagueId: SportsLeagueId;
  playerCount: number;
  /** Populated when standings sync exists; null until implemented. */
  standingsSeason: number | null;
};

/** Calendar anchors for the post-championship standings refresh job (UTC dates TBD per season). */
export const PRO_CHAMPIONSHIP_REFRESH_RULES: Record<
  SportsLeagueId,
  {
    /** Internal reference only — not shown in product UI. */
    proLeagueName: "NFL" | "NHL" | "NBA" | "MLB";
    /** Human-readable trigger for ops/docs. */
    refreshTrigger: string;
  }
> = {
  sdfl: {
    proLeagueName: "NFL",
    refreshTrigger: "Day after Super Bowl",
  },
  sdhl: {
    proLeagueName: "NHL",
    refreshTrigger: "Day after Stanley Cup Final",
  },
  sdba: {
    proLeagueName: "NBA",
    refreshTrigger: "Day after NBA Finals",
  },
  sdlb: {
    proLeagueName: "MLB",
    refreshTrigger: "Day after World Series",
  },
};

export function isSportsStandingsDraftOrderReady(
  context: SportsLeagueDraftOrderContext
): boolean {
  return context.standingsSeason != null;
}

/**
 * Placeholder until standings snapshots exist.
 * Uses random_shuffle so sports leagues can run today without a rebuild later.
 */
export function applySportsLeagueDraftOrder(
  memberIds: string[],
  context: SportsLeagueDraftOrderContext
): string[] {
  if (isSportsStandingsDraftOrderReady(context)) {
    // Future: rank members by mapped franchise prior-season finish.
    // return orderByPriorSeasonStandings(memberIds, context);
  }

  return applyStandardDraftOrderMethod(
    memberIds,
    context.playerCount,
    context.leagueId,
    "random_shuffle"
  );
}
