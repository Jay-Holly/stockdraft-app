export function computeScoringWeekGainPercent(
  scoringPicks: Array<{ currentValue: number; weekOpenValue: number }>
): number {
  let openTotal = 0;
  let currentTotal = 0;

  for (const pick of scoringPicks) {
    openTotal += pick.weekOpenValue;
    currentTotal += pick.currentValue;
  }

  if (openTotal <= 0) return 0;
  return ((currentTotal - openTotal) / openTotal) * 100;
}
