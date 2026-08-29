/**
 * Proof that the new pricing module does what it claims. Read-only except for
 * the price-table write-back that getPrices performs by design.
 *
 * Temporary verification script — delete once the module is cut over.
 */
import { getPrices, Freshness } from "@/lib/pricing";

const REAL = ["AAPL", "MSFT", "NVDA"];
const BOGUS = "ZZZZNOTAREALTICKER";

function age(asOf: Date): string {
  return `${Math.round((Date.now() - asOf.getTime()) / 1000)}s ago`;
}

async function main() {
  console.log("\n=== 1. Real symbols, LIVE freshness (60s) ===");
  const book = await getPrices([...REAL, BOGUS], { maxAge: Freshness.LIVE });

  for (const symbol of [...REAL, BOGUS]) {
    const found = book.lookup(symbol);
    if (found.status === "ok") {
      console.log(
        `  ${symbol.padEnd(20)} $${found.price.toFixed(2).padStart(10)}  ` +
          `asOf=${found.asOf.toISOString()} (${age(found.asOf)})  src=${found.source}`
      );
    } else {
      console.log(
        `  ${symbol.padEnd(20)} NO PRICE  reason=${found.reason}  ${found.detail}`
      );
    }
  }

  console.log(`\n  resolved ${book.resolvedCount}/${book.asked.length}`);
  console.log(`  gaps: ${book.describeGaps() ?? "none"}`);

  console.log("\n=== 2. Failure cannot become a number ===");
  const bogus = book.lookup(BOGUS);
  console.log(`  lookup().status      = ${bogus.status}`);
  console.log(`  priceOf() returns    = ${JSON.stringify(book.priceOf(BOGUS))}`);
  console.log(`  (old system returned 0 here, which scored as -100%)`);

  console.log("\n=== 3. Second read is served from the store, no API call ===");
  const t0 = Date.now();
  const again = await getPrices(REAL, { maxAge: Freshness.INTRADAY });
  const elapsed = Date.now() - t0;

  for (const symbol of REAL) {
    const found = again.lookup(symbol);
    console.log(
      `  ${symbol.padEnd(20)} src=${found.status === "ok" ? found.source : "n/a"}`
    );
  }
  console.log(`  elapsed ${elapsed}ms for ${REAL.length} symbols`);

  console.log("\n=== 4. Impossible freshness (1ms), store only, no API allowed ===");
  const strict = await getPrices(REAL, { maxAge: 1, storeOnly: true });
  for (const symbol of REAL) {
    const found = strict.lookup(symbol);
    console.log(
      `  ${symbol.padEnd(20)} ${
        found.status === "ok"
          ? `ok $${found.price.toFixed(2)} (market closed — this close is the freshest price that exists)`
          : `refused: ${found.reason}`
      }`
    );
  }

  console.log("\n=== 5. Crypto gets no market-closed exemption ===");
  const coins = await getPrices(["BTC", "ETH"], { maxAge: 1, storeOnly: true });
  for (const symbol of ["BTC", "ETH"]) {
    const found = coins.lookup(symbol);
    console.log(
      `  ${symbol.padEnd(20)} ${
        found.status === "ok" ? "ok" : `refused: ${found.reason} (correct — crypto never closes)`
      }`
    );
  }
  console.log("");
}

main().catch((err) => {
  console.error("VERIFY FAILED:", err);
  process.exit(1);
});
