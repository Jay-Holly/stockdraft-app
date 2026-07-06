import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { activateHumanLeagueSchedule } from "@/lib/league/human-league";
import {
  generateCyclingRegularSeasonSchedule,
  generateRegularSeasonSchedule,
  normalizePlayerCount,
} from "@/lib/matchup/schedule";
import { resolveSeasonSettings } from "@/lib/season/calendar";
import { SDPL_REGULAR_SEASON_WEEKS } from "@/lib/season/constants";
import { backfillFinalizeAtForLeague } from "@/lib/matchup/finalize-week";
import { isSdplSeasonRulesLeague } from "@/lib/season/sdpl-league";

async function createSeedSupabase(): Promise<SupabaseClient> {
  try {
    return createServiceClient();
  } catch {
    return await createClient();
  }
}

async function loadLeagueTeamIds(
  supabase: SupabaseClient,
  leagueId: string,
  ownerUserId: string
): Promise<string[]> {
  const { data: members } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .order("draft_slot", { ascending: true, nullsFirst: false });

  if (members && members.length > 0) {
    return members.map((member) => member.user_id);
  }

  return [ownerUserId];
}

async function loadMemberNameMap(
  supabase: SupabaseClient,
  leagueId: string
): Promise<Map<string, string>> {
  const { data: members } = await supabase
    .from("league_members")
    .select("user_id, display_name")
    .eq("league_id", leagueId);

  return new Map(
    (members ?? []).map((member) => [
      member.user_id,
      member.display_name?.trim() || "Team",
    ])
  );
}

export type SeedHumanScheduleResult = {
  seeded: boolean;
  gameCount: number;
  error?: string;
};

/**
 * Insert a full round-robin regular season for a human league when none exists.
 * Includes all league members (humans and bots) — bot-vs-bot weeks are included.
 */
export async function seedHumanLeagueRegularSeasonIfMissing(
  leagueId: string,
  ownerUserId: string
): Promise<SeedHumanScheduleResult> {
  const supabase = await createSeedSupabase();

  const { count: existingCount, error: countError } = await supabase
    .from("league_matchups")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId);

  if (countError) {
    return { seeded: false, gameCount: 0, error: countError.message };
  }

  if (existingCount && existingCount > 0) {
    return { seeded: false, gameCount: 0 };
  }

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select(
      "player_count, owner_user_id, league_type, format_type, sports_league_id"
    )
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league) {
    return {
      seeded: false,
      gameCount: 0,
      error: leagueError?.message ?? "League not found.",
    };
  }

  if (league.league_type !== "human") {
    return { seeded: false, gameCount: 0, error: "Not a human league." };
  }

  const ownerId = league.owner_user_id ?? ownerUserId;
  const teamIds = await loadLeagueTeamIds(supabase, leagueId, ownerId);

  if (teamIds.length < 2) {
    return {
      seeded: false,
      gameCount: 0,
      error: `Not enough teams to build a schedule (${teamIds.length} found).`,
    };
  }

  const isSdpl = isSdplSeasonRulesLeague({
    formatType: league.format_type ?? "standard",
    sportsLeagueId: league.sports_league_id ?? null,
    playerCount: league.player_count ?? null,
  });

  let schedule;
  if (isSdpl) {
    const settingsResult = await supabase
      .from("league_season_settings")
      .select("season_format, regular_season_weeks, week_calendar")
      .eq("league_id", leagueId)
      .maybeSingle();

    const settings = resolveSeasonSettings(
      {
        formatType: league.format_type ?? "standard",
        sportsLeagueId: league.sports_league_id ?? null,
        playerCount: league.player_count ?? null,
      },
      settingsResult.data ?? null
    );

    schedule = generateCyclingRegularSeasonSchedule(
      teamIds,
      settings.regularSeasonWeeks || SDPL_REGULAR_SEASON_WEEKS
    );
  } else {
    schedule = generateRegularSeasonSchedule(teamIds);
  }

  if (schedule.length === 0) {
    return {
      seeded: false,
      gameCount: 0,
      error: "Schedule generator returned no games.",
    };
  }

  const memberNames = await loadMemberNameMap(supabase, leagueId);
  const rows = schedule.map((game) => {
    const homeName = memberNames.get(game.homeUserId) ?? "Home";
    const awayName = memberNames.get(game.awayUserId) ?? "Away";
    const humanIsHome = game.homeUserId === ownerId;
    const humanIsAway = game.awayUserId === ownerId;

    return {
      league_id: leagueId,
      week_number: game.weekNumber,
      home_user_id: game.homeUserId,
      away_user_id: game.awayUserId,
      is_playoff: game.isPlayoff,
      playoff_round: game.playoffRound ?? null,
      opponent_bot_id: humanIsHome
        ? game.awayUserId
        : humanIsAway
          ? game.homeUserId
          : game.awayUserId,
      opponent_name: humanIsHome
        ? awayName
        : humanIsAway
          ? homeName
          : `${homeName} vs ${awayName}`,
      status: "scheduled" as const,
    };
  });

  const { error: matchupError } = await supabase
    .from("league_matchups")
    .insert(rows);

  if (matchupError) {
    console.error(
      `[seedHumanLeagueRegularSeasonIfMissing] insert failed league=${leagueId}:`,
      matchupError.message
    );
    return { seeded: false, gameCount: 0, error: matchupError.message };
  }

  const playerCount = normalizePlayerCount(league.player_count ?? teamIds.length);
  await supabase
    .from("leagues")
    .update({ current_week: 1, player_count: playerCount })
    .eq("id", leagueId);

  const activate = await activateHumanLeagueSchedule(leagueId);
  if (activate.error) {
    return { seeded: true, gameCount: schedule.length, error: activate.error };
  }

  await backfillFinalizeAtForLeague(leagueId);

  return { seeded: true, gameCount: schedule.length };
}

