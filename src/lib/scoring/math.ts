/**
 * Canonical score computation — pure math, no side effects, safe to call from anywhere.
 */

export function computeScorePercent(
  closingValue: number,
  openingValue: number
): number {
  if (openingValue <= 0) return 0;
  return ((closingValue - openingValue) / openingValue) * 100;
}

export function computeRosterScorePercent(
  picks: Array<{
    openValue: number;
    closeValue: number;
  }>
): number {
  let openTotal = 0;
  let closeTotal = 0;

  for (const pick of picks) {
    if (pick.openValue && pick.closeValue != null) {
      openTotal += pick.openValue;
      closeTotal += pick.closeValue;
    }
  }

  return computeScorePercent(closeTotal, openTotal);
}
