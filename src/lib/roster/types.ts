import type { DraftPick, CryptoBuyerCounts } from "@/lib/draft/types";
import type { LeagueScoringMode } from "@/lib/league/scoring-mode";

export type RosterPickView = DraftPick & {
  acquired_via?: string;
  currentPrice: number;
  changePercent: number;
  currentValue: number;
  gainPercent: number;
  weekOpenValue: number;
  weekDollarGain: number;
  weekGainPercent: number;
  seasonDollarGain: number;
  scores: boolean;
};

export type RosterView = {
  leagueId: string;
  leagueStatus: string;
  scoringMode: LeagueScoringMode;
  currentWeek: number;
  viewWeek: number;
  isHistorical: boolean;
  availableWeeks: number[];
  maxViewableWeek: number;
  starters: RosterPickView[];
  bench: RosterPickView[];
  crypto: RosterPickView[];
  cryptoBuyerCounts: CryptoBuyerCounts;
  cryptoQuotes: Record<string, { price: number; changePercent: number }>;
  /** Season-to-date % on scoring picks (legacy label). */
  scoringGainPercent: number;
  /** Weekly % on starters + crypto — matchup scoring metric in % Gain Mode. */
  scoringWeekGainPercent: number;
  /** Weekly $ on starters + crypto — matchup scoring metric in $ Gain Mode. */
  scoringWeekDollarGain: number;
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
  scoringMode: LeagueScoringMode;
  humanGainPercent: number;
  opponentGainPercent: number;
  humanWeeklyScore: number;
  opponentWeeklyScore: number;
  winner: string | null;
  humanScored: number | null;
  opponentScored: number | null;
};

export type LeaguePageData = {
  leagueId: string;
  leagueSupportCode: string;
  leagueName: string;
  leagueStatus: string;
  scoringMode: LeagueScoringMode;
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
  benchSlots: Array<{ pickId: string; symbol: string; isOpen?: boolean }>;
};
