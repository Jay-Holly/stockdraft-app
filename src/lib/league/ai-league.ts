import { createClient } from "@/lib/supabase/server";
import { startLiveDraft } from "@/lib/draft/live-draft";
import { loadDraftStateDetailed } from "@/lib/draft/server";
import { summarizePicks } from "@/lib/draft/engine";
import type { DraftPick, DraftSummary } from "@/lib/draft/types";
import type { BotPersonality } from "@/lib/league/bots";
import {
  buildBotConfigForPersonality,
  getLeagueBotMembers,
} from "@/lib/league/league-bots";
import { getBotProfile } from "@/lib/league/bots";
import type { League } from "@/lib/league/server";
import { getLeagueMemberTeamName } from "@/lib/league/server";
import {
  getAiLeagueById,
  listAiLeaguesForUser,
  resolveActiveAiLeagueId,
  verifyUserOwnsLeague,
} from "@/lib/league/active-league";
import { captureWeekBaselinesForLeague } from "@/lib/roster/weekly";
import { AI_LEAGUE_FIELDS } from "@/lib/league/fields";
import { DEFAULT_LEAGUE_SCORING_MODE } from "@/lib/league/scoring-mode";
import {
  generateRegularSeasonSchedule,
  normalizePlayerCount,
} from "@/lib/matchup/schedule";
import { getLeagueTeamIds } from "@/lib/matchup/league-teams";
import {
  findHumanMatchupForWeek,
  getOpponentUserId,
  humanScoreFromMatchup,
  opponentScoreFromMatchup,
  legacyWinnerForHuman,
} from "@/lib/matchup/types";

export type AiLeague = League & {
  league_type: "solo" | "ai";
  status: "drafting" | "active" | "complete";
  owner_user_id: string | null;
  scoring_mode: "percent_gain" | "dollar_gain";
};

export type AiLeagueSummary = {
  league: AiLeague;
  humanDraftComplete: boolean;
  botsComplete: boolean;
  standings: {
    wins: number;
    losses: number;
    currentWeek: number;
  } | null;
  currentMatchup: {
    weekNumber: number;
    opponentName: string;
    opponentBotId: string;
    humanScorePct: number | null;
    opponentScorePct: number | null;
    winner: string | null;
    status: string;
  } | null;
  lastCompletedMatchup: {
    weekNumber: number;
    opponentName: string;
    humanScorePct: number | null;
    opponentScorePct: number | null;
    winner: string | null;
  } | null;
  bots: Array<{
    id: string;
    name: string;
    personality: string;
    draftComplete: boolean;
  }>;
};

export type AiLeagueListItem = {
  league: AiLeague;
  humanTeamName: string;
  botNames: string[];
  humanDraftComplete: boolean;
  standings: {
    wins: number;
    losses: number;
    currentWeek: number;
  } | null;
};

export { listAiLeaguesForUser } from "@/lib/league/active-league";

export async function listAiLeagueListItems(
  userId: string
): Promise<AiLeagueListItem[]> {
  const leagues = await listAiLeaguesForUser(userId);
  if (leagues.length === 0) return [];

  const supabase = await createClient();

  return Promise.all(
    leagues.map(async (league) => {
      const leagueBots = await getLeagueBotMembers(league.id);
      const humanDraft = await loadDraftStateDetailed(userId, {
        leagueId: league.id,
      });

      const { data: standingsRow } = await supabase
        .from("league_standings")
        .select("wins, losses, current_week")
        .eq("league_id", league.id)
        .eq("user_id", userId)
        .maybeSingle();

      return {
        league,
        humanTeamName: await getLeagueMemberTeamName(league.id, userId),
        botNames: leagueBots.map((b) => b.displayName),
        humanDraftComplete:
          humanDraft.ok && humanDraft.state.draft.status === "complete",
        standings: standingsRow
          ? {
              wins: standingsRow.wins,
              losses: standingsRow.losses,
              currentWeek: standingsRow.current_week,
            }
          : null,
      };
    })
  );
}

export async function getLatestAiLeagueForUser(
  userId: string
): Promise<AiLeague | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select(AI_LEAGUE_FIELDS)
    .eq("owner_user_id", userId)
    .eq("league_type", "ai")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as AiLeague | null) ?? null;
}

