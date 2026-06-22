export type LeagueFormatType = "standard" | "sports_league";
export type LeagueVisibility = "private" | "public";
export type LeagueOpponentType = "all_ai" | "all_human" | "mixed";
export type LeaguePlayerCount = 2 | 4 | 6 | 8 | 10 | 12;

export const STANDARD_PLAYER_COUNTS: LeaguePlayerCount[] = [
  2, 4, 6, 8, 10, 12,
];

export const SPORTS_LEAGUE_FORMATS = [
  { id: "sdfl", label: "SDFL", description: "StockDraft Football League" },
  { id: "sdhl", label: "SDHL", description: "StockDraft Hockey League" },
  { id: "sdba", label: "SDBA", description: "StockDraft Basketball Association" },
  { id: "sdlb", label: "SDLB", description: "StockDraft League Baseball" },
] as const;

export type CreateLeagueConfig = {
  formatType: LeagueFormatType;
  sportsLeagueId?: string;
  playerCount: LeaguePlayerCount;
  visibility: LeagueVisibility;
  opponentType: LeagueOpponentType;
  leagueName: string;
  teamName: string;
  inviteEmail?: string;
};

/** Only the 2-player private all-human standard path is fully supported today. */
export function isHumanLeaguePoCSupported(config: CreateLeagueConfig): boolean {
  return (
    config.formatType === "standard" &&
    config.playerCount === 2 &&
    config.visibility === "private" &&
    config.opponentType === "all_human"
  );
}

export function unsupportedLeagueConfigMessage(config: CreateLeagueConfig): string {
  if (config.formatType === "sports_league") {
    return "Sports League formats (SDFL, SDHL, SDBA, SDLB) are coming soon.";
  }
  if (config.playerCount !== 2) {
    return `${config.playerCount}-player leagues are coming soon. For now, choose 2 players.`;
  }
  if (config.visibility === "public") {
    return "Public enrollment is coming soon. Choose Private for now.";
  }
  if (config.opponentType !== "all_human") {
    return "AI and Mixed opponent leagues are coming soon. Choose All Human for now.";
  }
  return "This league configuration is not available yet.";
}
