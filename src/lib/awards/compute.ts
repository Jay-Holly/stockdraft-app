import {
  AWARD_AMOUNTS,
  AWARD_KEYS,
  LOTTERY_HIT_MIN_GAIN_PCT,
  SWEEP_STARTER_COUNT,
} from "@/lib/awards/constants";
import { isLotteryTierSymbol } from "@/lib/awards/lottery-tier";
import {
  filterPickType,
  groupMetricsByUser,
  recoverySwing,
  sumDollarGain,
  teamScoringWeekGainPercent,
} from "@/lib/awards/metrics";
import type { AwardPickMetric, AwardWinnerCandidate, ComputedAward } from "@/lib/awards/types";

function pickMaxCandidate(
  candidates: AwardWinnerCandidate[]
): AwardWinnerCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, current) => {
    if (current.score > best.score) return current;
    if (current.score < best.score) return best;
    return current.userId < best.userId ? current : best;
  });
}

function pickMinCandidate(
  candidates: AwardWinnerCandidate[]
): AwardWinnerCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, current) => {
    if (current.score < best.score) return current;
    if (current.score > best.score) return best;
    return current.userId < best.userId ? current : best;
  });
}

function computeWinnerOfWeek(
  byUser: Map<string, AwardPickMetric[]>
): ComputedAward {
  const candidates: AwardWinnerCandidate[] = [];

  for (const [userId, picks] of byUser) {
    const scoring = filterPickType(picks, ["stock", "crypto"]);
    const total = sumDollarGain(scoring);
    candidates.push({
      userId,
      score: total,
      detail: { totalWeekDollarGain: total },
    });
  }

  const winner = pickMaxCandidate(candidates);
  return {
    awardKey: "winner_of_week",
    amountUsd: AWARD_AMOUNTS.winner_of_week,
    winner,
    noWinnerReason: winner ? undefined : "No roster data for the week",
  };
}

function computeRookieOfWeek(metrics: AwardPickMetric[]): ComputedAward {
  const candidates: AwardWinnerCandidate[] = filterPickType(metrics, [
    "stock",
  ])
    .filter((pick) => pick.valueAtOpen > 0)
    .map((pick) => ({
      userId: pick.userId,
      pickId: pick.pickId,
      symbol: pick.symbol,
      score: pick.weekGainPct,
      detail: {
        weekGainPct: pick.weekGainPct,
        weekDollarGain: pick.weekDollarGain,
      },
    }));

  const winner = pickMaxCandidate(candidates);
  return {
    awardKey: "rookie_of_week",
    amountUsd: AWARD_AMOUNTS.rookie_of_week,
    winner,
    noWinnerReason: winner ? undefined : "No qualifying starter stock gains",
  };
}

function computeDiamondHands(metrics: AwardPickMetric[]): ComputedAward {
  const candidates: AwardWinnerCandidate[] = [];

  for (const pick of filterPickType(metrics, ["stock"])) {
    if (pick.valueAtClose <= pick.valueAtOpen) continue;
    const swing = recoverySwing(pick);
    if (swing <= 0) continue;

    candidates.push({
      userId: pick.userId,
      pickId: pick.pickId,
      symbol: pick.symbol,
      score: swing,
      detail: {
        recoverySwing: swing,
        lowestCapturedValue:
          pick.valueAtClose - swing,
        weekGainPct: pick.weekGainPct,
        finishedGreen: true,
      },
    });
  }

  const winner = pickMaxCandidate(candidates);
  return {
    awardKey: "diamond_hands",
    amountUsd: AWARD_AMOUNTS.diamond_hands,
    winner,
    noWinnerReason: winner
      ? undefined
      : "No starter recovered from an intra-week dip to finish green",
  };
}