export async function createFreeAiLeague(
  userId: string,
  teamName: string,
  selectedPersonalities: BotPersonality[]
): Promise<{ league?: AiLeague; error?: string }> {
  const supabase = await createClient();

  if (selectedPersonalities.length !== 3) {
    return { error: "Choose exactly 3 AI opponents." };
  }

  if (new Set(selectedPersonalities).size !== 3) {
    return { error: "Each AI opponent must be a different personality." };
  }

  const { count } = await supabase
    .from("leagues")
    .select("*", { count: "exact", head: true })
    .eq("owner_user_id", userId)
    .eq("league_type", "ai");

  const leagueNumber = (count ?? 0) + 1;
  const leagueName =
    leagueNumber === 1
      ? `${teamName} Free AI League`
      : `${teamName} Free AI League ${leagueNumber}`;

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .insert({
      name: leagueName,
      is_solo: false,
      league_type: "ai",
      status: "drafting",
      owner_user_id: userId,
      scoring_mode: DEFAULT_LEAGUE_SCORING_MODE,
      player_count: 4,
    })
    .select(AI_LEAGUE_FIELDS)
    .single();

  if (leagueError || !league) {
    return { error: leagueError?.message ?? "Could not create AI league" };
  }

  const leagueId = league.id;

  const { error: humanMemberError } = await supabase
    .from("league_members")
    .insert({
      league_id: leagueId,
      user_id: userId,
      display_name: teamName,
    });

  if (humanMemberError) {
    return { error: humanMemberError.message };
  }

  for (const personality of selectedPersonalities) {
    const profile = getBotProfile(personality);
    const botConfig = buildBotConfigForPersonality(personality);

    const { error: botMemberError } = await supabase
      .from("league_members")
      .insert({
        league_id: leagueId,
        user_id: profile.id,
        bot_personality: personality,
        bot_config: botConfig,
        display_name: profile.displayName,
      });

    if (botMemberError) {
      return { error: botMemberError.message };
    }

    const { error: draftError } = await supabase.from("drafts").insert({
      league_id: leagueId,
      user_id: profile.id,
    });

    if (draftError) {
      return { error: draftError.message };
    }
  }

  const { error: humanDraftError } = await supabase.from("drafts").insert({
    league_id: leagueId,
    user_id: userId,
  });

  if (humanDraftError) {
    return { error: humanDraftError.message };
  }

  const startResult = await startLiveDraft(leagueId, userId);
  if (startResult.error) {
    return {
      error: `League created but live draft failed to start: ${startResult.error}`,
    };
  }

  await supabase.from("league_standings").insert({
    league_id: leagueId,
    user_id: userId,
    wins: 0,
    losses: 0,
    current_week: 1,
  });

  for (const personality of selectedPersonalities) {
    const profile = getBotProfile(personality);
    await supabase.from("league_standings").insert({
      league_id: leagueId,
      user_id: profile.id,
      wins: 0,
      losses: 0,
      current_week: 1,
    });
  }

  return { league: league as AiLeague };
}