export async function finalizeHumanLeagueAfterDraft(
  leagueId: string,
  ownerUserId: string
): Promise<{ error?: string }> {
  const result = await seedHumanLeagueRegularSeasonIfMissing(leagueId, ownerUserId);
  if (result.error && !result.seeded) {
    console.error(
      `[finalizeHumanLeagueAfterDraft] league=${leagueId}:`,
      result.error
    );
    return { error: result.error };
  }
  return {};
}

export async function seedHumanLeaguesBySupportCodes(
  supportCodes: string[]
): Promise<Array<{ supportCode: string; result: SeedHumanScheduleResult }>> {
  const supabase = await createSeedSupabase();
  const { data: leagues, error } = await supabase
    .from("leagues")
    .select("id, support_code, owner_user_id")
    .in("support_code", supportCodes)
    .eq("league_type", "human");

  if (error || !leagues?.length) {
    return supportCodes.map((supportCode) => ({
      supportCode,
      result: {
        seeded: false,
        gameCount: 0,
        error: error?.message ?? "League not found.",
      },
    }));
  }

  const byCode = new Map(leagues.map((league) => [league.support_code, league]));
  const outputs: Array<{ supportCode: string; result: SeedHumanScheduleResult }> =
    [];

  for (const supportCode of supportCodes) {
    const league = byCode.get(supportCode);
    if (!league?.owner_user_id) {
      outputs.push({
        supportCode,
        result: {
          seeded: false,
          gameCount: 0,
          error: "League not found or missing owner.",
        },
      });
      continue;
    }

    const result = await seedHumanLeagueRegularSeasonIfMissing(
      league.id,
      league.owner_user_id
    );
    outputs.push({ supportCode, result });
  }

  return outputs;
}

export async function seedHumanLeaguesByIds(
  leagueIds: string[]
): Promise<Array<{ leagueId: string; result: SeedHumanScheduleResult }>> {
  const supabase = await createSeedSupabase();
  const { data: leagues, error } = await supabase
    .from("leagues")
    .select("id, owner_user_id, status")
    .in("id", leagueIds)
    .eq("league_type", "human");

  if (error) {
    return leagueIds.map((leagueId) => ({
      leagueId,
      result: {
        seeded: false,
        gameCount: 0,
        error: error.message,
      },
    }));
  }

  const byId = new Map(leagues?.map((league) => [league.id, league]) ?? []);
  const outputs: Array<{ leagueId: string; result: SeedHumanScheduleResult }> =
    [];

  for (const leagueId of leagueIds) {
    const league = byId.get(leagueId);
    if (!league?.owner_user_id) {
      outputs.push({
        leagueId,
        result: {
          seeded: false,
          gameCount: 0,
          error: "League not found or missing owner.",
        },
      });
      continue;
    }

    if (league.status === "drafting" || league.status === "waiting") {
      outputs.push({
        leagueId,
        result: {
          seeded: false,
          gameCount: 0,
          error: `League status ${league.status} — skip until draft complete`,
        },
      });
      continue;
    }

    const result = await seedHumanLeagueRegularSeasonIfMissing(
      league.id,
      league.owner_user_id
    );
    outputs.push({ leagueId, result });
  }

  return outputs;
}
