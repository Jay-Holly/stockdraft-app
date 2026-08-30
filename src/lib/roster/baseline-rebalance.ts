/**
 * Pure helpers for mid-week crypto rebalance baseline adjustments.
 */

export function scaleBaselineValuesForPartialSell(
  valueAtOpen: number,
  valueAtClose: number | null,
  sellFraction: number
): { valueAtOpen: number; valueAtClose: number | null } {
  const retain = Math.max(0, 1 - sellFraction);
  const nextOpen = Math.max(0, valueAtOpen * retain);
  if (valueAtClose == null) {
    return { valueAtOpen: nextOpen, valueAtClose: null };
  }
  return {
    valueAtOpen: nextOpen,
    valueAtClose: Math.max(0, valueAtClose * retain),
  };
}

export function addBudgetToBaselineValues(
  valueAtOpen: number,
  valueAtClose: number | null,
  addedBudget: number
): { valueAtOpen: number; valueAtClose: number | null } {
  const nextOpen = valueAtOpen + addedBudget;
  if (valueAtClose == null) {
    return { valueAtOpen: nextOpen, valueAtClose: null };
  }
  return {
    valueAtOpen: nextOpen,
    valueAtClose: valueAtClose + addedBudget,
  };
}

export function initialBaselineValues(
  budget: number
): { valueAtOpen: number; valueAtClose: number | null } {
  return { valueAtOpen: budget, valueAtClose: budget };
}
