/**
 * Live check of write-on-change and the failure-can't-blank-a-price rule.
 * Uses a deliberately fake symbol so no real market data is touched.
 */
import { writeObservations, startSweep, finishSweep, findRunningSweep } from "../src/lib/pricing/log-store";
import { getLatestPrices } from "../src/lib/pricing/read";

const SYM = "ZZ.SELFTEST";
let fails = 0;
const check = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) fails++; };
const p = (l: string, v: unknown) => console.log(`  ${l}: ${String(v)}`);

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const sweepId = await startSweep({ kind: "sample", assetClass: "stock", symbolsRequested: 1, triggeredBy: "manual" });
  p("test sweep", sweepId);

  const base = {
    symbol: SYM, assetClass: "stock" as const, kind: "sample" as const,
    sessionDate: today, source: "alpaca" as const, sweepId,
  };
  const priced = (price: number) => ({ ...base, price, dayHigh: price + 1, dayLow: price - 1, asOf: new Date() });

  console.log("\n[1] first observation -> written");
  const a = await writeObservations([priced(100)]);
  p("result", JSON.stringify(a));
  check("written === 1", a.written === 1);

  console.log("\n[2] identical observation -> SKIPPED, nothing stored");
  const b = await writeObservations([priced(100)]);
  p("result", JSON.stringify(b));
  check("written === 0", b.written === 0);
  check("skipped === 1", b.skipped === 1);

  console.log("\n[3] a changed price -> written");
  const c = await writeObservations([priced(101)]);
  p("result", JSON.stringify(c));
  check("written === 1", c.written === 1);

  console.log("\n[4] a failure -> ALWAYS written, never skipped");
  const d = await writeObservations([{ ...base, failureReason: "provider-error" as const }]);
  p("result", JSON.stringify(d));
  check("written === 1", d.written === 1);
  const d2 = await writeObservations([{ ...base, failureReason: "provider-error" as const }]);
  check("a repeat failure is still written", d2.written === 1);

  console.log("\n[5] THE REGRESSION: a failure must not blank the good price");
  const look = await getLatestPrices([SYM]);
  const hit = look.hits.get(SYM);
  check("still reads as a real price", !!hit, hit ? `$${hit.price}` : "MISSING — a blip erased it");
  check("and it is the newest price (101), not the older 100", hit?.price === 101, String(hit?.price));

  console.log("\n[6] overlap guard sees the in-flight sweep");
  const running = await findRunningSweep(300_000);
  check("finds a running sweep", running?.id === sweepId, `got ${running?.id}`);

  await finishSweep(sweepId, { ok: 2, failed: 2, apiCalls: 0, error: "self-test sweep (write-on-change); ZZ.SELFTEST rows are synthetic" });
  const after = await findRunningSweep(300_000);
  check("guard clears once the sweep finishes", after === null);

  console.log("\n[7] real symbols still read correctly");
  const real = await getLatestPrices(["AAPL", "BTC"]);
  for (const [s, h] of real.hits) p(s, `$${h.price}`);
  check("AAPL and BTC both priced", real.hits.size === 2);

  console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} FAILURE(S)`}`);
  process.exitCode = fails ? 1 : 0;
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });
