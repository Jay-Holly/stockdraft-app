/** Proves stock anchors can only be written on real trading days. Pure. */
import { isUsTradingDay, isUsMarketOpen } from "../src/lib/market/hours";

let fails = 0;
const check = (name: string, cond: boolean, got = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${got ? ` — ${got}` : ""}`);
  if (!cond) fails++;
};

// All times UTC. August 2026 is EDT (UTC-4).
const cases: [string, string, boolean][] = [
  ["Fri 2026-08-28 13:30Z (9:30 AM ET Friday)", "2026-08-28T13:30:00Z", true],
  ["Sat 2026-08-29 13:30Z (9:30 AM ET Saturday)", "2026-08-29T13:30:00Z", false],
  ["Sat 2026-08-29 20:00Z (4:00 PM ET Saturday)", "2026-08-29T20:00:00Z", false],
  ["Sun 2026-08-30 20:00Z (4:00 PM ET Sunday)", "2026-08-30T20:00:00Z", false],
  ["Mon 2026-08-31 12:00Z (8:00 AM ET Monday, pre-market)", "2026-08-31T12:00:00Z", true],
  // The timezone trap: UTC says Saturday, New York still says Friday evening.
  ["Sat 2026-08-29 00:30Z (Fri 8:30 PM ET)", "2026-08-29T00:30:00Z", true],
  // And the reverse: UTC says Monday, New York is still Sunday night.
  ["Mon 2026-08-31 03:00Z (Sun 11:00 PM ET)", "2026-08-31T03:00:00Z", false],
];

console.log("\n[1] isUsTradingDay");
for (const [label, iso, expected] of cases) {
  const got = isUsTradingDay(new Date(iso));
  check(label, got === expected, `expected ${expected}, got ${got}`);
}

console.log("\n[2] the exact bug: Saturday used to satisfy the close-anchor rule");
const sat = new Date("2026-08-29T20:00:00Z");
check("old rule (!marketOpen) would have written a close", isUsMarketOpen(sat) === false);
check("new rule refuses — not a trading day", isUsTradingDay(sat) === false);

console.log("\n[3] the dangerous one: Monday 8 AM pre-market");
const preMkt = new Date("2026-08-31T12:00:00Z");
check("old rule (!marketOpen) would have written Monday's close at 8 AM", isUsMarketOpen(preMkt) === false);
check("it IS a trading day, so the day-guard alone wouldn't stop it", isUsTradingDay(preMkt) === true);
console.log("      -> which is why the new rule ALSO requires 15:55 ET or later.");

console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} FAILURE(S)`}`);
process.exitCode = fails ? 1 : 0;
