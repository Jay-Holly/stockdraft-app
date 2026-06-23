import { createClient } from "@/lib/supabase/server";
import { BOT_BY_ID } from "@/lib/league/bots";
import { getLeagueMemberTeamName } from "@/lib/league/server";
import { parseLeagueScoringMode } from "@/lib/league/scoring-mode";
import {
  clampViewWeek,
  getSeasonWeekContext,
} from "@/lib/league/season-weeks";
import { shouldStealthBots } from "@/lib/league/stealth-bots";
import type { LeagueMatchupRow } from "@/lib/matchup/types";
import { findHumanMatchupForWeek } from "@/lib/matchup/types";
import { loadRosterView, requireSeasonLeague } from "@/lib/roster/server";
import {
  computeTeamGainStats,
  getPrimaryMatchupScore,
  resolveMatchupLeader,
  type TeamGainStats,
} from "@/lib/roster/team-stats";
import type { RosterPickView } from "@/lib/roster/types";
import type { LeagueScoringMode } from "@/lib/league/scoring-mode";

export type MatchupTeamSide = {
  userId: string;
  teamName: string;
  isViewer: boolean;
  isBot: boolean;
  avatarColor: string;
  stats: TeamGainStats;
  primaryScore: number;
  starters: RosterPickView[];
  crypto: RosterPickView[];
  bench: RosterPickView[];
};

export type MatchupPreview = {
  id: string;
  weekNumber: number;
  status: string;
  isPlayoff: boolean;
  playoffRound: string | null;
  homeTeamName: string;
  awayTeamName: string;
  homePrimaryScore: number;
  awayPrimaryScore: number;
  leader: "home" | "away" | "tie" | null;
  includesViewer: boolean;
};

export type MatchupDetail = MatchupPreview & {
  home: MatchupTeamSide;
  away: MatchupTeamSide;
};

export type MatchupsPageData = {
  leagueId: string;
  leagueName: string;
  currentWeek: number;
  viewWeek: number;
  isHistorical: boolean;
  availableWeeks: number[];
  maxViewableWeek: number;
  scoringMode: LeagueScoringMode;
  viewerUserId: string;
  myMatchupId: string | null;
  matchups: MatchupDetail[];
};

async function loadTeamSide(
  leagueId: string,
  userId: string,
  viewerUserId: string,
  weekNumber: number
): Promise<MatchupTeamSide | null> {
  const rosterResult = await loadRosterView(userId, leagueId, { weekNumber });
  if (!rosterResult.ok) return null;

  const { roster } = rosterResult;
  const allPicks = [...roster.starters, ...roster.crypto, ...roster.bench];
  const stats = computeTeamGainStats(allPicks);
  const botProfile = BOT_BY_ID.get(userId);

  const supabase = await createClient();
  const [{ data: profile }, { data: leagueMeta }] = await Promise.all([
    supabase
      .from("profiles")
      .select("avatar_color")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("leagues")
      .select("league_type, visibility, opponent_type")
      .eq("id", leagueId)
      .maybeSingle(),
  ]);

  const stealthBots =
    leagueMeta &&
    shouldStealthBots({
      leagueType: leagueMeta.league_type,
      visibility: leagueMeta.visibility as "private" | "public",
      opponentType: leagueMeta.opponent_type as "all_ai" | "all_human" | "mixed",
    });

  return {
    userId,
    teamName: await getLeagueMemberTeamName(leagueId, userId),
    isViewer: userId === viewerUserId,
    isBot: Boolean(botProfile) && leagueMeta?.league_type === "ai" && !stealthBots,
    avatarColor: profile?.avatar_color ?? botProfile?.avatarColor ?? "blue",
    stats,
    primaryScore: getPrimaryMatchupScore(stats, roster.scoringMode),
    starters: roster.starters,
    crypto: roster.crypto,
    bench: roster.bench,
  };
}

