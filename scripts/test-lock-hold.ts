/** Tests the real production lock decision. Pure function, no database. */
import { planContestLock } from "../src/lib/dfs/lock-plan";
import { isUsableQuote } from "../src/lib/market/quote-guards";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const picks = [
  { id: "p1", symbol: "AAPL" },
  { id: "p2", symbol: "MSFT" },
  { id: "p3", symbol: "AAPL" },
  { id: "p4", symbol: "BTC" },
];

console.log("\n[0] the guard underneath is real, not a stub");
check("isUsableQuote(319.7) is true", isUsableQuote(319.7) === true, `got ${isUsableQuote(319.7)}`);
check("isUsableQuote(0) is false", isUsableQuote(0) === false);
check("isUsableQuote(undefined) is false", isUsableQuote(undefined as unknown as number) === false);

console.log("\n[1] every price present -> LOCK");
const a = planContestLock(picks, { AAPL: 319.7, MSFT: 513.67, BTC: 78039 });
check("decision is lock", a.decision === "lock");
if (a.decision === "lock") {
  check("3 distinct prices grouped", a.picksByPrice.size === 3, `got ${a.picksByPrice.size}`);
  check("both AAPL picks share one group", (a.picksByPrice.get(319.7) ?? []).length === 2);
}

console.log("\n[2] ONE symbol missing -> HOLD (the partial-lock case)");
const b = planContestLock(picks, { AAPL: 319.7, MSFT: 513.67 });
check("decision is hold", b.decision === "hold");
if (b.decision === "hold") check("names the missing symbol", b.missingSymbols.join(",") === "BTC", b.missingSymbols.join(","));

console.log("\n[3] NOTHING priced -> HOLD (today's real state: no open anchors)");
const c = planContestLock(picks, {});
check("decision is hold", c.decision === "hold");
if (c.decision === "hold") check("lists all 3 distinct symbols", c.missingSymbols.join(",") === "AAPL,BTC,MSFT", c.missingSymbols.join(","));

console.log("\n[4] a zero price is NOT a price -> HOLD");
const d = planContestLock(picks, { AAPL: 319.7, MSFT: 513.67, BTC: 0 });
check("decision is hold", d.decision === "hold");

console.log("\n[5] junk values -> HOLD, never grouped as a real price");
for (const [label, v] of [["negative", -5], ["NaN", NaN], ["Infinity", Infinity]] as const) {
  const r = planContestLock(picks, { AAPL: 319.7, MSFT: 513.67, BTC: v as number });
  check(`${label} holds`, r.decision === "hold");
}

console.log("\n[6] contest with no picks -> LOCK (nothing to price)");
const e = planContestLock([], {});
check("decision is lock", e.decision === "lock");

console.log("\n[7] case-insensitive symbols still resolve");
const f = planContestLock([{ id: "p1", symbol: "aapl" }], { AAPL: 319.7 });
check("lowercase pick matches uppercase price", f.decision === "lock");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;