export async function deleteAiLeagueForUser(
  userId: string,
  leagueId: string
): Promise<{ error?: string }> {
  if (!(await verifyUserOwnsLeague(userId, leagueId))) {
    return { error: "League not found." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("leagues")
    .delete()
    .eq("id", leagueId)
    .eq("owner_user_id", userId)
    .eq("league_type", "ai");

  if (error) {
    return { error: error.message };
  }

  return {};
}

export async function activateAiLeagueSchedule(
  leagueId: string,
  humanUserId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("league_matchups")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId);

  if (count && count > 0) {
    await supabase
      .from("leagues")
      .update({ status: "active", current_week: 1 })
      .eq("id", leagueId);
    return {};
  }

  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("player_count, owner_user_id")
    .eq("id", leagueId)
    .maybeSingle();

  const ownerId = leagueRow?.owner_user_id ?? humanUserId;
  const playerCount = normalizePlayerCount(leagueRow?.player_count ?? 4);
  const teamIds = await getLeagueTeamIds(leagueId, ownerId);
  const schedule = generateRegularSeasonSchedule(teamIds);

  const rows = await Promise.all(
    schedule.map(async (game) => {
      const homeName = await getLeagueMemberTeamName(leagueId, game.homeUserId);
      const awayName = await getLeagueMemberTeamName(leagueId, game.awayUserId);
      const humanIsHome = game.homeUserId === ownerId;
      const humanIsAway = game.awayUserId === ownerId;

      return {
        league_id: leagueId,
        week_number: game.weekNumber,
        home_user_id: game.homeUserId,
        away_user_id: game.awayUserId,
        is_playoff: false,
        playoff_round: null,
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
    })
  );

  const { error: matchupError } = await supabase
    .from("league_matchups")
    .insert(rows);

  if (matchupError) {
    return { error: matchupError.message };
  }

  const { error: leagueError } = await supabase
    .from("leagues")
    .update({ status: "active", current_week: 1, player_count: playerCount })
    .eq("id", leagueId);

  if (leagueError) return { error: leagueError.message };

  await captureWeekBaselinesForLeague(leagueId, 1);

  return {};
}

export async function getAiLeagueSummary(
  userId: string,
  leagueId?: string | null
): Promise<AiLeagueSummary | null> {
  const league = leagueId
    ? await (async () => {
        const supabase = await createClient();
        const { data } = await supabase
          .from("leagues")
          .select(AI_LEAGUE_FIELDS)
          .eq("id", leagueId)
          .eq("owner_user_id", userId)
          .eq("league_type", "ai")
          .maybeSingle();
        return (data as AiLeague | null) ?? null;
      })()
    : await getLatestAiLeagueForUser(userId);
  if (!league) return null;

  const supabase = await createClient();

  const humanDraft = await loadDraftStateDetailed(userId, {
    leagueId: league.id,
  });
  const humanDraftComplete =
    humanDraft.ok && humanDraft.state.draft.status === "complete";

  const leagueBots = await getLeagueBotMembers(league.id);

  const bots = await Promise.all(
    leagueBots.map(async (bot) => {
      const state = await loadDraftStateDetailed(bot.id, {
        leagueId: league.id,
      });
      return {
        id: bot.id,
        name: bot.displayName,
        personality: bot.personality,
        draftComplete:
          state.ok && state.state.draft.status === "complete",
      };
    })
  );

  const botsComplete = bots.every((b) => b.draftComplete);

  const { data: standingsRow } = await supabase
    .from("league_standings")
    .select("wins, losses, current_week")
    .eq("league_id", league.id)
    .eq("user_id", userId)
    .maybeSingle();

  const { data: matchups } = await supabase
    .from("league_matchups")
    .select("*")
    .eq("league_id", league.id)
    .order("week_number", { ascending: true });

  const currentWeek = standingsRow?.current_week ?? 1;
  const currentMatchupRow = findHumanMatchupForWeek(
    matchups ?? [],
    userId,
    currentWeek
  );

  const lastCompletedMatchupRow =
    matchups
      ?.filter(
        (m) =>
          m.status === "complete" &&
          (m.home_user_id === userId || m.away_user_id === userId)
      )
      .sort((a, b) => b.week_number - a.week_number)[0] ?? null;

  const resolvedLeagueId = league.id;

  async function mapHumanMatchup(
    row: NonNullable<typeof currentMatchupRow>
  ) {
    const opponentId = getOpponentUserId(row, userId);
    const opponentName = opponentId
      ? await getLeagueMemberTeamName(resolvedLeagueId, opponentId)
      : (row.opponent_name ?? "Opponent");

    return {
      weekNumber: row.week_number,
      opponentName,
      opponentBotId: opponentId ?? row.opponent_bot_id ?? "",
      humanScorePct: humanScoreFromMatchup(row, userId),
      opponentScorePct: opponentScoreFromMatchup(row, userId),
      winner: legacyWinnerForHuman(row, userId),
      status: row.status,
    };
  }

  return {
    league,
    humanDraftComplete,
    botsComplete,
    standings: standingsRow
      ? {
          wins: standingsRow.wins,
          losses: standingsRow.losses,
          currentWeek: standingsRow.current_week,
        }
      : null,
    currentMatchup: currentMatchupRow
      ? await mapHumanMatchup(currentMatchupRow)
      : null,
    lastCompletedMatchup: lastCompletedMatchupRow
      ? await mapHumanMatchup(lastCompletedMatchupRow)
      : null,
    bots,
  };
}

export type BotDraftBoard = {
  id: string;
  name: string;
  personality: string;
  avatarColor: string;
  picks: DraftPick[];
  summary: DraftSummary;
  currentRound: number;
  draftComplete: boolean;
};

export async function getAiLeagueBotDraftBoards(
  userId: string,
  leagueId: string
): Promise<BotDraftBoard[] | null> {
  const supabase = await createClient();

  let resolvedLeagueId = leagueId;
  let { data: league } = await supabase
    .from("leagues")
    .select("league_type, owner_user_id")
    .eq("id", resolvedLeagueId)
    .maybeSingle();

  if (
    !league ||
    league.league_type !== "ai" ||
    league.owner_user_id !== userId
  ) {
    const latestAiLeague = await getLatestAiLeagueForUser(userId);
    if (!latestAiLeague) return null;
    resolvedLeagueId = latestAiLeague.id;
    league = {
      league_type: "ai" as const,
      owner_user_id: userId,
    };
  }

  const leagueBots = await getLeagueBotMembers(resolvedLeagueId);

  const boards = await Promise.all(
    leagueBots.map(async (bot) => {
      const state = await loadDraftStateDetailed(bot.id, {
        leagueId: resolvedLeagueId,
      });
      if (!state.ok) {
        return {
          id: bot.id,
          name: bot.displayName,
          personality: bot.personality,
          avatarColor: bot.avatarColor,
          picks: [] as DraftPick[],
          summary: summarizePicks([]),
          currentRound: 1,
          draftComplete: false,
        };
      }

      return {
        id: bot.id,
        name: bot.displayName,
        personality: bot.personality,
        avatarColor: bot.avatarColor,
        picks: state.state.picks,
        summary: state.state.summary,
        currentRound: state.state.draft.current_round,
        draftComplete: state.state.draft.status === "complete",
      };
    })
  );

  return boards;
}