async function buildMatchupDetail(
  matchup: LeagueMatchupRow,
  leagueId: string,
  scoringMode: LeagueScoringMode,
  viewerUserId: string,
  weekNumber: number
): Promise<MatchupDetail | null> {
  if (!matchup.home_user_id || !matchup.away_user_id) return null;

  const [home, away] = await Promise.all([
    loadTeamSide(leagueId, matchup.home_user_id, viewerUserId, weekNumber),
    loadTeamSide(leagueId, matchup.away_user_id, viewerUserId, weekNumber),
  ]);

  if (!home || !away) return null;

  const homePrimaryScore =
    matchup.status === "complete" && matchup.home_score != null
      ? Number(matchup.home_score)
      : home.primaryScore;
  const awayPrimaryScore =
    matchup.status === "complete" && matchup.away_score != null
      ? Number(matchup.away_score)
      : away.primaryScore;

  const leader = resolveMatchupLeader(
    home.stats,
    away.stats,
    scoringMode,
    matchup.winner_user_id,
    matchup.home_user_id,
    matchup.away_user_id,
    matchup.status
  );

  return {
    id: matchup.id,
    weekNumber: matchup.week_number,
    status: matchup.status,
    isPlayoff: matchup.is_playoff,
    playoffRound: matchup.playoff_round,
    homeTeamName: home.teamName,
    awayTeamName: away.teamName,
    homePrimaryScore,
    awayPrimaryScore,
    leader,
    includesViewer:
      matchup.home_user_id === viewerUserId ||
      matchup.away_user_id === viewerUserId,
    home,
    away,
  };
}

export async function loadMatchupsPageData(
  userId: string,
  options?: { weekNumber?: number }
): Promise<{ ok: true; data: MatchupsPageData } | { ok: false; error: string }> {
  const season = await requireSeasonLeague(userId);
  if ("error" in season) return { ok: false, error: season.error };

  const { league } = season;
  const supabase = await createClient();
  const scoringMode = parseLeagueScoringMode(league.scoring_mode);
  const weekContext = await getSeasonWeekContext(league.id, userId);
  const viewWeek = clampViewWeek(
    options?.weekNumber ?? weekContext.currentWeek,
    weekContext.maxViewableWeek
  );
  const isHistorical = viewWeek < weekContext.currentWeek;

  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("name")
    .eq("id", league.id)
    .maybeSingle();

  const { data: weekMatchups } = await supabase
    .from("league_matchups")
    .select("*")
    .eq("league_id", league.id)
    .eq("week_number", viewWeek)
    .not("home_user_id", "is", null)
    .not("away_user_id", "is", null)
    .order("created_at", { ascending: true });

  if (!weekMatchups?.length) {
    return {
      ok: false,
      error: `No matchups scheduled for week ${viewWeek}.`,
    };
  }

  const myMatchup = findHumanMatchupForWeek(
    weekMatchups as LeagueMatchupRow[],
    userId,
    viewWeek
  );

  const details = (
    await Promise.all(
      weekMatchups.map((row) =>
        buildMatchupDetail(
          row as LeagueMatchupRow,
          league.id,
          scoringMode,
          userId,
          viewWeek
        )
      )
    )
  ).filter((detail): detail is MatchupDetail => detail !== null);

  if (details.length === 0) {
    return { ok: false, error: "Could not load matchup rosters." };
  }

  details.sort((a, b) => {
    if (a.includesViewer && !b.includesViewer) return -1;
    if (!a.includesViewer && b.includesViewer) return 1;
    return a.homeTeamName.localeCompare(b.homeTeamName);
  });

  return {
    ok: true,
    data: {
      leagueId: league.id,
      leagueName: leagueRow?.name ?? league.name,
      currentWeek: weekContext.currentWeek,
      viewWeek,
      isHistorical,
      availableWeeks: weekContext.availableWeeks,
      maxViewableWeek: weekContext.maxViewableWeek,
      scoringMode,
      viewerUserId: userId,
      myMatchupId: myMatchup?.id ?? null,
      matchups: details,
    },
  };
}
