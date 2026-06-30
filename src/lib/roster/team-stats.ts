import type { LeagueScoringMode } from "@/lib/league/scoring-mode";
import type { RosterPickView } from "@/lib/roster/types";
import { computeScoringWeekGainPercent } from "@/lib/roster/scoring-math";

export type TeamGainStats = {
  weekDollarGain: number;
  weekGainPercent: number;
  seasonDollarGain: number;
  seasonGainPercent: number;
};

export type OrderedGainStat = {
  key: string;
  label: string;
  value: number;
  format: "money" | "pct";
};

export function computeTeamGainStats(picks: RosterPickView[]): TeamGainStats {
  const scoring = picks.filter(
    (pick) => pick.pick_type === "stock" || pick.pick_type === "crypto"
  );

  const weekInputs = scoring.map((pick) => ({
    currentValue: pick.currentValue,
    weekOpenValue: pick.weekOpenValue,
  }));

  const seasonInputs = scoring.map((pick) => ({
    currentValue: pick.currentValue,
    weekOpenValue: pick.seasonOpenValue,
  }));

  return {
    weekDollarGain: scoring.reduce((sum, pick) => sum + pick.weekDollarGain, 0),
    weekGainPercent: computeScoringWeekGainPercent(weekInputs),
    seasonDollarGain: scoring.reduce(
      (sum, pick) => sum + pick.seasonDollarGain,
      0
    ),
    seasonGainPercent: computeScoringWeekGainPercent(seasonInputs),
  };
}

export function getPrimaryMatchupScore(
  stats: TeamGainStats,
  scoringMode: LeagueScoringMode
): number {
  return scoringMode === "dollar_gain"
    ? stats.weekDollarGain
    : stats.weekGainPercent;
}

export function getOrderedGainStats(
  stats: TeamGainStats,
  scoringMode: LeagueScoringMode
): OrderedGainStat[] {
  const byKey: Record<string, OrderedGainStat> = {
    weekDollar: {
      key: "weekDollar",
      label: "Weekly $",
      value: stats.weekDollarGain,
      format: "money",
    },
    weekPct: {
      key: "weekPct",
      label: "Weekly %",
      value: stats.weekGainPercent,
      format: "pct",
    },
    seasonDollar: {
      key: "seasonDollar",
      label: "Season $",
      value: stats.seasonDollarGain,
      format: "money",
    },
    seasonPct: {
      key: "seasonPct",
      label: "Season %",
      value: stats.seasonGainPercent,
      format: "pct",
    },
  };

  const order =
    scoringMode === "dollar_gain"
      ? (["weekDollar", "weekPct", "seasonDollar", "seasonPct"] as const)
      : (["weekPct", "weekDollar", "seasonPct", "seasonDollar"] as const);

  return order.map((key) => byKey[key]);
}

export function getOrderedPickGainStats(
  pick: RosterPickView,
  scoringMode: LeagueScoringMode
): OrderedGainStat[] {
  return getOrderedGainStats(
    {
      weekDollarGain: pick.weekDollarGain,
      weekGainPercent: pick.weekGainPercent,
      seasonDollarGain: pick.seasonDollarGain,
      seasonGainPercent: pick.gainPercent,
    },
    scoringMode
  );
}

export function resolveMatchupLeader(
  home: TeamGainStats,
  away: TeamGainStats,
  scoringMode: LeagueScoringMode,
  winnerUserId: string | null,
  homeUserId: string,
  awayUserId: string,
  status: string
): "home" | "away" | "tie" | null {
  if (status === "complete") {
    if (!winnerUserId) return "tie";
    if (winnerUserId === homeUserId) return "home";
    if (winnerUserId === awayUserId) return "away";
  }

  const homePrimary = getPrimaryMatchupScore(home, scoringMode);
  const awayPrimary = getPrimaryMatchupScore(away, scoringMode);
  const epsilon = scoringMode === "dollar_gain" ? 0.01 : 0.0001;

  if (Math.abs(homePrimary - awayPrimary) < epsilon) return "tie";
  return homePrimary > awayPrimary ? "home" : "away";
}
