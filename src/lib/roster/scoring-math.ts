import { computeScorePercent } from "@/lib/scoring/math";

export function computeWeekDollarGain(
  currentValue: number,
  valueAtOpen: number
): number {
  return currentValue - valueAtOpen;
}

export function computeWeekGainPercent(
  currentValue: number,
  valueAtOpen: number
): number {
  return computeScorePercent(currentValue, valueAtOpen);
}

export function computeScoringWeekGainPercent(
  scoringPicks: Array<{ currentValue: number; weekOpenValue: number }>
): number {
  let openTotal = 0;
  let currentTotal = 0;

  for (const pick of scoringPicks) {
    openTotal += pick.weekOpenValue;
    currentTotal += pick.currentValue;
  }

  return computeScorePercent(currentTotal, openTotal);
}
