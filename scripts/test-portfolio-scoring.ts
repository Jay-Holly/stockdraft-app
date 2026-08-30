/** Tests the roster valuation and gain rules. Pure — no database. */
import { valueRoster, computePeriodGain } from "../src/lib/scoring/portfolio";

let fails = 0;
const check = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) fails++; };
const near = (a: number, b: number) => Math.abs(a - b) < 0.0001;

const roster = [
  { id: "p1", symbol: "AAPL", shares: 10 },
  { id: "p2", symbol: "MSFT", shares: 5 },
  { id: "p3", symbol: "BTC", shares: 0.5 },
];

console.log("\n[1] every price present -> value");
const v = valueRoster(roster, { AAPL: 100, MSFT: 200, BTC: 1000 });
check("decision is value", v.decision === "value");
if (v.decision === "value") check("total = 1000 + 1000 + 500 = 2500", near(v.total, 2500), String(v.total));

console.log("\n[2] ONE price missing -> HOLD, not a partial total");
const h = valueRoster(roster, { AAPL: 100, MSFT: 200 });
check("decision is hold", h.decision === "hold");
if (h.decision === "hold") check("names BTC", h.missingSymbols.join(",") === "BTC", h.missingSymbols.join(","));

console.log("\n[3] a zero price is missing, not worthless");
const z = valueRoster(roster, { AAPL: 100, MSFT: 200, BTC: 0 });
check("decision is hold", z.decision === "hold");

console.log("\n[4] zero SHARES is a real quantity -> valued at 0, not held");
const zs = valueRoster([{ id: "p9", symbol: "SOLD", shares: 0 }], {});
check("decision is value", zs.decision === "value");
if (zs.decision === "value") check("total is 0", zs.total === 0);

console.log("\n[5] per-manager cost basis: same coin, different buyers");
// Two managers each spent $10,000 on BTC. The 4th buyer paid a 15% surcharge,
// so bought fewer shares. At the same price, they must NOT score the same.
const first = valueRoster([{ id: "a", symbol: "BTC", shares: 10000 / 1000 }], { BTC: 1100 });
const fourth = valueRoster([{ id: "b", symbol: "BTC", shares: 10000 / 1150 }], { BTC: 1100 });
if (first.decision === "value" && fourth.decision === "value") {
  check("first buyer worth more", first.total > fourth.total, `${first.total.toFixed(2)} vs ${fourth.total.toFixed(2)}`);
  check("first buyer up", near(first.total, 11000), first.total.toFixed(2));
  check("fourth buyer down (paid the surcharge)", fourth.total < 10000, fourth.total.toFixed(2));
}

console.log("\n[6] THE DEPOSIT TRAP — money in is not performance");
// Starts at 100,000. Receives an 8,636 award. Ends at 115,000.
const g = computePeriodGain({ openValue: 100000, closeValue: 115000, moneyIn: 8636 });
check("naive answer would have been +15,000", near(115000 - 100000, 15000));
check("real dollar gain is 6,364", near(g.dollarGain, 6364), String(g.dollarGain));
check("percent is off capital at work (108,636)", near(g.percentGain, (6364 / 108636) * 100), g.percentGain.toFixed(4));
check("deposit reported separately", g.moneyIn === 8636);

console.log("\n[7] a deposit alone is never a gain");
const idle = computePeriodGain({ openValue: 100000, closeValue: 108636, moneyIn: 8636 });
check("gained nothing, traded nothing", near(idle.dollarGain, 0), String(idle.dollarGain));
check("0%", near(idle.percentGain, 0));

console.log("\n[8] a manager who received nothing and earned the same ranks ahead");
const earned = computePeriodGain({ openValue: 100000, closeValue: 106364 });
check("same dollars earned", near(earned.dollarGain, 6364));
check("higher percent than the funded manager", earned.percentGain > g.percentGain,
  `${earned.percentGain.toFixed(3)}% vs ${g.percentGain.toFixed(3)}%`);

console.log("\n[9] no capital at work -> 0%, never Infinity or NaN");
const empty = computePeriodGain({ openValue: 0, closeValue: 0 });
check("percent is 0", empty.percentGain === 0);
check("finite", Number.isFinite(empty.percentGain));

console.log("\n[10] a real loss is still reported as a loss");
const loss = computePeriodGain({ openValue: 100000, closeValue: 92000 });
check("dollar gain negative", near(loss.dollarGain, -8000));
check("percent negative", loss.percentGain < 0, loss.percentGain.toFixed(2));

console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} FAILURE(S)`}`);
process.exitCode = fails ? 1 : 0;
