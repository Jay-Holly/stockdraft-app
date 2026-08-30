/** Tests the two-source corroboration rule. Pure — no database. */
import { verifyAnchor, VERIFY_TOLERANCE_PCT } from "../src/lib/pricing/verify";

let fails = 0;
const check = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) fails++; };

console.log("\n[1] real measured case: AAPL close, Finnhub vs Alpaca IEX");
const aapl = verifyAnchor(319.70, 319.58);
check("status ok", aapl.status === "ok");
check("diff ~ -0.038%", Math.abs((aapl.diffPct ?? 0) + 0.0375) < 0.01, String(aapl.diffPct?.toFixed(4)));
check("no third source needed", aapl.needsThirdSource === false);

console.log("\n[2] the worst measured case: CAT, 58c on $800");
const cat = verifyAnchor(800.25, 799.67);
check("still inside tolerance", cat.status === "ok", `${cat.diffPct?.toFixed(4)}%`);

console.log("\n[3] a real miss: ETH close ~8% out (the kind the old audit caught)");
const eth = verifyAnchor(2452.72, 2650.00);
check("status divergent", eth.status === "divergent", `${eth.diffPct?.toFixed(2)}%`);
check("needs a third source", eth.needsThirdSource === true);

console.log("\n[4] exactly at tolerance is agreement, just past it is not");
check(`${VERIFY_TOLERANCE_PCT}% exactly -> ok`, verifyAnchor(100, 103).status === "ok");
check("3.01% -> divergent", verifyAnchor(100, 103.01).status === "divergent");
check("negative side too", verifyAnchor(100, 96.99).status === "divergent");

console.log("\n[5] only one source answered -> single-sourced, NOT verified");
const solo = verifyAnchor(319.70, null);
check("status unverified", solo.status === "unverified");
check("queued for a third source", solo.needsThirdSource === true);
check("no fabricated diff", solo.diffPct === null);

console.log("\n[6] primary came from a fallback -> recorded as recovered");
const rec = verifyAnchor(319.70, null, true);
check("status recovered", rec.status === "recovered");
check("still queued", rec.needsThirdSource === true);

console.log("\n[7] junk never reads as agreement");
for (const [label, v] of [["zero", 0], ["negative", -10], ["NaN", NaN]] as const) {
  const r = verifyAnchor(319.70, v as number);
  check(`secondary ${label} -> unverified, not ok`, r.status === "unverified", r.status);
}
check("primary missing -> unverified + queued", verifyAnchor(null, 319.58).needsThirdSource === true);

console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} FAILURE(S)`}`);
process.exitCode = fails ? 1 : 0;
