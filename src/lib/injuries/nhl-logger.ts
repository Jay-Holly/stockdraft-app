import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

// NHL counterpart to src/lib/injuries/logger.ts — same rule: this is the ONE
// thing that talks to RotoWire's hockey injury feed. Every SDHL league reads
// what this writes to sim_player_injuries — nothing else should call
// RotoWire's hockey endpoint directly.
//
// Unlike the NFL logger, NHL is date-windowed, not week-windowed
// (simSportUsesWeekNumbers("nhl") is false — see src/lib/sim/sport.ts), so
// this writes start_date/end_date instead of start_week/end_week. Same
// live-snapshot problem as the NFL feed applies: RotoWire only reports who's
// hurt *right now*, so this has to run on a schedule and log real observed
// status transitions instead of a one-shot import.

const SPORT = "nhl";
const SEASON = "2026";
const ROTOWIRE_URL = "https://www.rotowire.com/hockey/tables/injury-report.php?team=ALL&pos=ALL";

// NHL's real injured-reserve designations — a player is actually off the
// roster for a real stretch. "Day-To-Day" and "Out" are game-day
// designations (same distinction the NFL logger makes for
// Questionable/Doubtful/Out), not an IR placement, so they don't trigger IR.
const ON_IR_STATUSES = new Set(["IR", "IR-LT", "IR-NR"]);

function durationNoteFor(status: string): string | null {
  switch (status) {
    case "IR":
      return "On IR (NHL roster rule)";
    case "IR-LT":
      return "On long-term injured reserve";
    case "IR-NR":
      return "On injured reserve — not ready to return";
    default:
      return null;
  }
}

type RotowireEntry = {
  ID: string;
  firstname: string;
  lastname: string;
  player: string;
  team: string;
  position: string;
  injury: string;
  status: string;
};

type SimPlayerRow = {
  player_id: string;
  full_name: string;
  real_team: string | null;
};

type OpenInjuryRow = {
  id: number;
  player_id: string;
  start_date: string | null;
  status: string | null;
  injury: string | null;
};

export type InjuryPollResult = {
  runId: number;
  status: "complete" | "failed";
  weekNumber: number;
  entriesFetched: number;
  playersMatched: number;
  injuriesOpened: number;
  injuriesUpdated: number;
  injuriesClosed: number;
  issues: string[];
  error?: string;
};

