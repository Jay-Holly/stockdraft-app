/**
 * Unit checks for crypto rebalance baseline math.
 * Run: npx --yes tsx scripts/test-crypto-rebalance-baselines.ts
 */
import {
  addBudgetToBaselineValues,
  initialBaselineValues,
  scaleBaselineValuesForPartialSell,
} from "../src/lib/roster/baseline-rebalance";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok:", message);
}

{
  const scaled = scaleBaselineValuesForPartialSell(100_000, 100_000, 0.25);
  assert(scaled.valueAtOpen === 75_000, "source open scaled to 75k after 25% sell");
  assert(scaled.valueAtClose === 75_000, "source close scaled to 75k after 25% sell");
}

{
  const scaled = scaleBaselineValuesForPartialSell(100_000, null, 0.25);
  assert(scaled.valueAtOpen === 75_000, "source open scaled when close null");
  assert(scaled.valueAtClose === null, "source close stays null when unset");
}

{
  const target = addBudgetToBaselineValues(50_000, 50_000, 25_000);
  assert(target.valueAtOpen === 75_000, "target open increases by sold budget");
  assert(target.valueAtClose === 75_000, "target close increases by sold budget");
}

{
  const initial = initialBaselineValues(25_000);
  assert(initial.valueAtOpen === 25_000, "new target open equals buy budget");
  assert(initial.valueAtClose === 25_000, "new target close equals buy budget");
}

console.log("\nCrypto rebalance baseline checks passed.");
