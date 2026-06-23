import type { LeagueOpponentType, LeagueVisibility } from "@/lib/league/league-config";

/** Hide bot identity in human/public leagues filled with synthetic managers. */
export function shouldStealthBots(options: {
  leagueType: string;
  visibility: LeagueVisibility;
  opponentType: LeagueOpponentType;
}): boolean {
  if (options.leagueType !== "human") return false;
  if (options.visibility === "public") return true;
  return options.opponentType !== "all_human";
}

export function managerRoleLabel(stealth: boolean): string {
  return stealth ? "Manager" : "AI manager";
}

export function opponentBoardSubtitle(
  personality: string | undefined,
  stealth: boolean
): string | undefined {
  if (stealth || personality === "human") return "Manager";
  if (personality === "analyst") return "Highest market-cap each round";
  if (personality === "gambler") return "Lower-cap picks outside Top 100";
  if (personality === "crypto_king") return "Full $200K BTC early, then mid-cap stocks";
  return undefined;
}