function computeLotteryHit(metrics: AwardPickMetric[]): ComputedAward {
  const candidates: AwardWinnerCandidate[] = filterPickType(metrics, ["stock"])
    .filter(
      (pick) =>
        pick.valueAtOpen > 0 &&
        isLotteryTierSymbol(pick.symbol) &&
        pick.weekGainPct >= LOTTERY_HIT_MIN_GAIN_PCT
    )
    .map((pick) => ({
      userId: pick.userId,
      pickId: pick.pickId,
      symbol: pick.symbol,
      score: pick.weekGainPct,
      detail: {
        weekGainPct: pick.weekGainPct,
        lotteryTier: true,
      },
    }));

  const winner = pickMaxCandidate(candidates);
  return {
    awardKey: "lottery_hit",
    amountUsd: AWARD_AMOUNTS.lottery_hit,
    winner,
    noWinnerReason: winner
      ? undefined
      : "No lottery-tier starter gained 10%+ this week",
  };
}

function computeSweepWeek(
  byUser: Map<string, AwardPickMetric[]>
): ComputedAward {
  const candidates: AwardWinnerCandidate[] = [];

  for (const [userId, picks] of byUser) {
    const starters = filterPickType(picks, ["stock"]);
    if (starters.length < SWEEP_STARTER_COUNT) continue;
    if (!starters.every((pick) => pick.weekDollarGain > 0)) continue;

    const totalStarterGain = sumDollarGain(starters);
    candidates.push({
      userId,
      score: totalStarterGain,
      detail: {
        starterCount: starters.length,
        totalStarterGain,
      },
    });
  }

  const winner = pickMaxCandidate(candidates);
  return {
    awardKey: "sweep_week",
    amountUsd: AWARD_AMOUNTS.sweep_week,
    winner,
    noWinnerReason: winner
      ? undefined
      : "No team had all 10 starters finish green",
  };
}

function computeLoserOfWeek(
  byUser: Map<string, AwardPickMetric[]>
): ComputedAward {
  const candidates: AwardWinnerCandidate[] = [];

  for (const [userId, picks] of byUser) {
    const teamPct = teamScoringWeekGainPercent(picks);
    candidates.push({
      userId,
      score: teamPct,
      detail: { teamWeekGainPct: teamPct },
    });
  }

  const winner = pickMinCandidate(candidates);
  return {
    awardKey: "loser_of_week",
    amountUsd: AWARD_AMOUNTS.loser_of_week,
    winner,
    noWinnerReason: winner ? undefined : "No roster data for the week",
  };
}

function computeBenchCurse(
  byUser: Map<string, AwardPickMetric[]>
): ComputedAward {
  const candidates: AwardWinnerCandidate[] = [];

  for (const [userId, picks] of byUser) {
    const starters = filterPickType(picks, ["stock"]);
    const bench = filterPickType(picks, ["bench"]).filter(
      (pick) => pick.valueAtOpen > 0
    );
    if (bench.length === 0 || starters.length === 0) continue;

    const starterGain = sumDollarGain(starters);
    const benchGain = sumDollarGain(bench);
    if (benchGain <= starterGain) continue;

    candidates.push({
      userId,
      score: benchGain - starterGain,
      detail: {
        starterGain,
        benchGain,
        margin: benchGain - starterGain,
      },
    });
  }

  const winner = pickMaxCandidate(candidates);
  return {
    awardKey: "bench_curse",
    amountUsd: AWARD_AMOUNTS.bench_curse,
    winner,
    noWinnerReason: winner
      ? undefined
      : "No team had bench outgain starters this week",
  };
}

export function computeWeeklyAwards(
  metrics: AwardPickMetric[]
): ComputedAward[] {
  const byUser = groupMetricsByUser(metrics);

  return AWARD_KEYS.map((awardKey) => {
    switch (awardKey) {
      case "winner_of_week":
        return computeWinnerOfWeek(byUser);
      case "rookie_of_week":
        return computeRookieOfWeek(metrics);
      case "diamond_hands":
        return computeDiamondHands(metrics);
      case "lottery_hit":
        return computeLotteryHit(metrics);
      case "sweep_week":
        return computeSweepWeek(byUser);
      case "loser_of_week":
        return computeLoserOfWeek(byUser);
      case "bench_curse":
        return computeBenchCurse(byUser);
      default:
        return {
          awardKey,
          amountUsd: AWARD_AMOUNTS[awardKey],
          winner: null,
          noWinnerReason: "Unknown award",
        };
    }
  });
}
