/**
 * Live read-only check of src/lib/pricing/read.ts against the real price log.
 * Run: npx --yes tsx scripts/test-price-read.ts
 */
import {
  getAnchors,
  getAnchor,
  getLatestPrices,
  getAnchorHistory,
} from "../src/lib/pricing/read";

function line(label: string, value: unknown) {
  console.log(`  ${label}: ${String(value)}`);
}

async function main() {
  const date = process.argv[2] ?? "2026-08-29";

  // 1. A real batch of anchors, including a symbol that cannot exist.
  const symbols = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "ZZZZFAKE"];
  console.log(`\n[1] getAnchors(${symbols.length} symbols, ${date}, close)`);
  const close = await getAnchors(symbols, date, "close");
  for (const [sym, hit] of close.hits) {
    line(sym, `$${hit.price} src=${hit.source} asOf=${hit.asOf.toISOString()} hi=${hit.dayHigh} lo=${hit.dayLow}`);
  }
  for (const [sym, miss] of close.misses) {
    line(sym, `MISS reason=${miss.reason} detail=${miss.detail}`);
  }
  line("complete", close.complete);

  // 2. The chunking path: more symbols than SYMBOL_CHUNK (150).
  const many = Array.from({ length: 400 }, (_, i) => `SYM${i}`);
  many[0] = "AAPL";
  many[399] = "MSFT";
  console.log(`\n[2] getAnchors(400 symbols -> forces 3 chunks)`);
  const big = await getAnchors(many, date, "close");
  line("hits", big.hits.size);
  line("misses", big.misses.size);
  line("hits+misses === requested", big.hits.size + big.misses.size === 400);
  line("AAPL present", big.hits.has("AAPL"));

  // 3. Single anchor, and a guaranteed-absent one.
  console.log(`\n[3] getAnchor single`);
  const one = await getAnchor("AAPL", date, "close");
  line("AAPL", one ? `$${one.price}` : "null");
  const none = await getAnchor("ZZZZFAKE", date, "close");
  line("ZZZZFAKE", none === null ? "null (correct — no substitute price)" : `WRONG: ${JSON.stringify(none)}`);

  // 4. Latest prices (live view).
  console.log(`\n[4] getLatestPrices`);
  const latest = await getLatestPrices(["AAPL", "BTC", "ETH", "ZZZZFAKE"]);
  for (const [sym, hit] of latest.hits) line(sym, `$${hit.price} src=${hit.source}`);
  for (const [sym, miss] of latest.misses) line(sym, `MISS ${miss.reason}`);

  // 5. History across a range.
  console.log(`\n[5] getAnchorHistory 2026-08-25..${date}`);
  const hist = await getAnchorHistory(["AAPL", "MSFT", "NVDA"], "2026-08-25", date, "close");
  line("keys", hist.size);
  for (const [key, hit] of [...hist].slice(0, 6)) line(key, `$${hit.price}`);

  // 6. Nothing anywhere returned a zero or a negative.
  console.log(`\n[6] invariant: no zero/negative prices returned`);
  const all = [...close.hits.values(), ...big.hits.values(), ...latest.hits.values(), ...hist.values()];
  const bad = all.filter((h) => !(h.price > 0));
  line("prices checked", all.length);
  line("zero-or-negative", bad.length === 0 ? "0 (correct)" : `${bad.length} — FAIL`);
  if (bad.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exitCode = 1;
});
