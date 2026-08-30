/** The synchronous draft screen, against the real log. Read-only. */
import { primeDraftPriceScreen, screenPrice, screenQuote, screenSymbols } from "../src/lib/draft/price-screen";
import { isStockPickEligible } from "../src/lib/draft/engine";

let fails = 0;
const check = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) fails++; };

async function main() {
  console.log("\n[1] before priming, the screen is empty (this is the bug's shape)");
  check("screenPrice(AAPL) is 0 before priming", screenPrice("AAPL") === 0);
  check("and AAPL is therefore INELIGIBLE", isStockPickEligible("AAPL", screenPrice("AAPL")) === false);

  console.log("\n[2] prime it from the price log");
  const t0 = Date.now();
  const n = await primeDraftPriceScreen();
  console.log(`  primed ${n} symbols in ${Date.now() - t0}ms`);
  check("screen holds the pool", n > 400, String(n));

  console.log("\n[3] synchronous lookups now return real prices");
  for (const s of ["AAPL", "MSFT", "NVDA", "AZO"]) {
    const p = screenPrice(s);
    console.log(`    ${s.padEnd(6)} $${p}`);
    check(`${s} priced and eligible`, p > 0 && isStockPickEligible(s, p));
  }

  console.log("\n[4] how many of the pool would a bot find eligible?");
  const syms = screenSymbols();
  const eligible = syms.filter((s) => isStockPickEligible(s, screenPrice(s)));
  console.log(`  ${eligible.length} of ${syms.length} screened symbols are draftable`);
  check("a bot has plenty to choose from", eligible.length > 400, String(eligible.length));

  console.log("\n[5] an unknown symbol screens at 0, never invented");
  check("ZZZFAKE is 0", screenPrice("ZZZFAKE") === 0);
  check("and has no quote", screenQuote("ZZZFAKE") === null);

  console.log("\n[6] second prime is served from cache (fast enough for a live clock)");
  const t1 = Date.now();
  await primeDraftPriceScreen();
  const ms = Date.now() - t1;
  console.log(`  cached prime took ${ms}ms`);
  check("cached prime is instant", ms < 50, `${ms}ms`);

  console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} FAILURE(S)`}`);
  process.exitCode = fails ? 1 : 0;
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });
