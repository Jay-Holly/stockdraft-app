import {
  assertFreeAgencyOpen,
  assertLineupUnlocked,
  SeasonCalendarError,
} from "@/lib/season/calendar";
import { loadSeasonCalendarForLeague } from "@/lib/season/settings-server";
import type { SeasonCalendarErrorCode } from "@/lib/season/types";
import { createServiceClient } from "@/lib/supabase/service";
import { loadDraftStateDetailed } from "@/lib/draft/server";
import { resolveIrResolutionState } from "@/lib/sim/ir-enforcement";
import { isSportsSimLeague } from "@/lib/season/sdpl-league";

export type RosterMoveResult = {
  error?: string;
  code?: SeasonCalendarErrorCode;
};

export function rosterMoveHttpStatus(result: RosterMoveResult): number {
  if (!result.error) return 200;
  if (
    result.code === "LINEUP_LOCKED" ||
    result.code === "FA_CLOSED" ||
    result.code === "IR_RESOLUTION_REQUIRED"
  ) {
    return 403;
  }
  return 400;
}

async function runSeasonGate(
  leagueId: string,
  gate: "lineup" | "freeAgency"
): Promise<RosterMoveResult | null> {
  const { settings } = await loadSeasonCalendarForLeague(leagueId);
  const now = new Date();

  try {
    if (gate === "lineup") {
      assertLineupUnlocked(now, settings);
    } else {
      assertFreeAgencyOpen(now, settings);
    }
  } catch (error) {
    if (error instanceof SeasonCalendarError) {
      return { error: error.message, code: error.code };
    }
    throw error;
  }

  return null;
}

export async function enforceLineupUnlockedForLeague(
  leagueId: string
): Promise<RosterMoveResult | null> {
  return runSeasonGate(leagueId, "lineup");
}

export async function enforceFreeAgencyOpenForLeague(
  leagueId: string
): Promise<RosterMoveResult | null> {
  return runSeasonGate(leagueId, "freeAgency");
}

async function loadIrResolutionForUser(
  leagueId: string,
  userId: string
): Promise<RosterMoveResult | null> {
  const supabase = createServiceClient();
  const { data: leagueRow } = await supabase
    .from("leagues")
    .select(
      "format_type, sports_league_id, sports_standings_season, current_week"
    )
    .eq("id", leagueId)
    .maybeSingle();

  if (
    !leagueRow ||
    !isSportsSimLeague({
      formatType: leagueRow.format_type,
      sportsLeagueId: leagueRow.sports_league_id,
    })
  ) {
    return null;
  }

  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return null;

  const resolution = await resolveIrResolutionState(
    supabase,
    leagueId,
    leagueRow,
    state.state.picks,
    leagueRow.current_week ?? 1
  );

  if (!resolution.required) return null;

  return {
    error:
      resolution.message ??
      "Resolve stale IR stocks before making other roster moves.",
    code: "IR_RESOLUTION_REQUIRED",
  };
}

export type SportsSimIrMoveKind = "move_to_ir" | "return_from_ir" | "other";

export async function enforceSportsSimIrMoveAllowed(
  leagueId: string,
  userId: string,
  kind: SportsSimIrMoveKind
): Promise<RosterMoveResult | null> {
  if (kind === "move_to_ir" || kind === "return_from_ir") {
    return null;
  }

  return loadIrResolutionForUser(leagueId, userId);
}

export async function enforceIrResolutionClearForLeague(
  _leagueId: string,
  _userId: string
): Promise<void> {
  // Resolution is computed live from picks + injury data; no persisted flag to clear.
}

export async function enforceIrResolutionForLeague(
  leagueId: string,
  userId: string
): Promise<RosterMoveResult | null> {
  return loadIrResolutionForUser(leagueId, userId);
}
