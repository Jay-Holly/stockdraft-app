export type LeagueMatchupRow = {
  id: string;
  league_id: string;
  week_number: number;
  /** Multi-asset sports-sim leagues only (sdba/sdhl/sdlb) — the real game's date. Null everywhere else. */
  game_date: string | null;
  /** MLB doubleheaders: 2 for the nightcap sharing a game_date, otherwise 1. */
  game_number: number;
  opponent_bot_id: string | null;
  opponent_name: string | null;
  human_score_pct: number | null;
  opponent_score_pct: number | null;
  winner: string | null;
  status: string;
  home_user_id: string | null;
  away_user_id: string | null;
  home_score: number | null;
  away_score: number | null;
  winner_user_id: string | null;
  is_playoff: boolean;
  playoff_round: string | null;
};

export function getOpponentUserId(
  matchup: Pick<LeagueMatchupRow, "home_user_id" | "away_user_id">,
  userId: string
): string | null {
  if (matchup.home_user_id === userId) return matchup.away_user_id;
  if (matchup.away_user_id === userId) return matchup.home_user_id;
  return null;
}

export function findHumanMatchupForWeek(
  matchups: LeagueMatchupRow[],
  userId: string,
  weekNumber: number
): LeagueMatchupRow | null {
  return (
    matchups.find(
      (matchup) =>
        matchup.week_number === weekNumber &&
        (matchup.home_user_id === userId || matchup.away_user_id === userId)
    ) ?? null
  );
}

/**
 * Multi-asset sports-sim leagues (sdba/sdhl/sdlb) can have several of the
 * viewer's games in one calendar week — use this instead of
 * findHumanMatchupForWeek wherever every game in the week must be shown, not
 * just the first one found.
 */
export function findHumanMatchupsForWeek(
  matchups: LeagueMatchupRow[],
  userId: string,
  weekNumber: number
): LeagueMatchupRow[] {
  return matchups.filter(
    (matchup) =>
      matchup.week_number === weekNumber &&
      (matchup.home_user_id === userId || matchup.away_user_id === userId)
  );
}

/**
 * Multi-asset sports-sim leagues only — "today's" game for a user, since a
 * calendar week can hold several of their games and week-level lookup would
 * pick an arbitrary one. dateIso must be a "YYYY-MM-DD" string (see
 * getNyDateString in @/lib/market/hours).
 *
 * A doubleheader is just two games on the same date, game_number 1 then 2 —
 * nothing special about it. Sorting by game_number and preferring whichever
 * game isn't complete yet naturally shows the opener first, then flips to
 * the nightcap once it's decided, same as any other sequence of games.
 */
export function findHumanMatchupForDate(
  matchups: LeagueMatchupRow[],
  userId: string,
  dateIso: string
): LeagueMatchupRow | null {
  const todaysGames = matchups
    .filter(
      (matchup) =>
        matchup.game_date === dateIso &&
        (matchup.home_user_id === userId || matchup.away_user_id === userId)
    )
    .sort((a, b) => a.game_number - b.game_number);

  return (
    todaysGames.find((matchup) => matchup.status !== "complete") ??
    todaysGames[todaysGames.length - 1] ??
    null
  );
}

export function legacyWinnerForHuman(
  matchup: LeagueMatchupRow,
  humanUserId: string
): "human" | "opponent" | "tie" | null {
  if (!matchup.winner_user_id) {
    if (matchup.status === "complete") return "tie";
    return null;
  }
  if (matchup.winner_user_id === humanUserId) return "human";
  if (
    matchup.home_user_id === humanUserId ||
    matchup.away_user_id === humanUserId
  ) {
    return "opponent";
  }
  return null;
}

export function humanScoreFromMatchup(
  matchup: LeagueMatchupRow,
  humanUserId: string
): number | null {
  if (matchup.home_user_id === humanUserId) {
    return matchup.home_score ?? matchup.human_score_pct;
  }
  if (matchup.away_user_id === humanUserId) {
    return matchup.away_score ?? matchup.opponent_score_pct;
  }
  return matchup.human_score_pct;
}

export function opponentScoreFromMatchup(
  matchup: LeagueMatchupRow,
  humanUserId: string
): number | null {
  if (matchup.home_user_id === humanUserId) {
    return matchup.away_score ?? matchup.opponent_score_pct;
  }
  if (matchup.away_user_id === humanUserId) {
    return matchup.home_score ?? matchup.human_score_pct;
  }
  return matchup.opponent_score_pct;
}
