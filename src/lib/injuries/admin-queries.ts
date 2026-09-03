import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { durationNoteFor } from "@/lib/injuries/logger";

/**
 * Read-side queries for the admin Injuries page only — mirrors
 * src/lib/pricing/admin-queries.ts's shape (latest run, running run,
 * problems-first rows).
 */

export type InjuryRunRow = {
  id: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  weekNumber: number | null;
  entriesFetched: number;
  playersMatched: number;
  injuriesOpened: number;
  injuriesUpdated: number;
  injuriesClosed: number;
  issues: string[];
  triggeredBy: string;
  error: string | null;
};

export type OpenInjuryRow = {
  playerId: string;
  playerName: string;
  team: string | null;
  position: string | null;
  status: string;
  injury: string | null;
  note: string | null;
  startWeek: number | null;
};

export type InjuryLogSnapshot = {
  latestRun: InjuryRunRow | null;
  runningRun: InjuryRunRow | null;
  openInjuries: OpenInjuryRow[];
};

function mapRun(r: Record<string, unknown>): InjuryRunRow {
  return {
    id: r.id as number,
    status: r.status as string,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string) ?? null,
    weekNumber: (r.week_number as number) ?? null,
    entriesFetched: (r.entries_fetched as number) ?? 0,
    playersMatched: (r.players_matched as number) ?? 0,
    injuriesOpened: (r.injuries_opened as number) ?? 0,
    injuriesUpdated: (r.injuries_updated as number) ?? 0,
    injuriesClosed: (r.injuries_closed as number) ?? 0,
    issues: Array.isArray(r.issues) ? (r.issues as string[]) : [],
    triggeredBy: r.triggered_by as string,
    error: (r.error as string) ?? null,
  };
}

export async function getInjuryLogSnapshot(): Promise<InjuryLogSnapshot> {
  const supabase = createServiceClient();

  const [{ data: runs }, { data: openRows }] = await Promise.all([
    supabase
      .from("injury_logger_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(5),
    supabase
      .from("sim_player_injuries")
      .select("player_id, status, injury, start_week, sim_players!inner(sport, season, full_name, position, real_team)")
      .eq("source", "rotowire")
      .is("end_week", null)
      .eq("sim_players.sport", "nfl")
      .eq("sim_players.season", "2026"),
  ]);

  const runRows = (runs ?? []).map(mapRun);
  const runningRun = runRows.find((r) => r.status === "running") ?? null;
  const latestRun = runRows[0] ?? null;

  const openInjuries: OpenInjuryRow[] = (openRows ?? [])
    .map((row: Record<string, unknown>) => {
      const player = row.sim_players as {
        full_name?: string;
        position?: string | null;
        real_team?: string | null;
      } | null;
      const status = row.status as string;
      return {
        playerId: row.player_id as string,
        playerName: player?.full_name ?? "(unknown)",
        team: player?.real_team ?? null,
        position: player?.position ?? null,
        status,
        injury: (row.injury as string) ?? null,
        note: durationNoteFor(status),
        startWeek: (row.start_week as number) ?? null,
      };
    })
    .sort((a, b) => a.playerName.localeCompare(b.playerName));

  return { latestRun, runningRun, openInjuries };
}
