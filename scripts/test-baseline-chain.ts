/** Tests the chaining invariant. Pure — no database. */
import { planPeriodOpenBaselines } from "../src/lib/scoring/baseline-chain";
import { computePeriodGain } from "../src/lib/scoring/portfolio";

let fails = 0;
const check = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) fails++; };
const near = (a: number, b: number) => Math.abs(a - b) < 0.0001;

const pick = (id: string, symbol: string, shares: number) => ({ id, symbol, shares });
const P = [pick("p1", "AAPL", 100), pick("p2", "MSFT", 50)];

console.log("\n[1] a prior close carries forward VERBATIM");
// Position closed yesterday at $32,000. Today AAPL trades at $319.70.
const carried = planPeriodOpenBaselines(
  [pick("p1", "AAPL", 100)],
  new Map([["p1", 32000]]),
  new Map([["AAPL", 319.70]])
);
check("written, not held", carried.write.length === 1 && carried.held.length === 0);
check("open = 32,000 (the prior close)", near(carried.write[0].openValue, 32000), String(carried.write[0].openValue));
check("source is prior-close", carried.write[0].from === "prior-close");
check("NOT 319.70 (per-share mistaken for a position)", carried.write[0].openValue !== 319.70);
check("NOT 31,970 (re-quoted, losing the gap)", carried.write[0].openValue !== 31970);

console.log("\n[2] THE POINT: the overnight gap lands in this period, not nowhere");
// Closed yesterday at 100/share = 10,000. Gapped up overnight, now 104 = 10,400.
const gapped = planPeriodOpenBaselines([pick("p1", "X", 100)], new Map([["p1", 10000]]), new Map([["X", 104]]));
const chainedOpen = gapped.write[0].openValue;
const chainedGain = computePeriodGain({ openValue: chainedOpen, closeValue: 10400 });
const requotedGain = computePeriodGain({ openValue: 10400, closeValue: 10400 });
check("chained open is 10,000", near(chainedOpen, 10000));
check("player is credited the $400 gap", near(chainedGain.dollarGain, 400), `$${chainedGain.dollarGain}`);
check("re-quoting would have credited $0", near(requotedGain.dollarGain, 0));
check("that is a 4% swing that would have vanished", near(chainedGain.percentGain, 4), `${chainedGain.percentGain}%`);

console.log("\n[3] first baseline of a season: a real quote, converted per share");
const seeded = planPeriodOpenBaselines([pick("p1", "AAPL", 100)], new Map(), new Map([["AAPL", 319.70]]));
check("open = 100 x 319.70 = 31,970", near(seeded.write[0].openValue, 31970), String(seeded.write[0].openValue));
check("source is quote", seeded.write[0].from === "quote");

console.log("\n[4] no prior close AND no quote -> HELD, never fabricated");
const stuck = planPeriodOpenBaselines(P, new Map(), new Map());
check("nothing written", stuck.write.length === 0);
check("both held", stuck.held.length === 2);
check("reason is honest", stuck.held[0].reason === "no-prior-close-and-no-quote");

console.log("\n[5] a stored ZERO for a real position is a failed capture, not a value");
const poisoned = planPeriodOpenBaselines([pick("p1", "AAPL", 100)], new Map([["p1", 0]]), new Map([["AAPL", 319.70]]));
check("held, not carried", poisoned.held.length === 1 && poisoned.write.length === 0);
check("reason untrustworthy", poisoned.held[0].reason === "untrustworthy-value");

console.log("\n[6] genuinely empty slots really are zero");
const empty = planPeriodOpenBaselines(
  [pick("p9", "__OPEN__", 0), pick("p10", "SOLD", 0)],
  new Map(), new Map()
);
check("both written at 0", empty.write.length === 2 && empty.write.every((w) => w.openValue === 0));
check("none held", empty.held.length === 0);

console.log("\n[7] the chain holds across many periods (a week of gaps)");
let open = 10000;
const closes = [10200, 10150, 10600, 10450, 10900];
for (const close of closes) {
  const plan = planPeriodOpenBaselines([pick("p1", "X", 100)], new Map([["p1", open]]), new Map([["X", 999]]));
  open = close; // this period's close becomes the next period's open
  check(`day open chained, ignoring the live quote`, plan.write[0].openValue !== 999 * 100);
}
check("sum of chained days === endpoint move (10,000 -> 10,900)", near(10900 - 10000, 900));

console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} FAILURE(S)`}`);
process.exitCode = fails ? 1 : 0;
