import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

// Mirrors src/lib/pricing/logger.ts: this is the ONE thing that talks to an
// injury data provider. Every league reads what this writes to
// sim_player_injuries — nothing else should call RotoWire directly.
//
// Unlike prices, RotoWire's injury-report feed is a live snapshot with no
// history endpoint: it only says who's hurt *right now*. So this can't be a
// one-shot import — it has to run on a schedule and log real, observed
// status transitions (open a span when a tracked player first shows up on
// IR, close it when they drop off) exactly as your price logger logs real
// observed prices instead of interpolating them.

const SPORT = "nfl";
const SEASON = "2026";
const ROTOWIRE_URL = "https://www.rotowire.com/football/tables/injury-report.php?team=ALL&pos=ALL";

// Same convention as scripts/seed-sim-nfl-2026-br1000.mjs: Rams are "LA" in
// this app's real_team column.
const TEAM_ALIAS: Record<string, string> = { LAR: "LA" };

// The NFL roster designations that actually mean "on injured reserve" for
// SDFL's IR mechanic — not every "Reserve-*" code is an injury. Excluded on
// purpose: Reserve-Ret (retired), Reserve-Sus (suspension), Reserve-CEL
// (commissioner exempt list), Reserve-Ex (exempt) — none of those are a
// real player injury. Questionable/Doubtful/Out are day-to-day game
// designations, not an IR placement, so they don't trigger IR either.
const ON_IR_STATUSES = new Set(["IR", "IR-R", "PUP-R", "PUP-P", "NFI-R", "Reserve-DNR"]);

// A defensible, rule-based note instead of a guessed return date (RotoWire's
// own "Est. Return" column is subscriber-only — see the logger's header
// comment for why we didn't just pay for that field instead: these notes
// are real NFL roster rules, not someone's projection).
function durationNoteFor(status: string): string | null {
  switch (status) {
    case "IR-R":
      return "On IR — practice window open, return imminent";
    case "IR":
      return "On IR — minimum 4 games out (NFL roster rule)";
    case "PUP-R":
      return "Preseason PUP — out at least the first 4 games of the season";
    case "NFI-R":
      return "Non-football injury reserve — out at least the first 4 games of the season";
    case "Reserve-DNR":
      return "Designated not to return — out for the season";
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
  start_week: number | null;
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

async function fetchRotowireInjuries(): Promise<RotowireEntry[]> {
  const res = await fetch(ROTOWIRE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.rotowire.com/football/injury-report.php",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`RotoWire fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * "Current week" is whatever leagues.current_week SDFL 2026 leagues are
 * actually on — not an independently computed date formula. The IR
 * eligibility check (src/lib/sim/sdfl-2026-injury-status.ts) compares
 * sim_player_injuries.start_week/end_week directly against
 * leagueRow.current_week, so this has to read the same number those leagues
 * are on, not recompute it from a season-start date that could drift.
 * Defaults to week 1 when no SDFL 2026 league exists yet.
 */
async function resolveCurrentWeek(
  supabase: ReturnType<typeof createServiceClient>
): Promise<number> {
  const { data, error } = await supabase
    .from("leagues")
    .select("current_week")
    .eq("sports_league_id", "sdfl")
    .eq("sports_standings_season", Number(SEASON))
    .order("current_week", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.current_week) return 1;
  return Number(data.current_week);
}

export async function runInjuryPoll(options: {
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
      week_number: number;
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
    const weekNumber = await resolveCurrentWeek(supabase);

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
      const team = TEAM_ALIAS[entry.team] ?? entry.team;
      const key = normalizeNameKey(`${entry.firstname} ${entry.lastname}`);
      const playerId = nameKeyToPlayerId.get(key);
      if (!playerId) continue; // not in our tracked 700 — not an error, just outside the pool

      const trackedPlayer = trackedPlayers.find((p) => p.player_id === playerId);
      if (trackedPlayer?.real_team && trackedPlayer.real_team !== team) {
        issues.push(
          `Team mismatch for ${entry.player}: RotoWire=${team}, tracked=${trackedPlayer.real_team} (matched by name anyway)`
        );
      }
      matched.set(playerId, { status: entry.status, injury: entry.injury });
    }

    // No .in("player_id", [...700 ids]) here on purpose — that blows past
    // PostgREST's ~16KB request-header limit (UND_ERR_HEADERS_OVERFLOW), the
    // same failure scripts/seed-sim-stock-player-map.mjs hit. It's also
    // unnecessary: this logger is the only writer of source='rotowire' rows,
    // so every open row it can see already belongs to a tracked nfl/2026
    // player by construction.
    const { data: openRowsData, error: openRowsError } = await supabase
      .from("sim_player_injuries")
      .select("id, player_id, start_week, status, injury")
      .eq("source", "rotowire")
      .is("end_week", null);

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
      start_week: number;
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
          start_week: weekNumber,
          injury: current.injury,
          status: current.status,
          source: "rotowire",
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
        const endWeek = Math.max(openRow.start_week ?? weekNumber, weekNumber - 1);
        const { error } = await supabase
          .from("sim_player_injuries")
          .update({ end_week: endWeek })
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
      week_number: weekNumber,
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
      weekNumber,
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
