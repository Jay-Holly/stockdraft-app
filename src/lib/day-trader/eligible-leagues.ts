import { listAiLeagueListItems } from "@/lib/league/ai-league";
import { listHumanLeaguesForUser } from "@/lib/league/human-league";
import { loadLeagueStockStarters } from "@/lib/day-trader/starters";

export type DayTraderEligibleLeague = {
  leagueId: string;
  leagueName: string;
  leagueType: "ai" | "human";
  teamName: string;
  starters: Array<{ symbol: string; pickOrder: number }>;
};

export async function listDayTraderEligibleLeagues(
  userId: string
): Promise<DayTraderEligibleLeague[]> {
  const [aiLeagues, humanLeagues] = await Promise.all([
    listAiLeagueListItems(userId),
    listHumanLeaguesForUser(userId),
  ]);

  const candidates: Array<{
    leagueId: string;
    leagueName: string;
    leagueType: "ai" | "human";
    teamName: string;
    draftComplete: boolean;
  }> = [
    ...aiLeagues
      .filter((item) => item.humanDraftComplete)
      .map((item) => ({
        leagueId: item.league.id,
        leagueName: item.league.name,
        leagueType: "ai" as const,
        teamName: item.humanTeamName,
        draftComplete: item.humanDraftComplete,
      })),
    ...humanLeagues
      .filter((item) => item.humanDraftComplete)
      .map((item) => ({
        leagueId: item.league.id,
        leagueName: item.league.name,
        leagueType: "human" as const,
        teamName: item.humanTeamName,
        draftComplete: item.humanDraftComplete,
      })),
  ];

  const eligible: DayTraderEligibleLeague[] = [];

  for (const candidate of candidates) {
    const starters = await loadLeagueStockStarters(userId, candidate.leagueId);
    if (!starters.ok) continue;

    eligible.push({
      leagueId: candidate.leagueId,
      leagueName: candidate.leagueName,
      leagueType: candidate.leagueType,
      teamName: candidate.teamName,
      starters: starters.picks.map((pick) => ({
        symbol: pick.symbol,
        pickOrder: pick.pickOrder,
      })),
    });
  }

  return eligible.sort((a, b) => a.leagueName.localeCompare(b.leagueName));
}
