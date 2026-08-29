/**
 * Live read-only check that every league's quote entry point now reads the
 * price log and never a provider.
 * Run: npx --yes tsx scripts/test-quotes-from-log.ts
 */
import {
  fetchStockQuotes,
  getStockQuote,
  getCryptoQuote,
  getSymbolQuote,
  getCryptoQuotesMap,
  getLastCryptoQuoteSource,
  getQuotesForSymbols,
} from "../src/lib/roster/quotes";

const p = (label: string, v: unknown) => console.log(`  ${label}: ${String(v)}`);

async function main() {
  console.log("\n[1] fetchStockQuotes — real batch + one impossible symbol");
  const m = await fetchStockQuotes(["AAPL", "MSFT", "NVDA", "ZZZZFAKE"]);
  for (const [s, q] of m) p(s, `$${q.price} (${q.changePercent.toFixed(2)}%)`);
  p("ZZZZFAKE in map", m.has("ZZZZFAKE") ? "PRESENT — WRONG" : "absent (correct)");

  console.log("\n[2] single-symbol lookups");
  p("getStockQuote(AAPL)", JSON.stringify(await getStockQuote("AAPL")));
  p("getCryptoQuote(BTC)", JSON.stringify(await getCryptoQuote("BTC")));
  p("getSymbolQuote(ETH)", JSON.stringify(await getSymbolQuote("ETH")));
  const gone = await getStockQuote("ZZZZFAKE");
  p("getStockQuote(ZZZZFAKE)", `${JSON.stringify(gone)} -> price<=0 guard catches it: ${gone.price <= 0}`);

  console.log("\n[3] getCryptoQuotesMap — the whole pool, cold (no warm-up)");
  const cm = await getCryptoQuotesMap();
  const keys = Object.keys(cm);
  p("coins priced", keys.length);
  p("source recorded", getLastCryptoQuoteSource());
  for (const k of keys.slice(0, 5)) p(k, `$${cm[k].price}`);
  p("all prices > 0", keys.every((k) => cm[k].price > 0) ? "yes (correct)" : "NO — FAIL");

  console.log("\n[4] mixed roster in one round trip");
  const mixed = await getQuotesForSymbols(["AAPL", "BTC", "TSLA", "ETH"]);
  for (const [s, q] of mixed) p(s, `$${q.price}`);

  console.log("\n[5] invariant: nothing returned a zero price as if it were real");
  const all = [...m.values(), ...mixed.values(), ...Object.values(cm)];
  const zeros = all.filter((q) => !(q.price > 0));
  p("quotes returned", all.length);
  p("zero-priced entries", zeros.length === 0 ? "0 (correct)" : `${zeros.length} — FAIL`);
  if (zeros.length > 0) process.exitCode = 1;
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });
