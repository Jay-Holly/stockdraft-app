import type { DraftPick } from "@/lib/draft/types";

export type RosterPickView = DraftPick & {
  acquired_via?: string;
  currentPrice: number;
  changePercent: number;
  currentValue: number;
  gainPercent: number;
  weekOpenValue: number;
  weekDollarGain: number;
  scores: boolean;
};

export type RosterView = {
  leagueId: string;
  leagueStatus: string;
  currentWeek: number;
  starters: RosterPickView[];
  bench: RosterPickView[];
  crypto: RosterPickView[];
  /** Season-to-date % on scoring picks (legacy label). */
  scoringGainPercent: number;
  /** Weekly % on starters + crypto — matchup scoring metric. */
  scoringWeekGainPercent: number;
  /** Weekly $ gain across all roster slots (Winner of the Week). */
  totalWeekDollarGain: number;
};

export type LeagueTeamStanding = {
  userId: string;
  teamName: string;
  isHuman: boolean;
  isBot: boolean;
  avatarColor: string | null;
  wins: number;
  losses: number;
  seasonGainPercent: number;
};

export type MatchupLiveView = {
  weekNumber: number;
  opponentName: string;
  opponentBotId: string;
  status: string;
  humanGainPercent: number;
  opponentGainPercent: number;
  winner: string | null;
  humanScored: number | null;
  opponentScored: number | null;
};

export type LeaguePageData = {
  leagueId: string;
  leagueName: string;
  leagueStatus: string;
  currentWeek: number;
  humanRecord: { wins: number; losses: number };
  standings: LeagueTeamStanding[];
  currentMatchup: MatchupLiveView | null;
};

export type FreeAgentStock = {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePercent: number;
};

export type FreeAgentsPageData = {
  leagueId: string;
  freeAgents: FreeAgentStock[];
  benchSlots: Array<{ pickId: string; symbol: string }>;
};
