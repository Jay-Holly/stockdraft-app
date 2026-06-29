import {
  assertFreeAgencyOpen,
  assertLineupUnlocked,
  SeasonCalendarError,
} from "@/lib/season/calendar";
import { loadSeasonCalendarForLeague } from "@/lib/season/settings-server";
import type { SeasonCalendarErrorCode } from "@/lib/season/types";

export type RosterMoveResult = {
  error?: string;
  code?: SeasonCalendarErrorCode;
};

export function rosterMoveHttpStatus(result: RosterMoveResult): number {
  if (!result.error) return 200;
  if (result.code === "LINEUP_LOCKED" || result.code === "FA_CLOSED") {
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