function normalizeNameKey(fullName: string): string {
  return fullName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchRotowireInjuries(): Promise<RotowireEntry[]> {
  const res = await fetch(ROTOWIRE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.rotowire.com/hockey/injury-report.php",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`RotoWire fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function runNhlInjuryPoll(options: {
  triggeredBy: "cron" | "manual";
  triggeredByUser?: string;
}): Promise<InjuryPollResult> {
  const supabase = createServiceClient();
  const issues: string[] = [];

  const { data: runRow, error: runInsertError } = await supabase
    .from("injury_logger_runs")
    .insert({
      sport: SPORT,
      season: SEASON,
      triggered_by: options.triggeredBy,
      triggered_by_user: options.triggeredByUser ?? null,
    })
    .select("id")
    .single();

  if (runInsertError || !runRow) {
    throw new Error(`Failed to open injury_logger_runs row: ${runInsertError?.message}`);
  }
  const runId = Number(runRow.id);

  const finish = async (
    patch: Partial<{
      status: "complete" | "failed";
      entries_fetched: number;
      players_matched: number;
      injuries_opened: number;
      injuries_updated: number;
      injuries_closed: number;
      issues: string[];
      error: string;
    }>
  ) => {
    await supabase
      .from("injury_logger_runs")
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq("id", runId);
  };

  try {
    const today = todayIso();

    const [entries, playersResult] = await Promise.all([
      fetchRotowireInjuries(),
      supabase
        .from("sim_players")
        .select("player_id, full_name, real_team")
        .eq("sport", SPORT)
        .eq("season", SEASON),
    ]);

    if (playersResult.error) {
      throw new Error(`sim_players query failed: ${playersResult.error.message}`);
    }
    const trackedPlayers = (playersResult.data ?? []) as SimPlayerRow[];
    if (trackedPlayers.length === 0) {
      throw new Error(`No sim_players for ${SPORT}/${SEASON} — seed the player pool first.`);
    }

    const nameKeyToPlayerId = new Map<string, string>();
    for (const p of trackedPlayers) {
      const key = normalizeNameKey(p.full_name);
      if (nameKeyToPlayerId.has(key)) {
        issues.push(`Duplicate name key "${key}" in sim_players — one will shadow the other.`);
        continue;
      }
      nameKeyToPlayerId.set(key, p.player_id);
    }

    const matched = new Map<string, { status: string; injury: string }>();
    for (const entry of entries) {
      if (!ON_IR_STATUSES.has(entry.status)) continue;
      const key = normalizeNameKey(`${entry.firstname} ${entry.lastname}`);
      const playerId = nameKeyToPlayerId.get(key);
      if (!playerId) continue; // not in our tracked 700 — not an error, just outside the pool

      const trackedPlayer = trackedPlayers.find((p) => p.player_id === playerId);
      if (trackedPlayer?.real_team && trackedPlayer.real_team !== entry.team) {
        issues.push(
          `Team mismatch for ${entry.player}: RotoWire=${entry.team}, tracked=${trackedPlayer.real_team} (matched by name anyway)`
        );
      }
      matched.set(playerId, { status: entry.status, injury: entry.injury });
    }

    // Same reasoning as the NFL logger: no .in("player_id", [...700 ids])
    // here — it blows past PostgREST's header-size limit. This logger is
    // the only writer of source='rotowire-nhl' rows, so every open row it
    // sees already belongs to a tracked nhl/2026 player by construction.
    const { data: openRowsData, error: openRowsError } = await supabase
      .from("sim_player_injuries")
      .select("id, player_id, start_date, status, injury")
      .eq("source", "rotowire-nhl")
      .is("end_date", null);

    if (openRowsError) {
      throw new Error(`sim_player_injuries query failed: ${openRowsError.message}`);
    }
    const openRowByPlayer = new Map<string, OpenInjuryRow>();
    for (const row of (openRowsData ?? []) as OpenInjuryRow[]) {
      openRowByPlayer.set(row.player_id, row);
    }

    let opened = 0;
    let updated = 0;
    let closed = 0;

    const inserts: Array<{
      player_id: string;
      start_date: string;
      injury: string;
      status: string;
      source: string;
    }> = [];

    for (const player of trackedPlayers) {
      const current = matched.get(player.player_id);
      const openRow = openRowByPlayer.get(player.player_id);

      if (current && !openRow) {
        inserts.push({
          player_id: player.player_id,
          start_date: today,
          injury: current.injury,
          status: current.status,
          source: "rotowire-nhl",
        });
        opened++;
      } else if (current && openRow) {
        if (openRow.status !== current.status || openRow.injury !== current.injury) {
          const { error } = await supabase
            .from("sim_player_injuries")
            .update({ status: current.status, injury: current.injury })
            .eq("id", openRow.id);
          if (error) {
            issues.push(`Failed to update injury row ${openRow.id}: ${error.message}`);
          } else {
            updated++;
          }
        }
      } else if (!current && openRow) {
        const { error } = await supabase
          .from("sim_player_injuries")
          .update({ end_date: today })
          .eq("id", openRow.id);
        if (error) {
          issues.push(`Failed to close injury row ${openRow.id}: ${error.message}`);
        } else {
          closed++;
        }
      }
    }

    if (inserts.length > 0) {
      const { error } = await supabase.from("sim_player_injuries").insert(inserts);
      if (error) {
        throw new Error(`sim_player_injuries insert failed: ${error.message}`);
      }
    }

    await finish({
      status: "complete",
      entries_fetched: entries.length,
      players_matched: matched.size,
      injuries_opened: opened,
      injuries_updated: updated,
      injuries_closed: closed,
      issues,
    });

    return {
      runId,
      status: "complete",
      weekNumber: 0,
      entriesFetched: entries.length,
      playersMatched: matched.size,
      injuriesOpened: opened,
      injuriesUpdated: updated,
      injuriesClosed: closed,
      issues,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish({ status: "failed", error: message, issues });
    return {
      runId,
      status: "failed",
      weekNumber: 0,
      entriesFetched: 0,
      playersMatched: 0,
      injuriesOpened: 0,
      injuriesUpdated: 0,
      injuriesClosed: 0,
      issues,
      error: message,
    };
  }
}

export { durationNoteFor, ON_IR_STATUSES };
