import type { DraftPick, CryptoBuyerCounts } from "@/lib/draft/types";
import type { LeagueScoringMode } from "@/lib/league/scoring-mode";
import type { SeasonCalendarState } from "@/lib/season/types";

import type { IrResolutionState } from "@/lib/sim/types";

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
  seasonOpenValue: number;
  scores: boolean;
  /** Sports-sim starters only: whether this pick is IR-eligible this week. */
  irEligible?: boolean;
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
  ir: RosterPickView[];
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
  /** Sports-sim only: stale IR stocks blocking other roster moves. */
  irResolution?: IrResolutionState;
  /** Sports-sim only: whether this league supports IR mechanics. */
  sportsSimIrEnabled?: boolean;
  calendar?: SeasonCalendarState;
};

export type LeagueTeamStanding = {
  userId: string;
  teamName: string;
  isHuman: boolean;
  isBot: boolean;
  isViewer: boolean;
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
  isLeagueOwner: boolean;
  scoringMode: LeagueScoringMode;
  currentWeek: number;
  humanRecord: { wins: number; losses: number };
  standings: LeagueTeamStanding[];
  currentMatchup: MatchupLiveView | null;
  bonusPool: {
    awardsEnabled: boolean;
    weeklyPoolAmount: number;
    rolloverBalance: number;
    playoffPoolBalance: number;
    totalBonusPool: number;
    pendingClaimTotalUsd: number;
    pendingClaimCount: number;
  };
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
  /** Sports-sim open active slots (from IR moves). */
  openActiveSlots?: Array<{ pickId: string; symbol: string; isOpen?: boolean }>;
  calendar?: SeasonCalendarState;
};
