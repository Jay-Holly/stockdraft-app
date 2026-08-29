/**
 * PLACEHOLDER — not a rebuild. See leaderboard.ts and portfolio-value.ts in
 * src/lib/day-trader/ for the full explanation. Only consumer is the
 * standalone test script scripts/test-crypto-rebalance-baselines.ts — no
 * real app code imports this.
 *
 * Every export throws: this is baseline math feeding real scoring, exactly
 * the kind of business number this whole rebuild exists to stop faking.
 * Return types are real (matching what the test script expects), even
 * though the bodies never produce a value — that's what lets the test
 * script typecheck against a true shape instead of `unknown` or `any`.
 */

export type BaselineValues = {
  valueAtOpen: number | null;
  valueAtClose: number | null;
};

function notImplemented(name: string): Error {
  return new Error(
    `${name}: not implemented — deleted in the scoring-rebuild branch cleanup ` +
    `(2026-08-27), not yet rebuilt. See SCORING_REBUILD_HANDOFF_2026-08-29.md.`
  );
}

export function initialBaselineValues(budget: number): BaselineValues {
  throw notImplemented("initialBaselineValues");
}

export function addBudgetToBaselineValues(
  currentOpen: number,
  currentClose: number | null,
  budgetAdded: number
): BaselineValues {
  throw notImplemented("addBudgetToBaselineValues");
}

export function scaleBaselineValuesForPartialSell(
  valueAtOpen: number,
  valueAtClose: number | null,
  keepFraction: number
): BaselineValues {
  throw notImplemented("scaleBaselineValuesForPartialSell");
}
