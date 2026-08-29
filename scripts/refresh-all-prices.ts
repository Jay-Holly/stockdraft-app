/**
 * Brings every symbol in the shared price sheet current, through the new
 * pricing module. Paced at 50 calls/minute, so ~11 minutes for the full pool.
 *
 * Temporary operational script.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { getPrices, Freshness } from "@/lib/pricing";

const BATCH = 25;

async function main() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("stock_prices")
    .select("symbol")
    .limit(5000);

  if (error) throw new Error(error.message);

  const symbols = (data ?? []).map((r) => String(r.symbol).toUpperCase());
  console.log(`refreshing ${symbols.length} symbols, ${BATCH} at a time\n`);

  let ok = 0;
  const failures: string[] = [];
  const started = Date.now();

  for (let i = 0; i < symbols.length; i += BATCH) {
    const slice = symbols.slice(i, i + BATCH);

    // maxAge 0 forces a live fetch for every symbol regardless of what the
    // sheet already holds — this is a deliberate full refresh, not a top-up.
    const book = await getPrices(slice, {
      maxAge: 0,
      maxLiveFetch: BATCH,
      budgetMs: 120_000,
    });

    ok += book.resolvedCount;
    for (const gap of book.missing()) failures.push(`${gap.symbol} (${gap.reason})`);

    const done = Math.min(i + BATCH, symbols.length);
    const mins = ((Date.now() - started) / 60_000).toFixed(1);
    console.log(`  ${done}/${symbols.length}  ok=${ok}  failed=${failures.length}  ${mins}m`);
  }

  console.log(`\ndone in ${((Date.now() - started) / 60_000).toFixed(1)} minutes`);
  console.log(`refreshed: ${ok}/${symbols.length}`);
  if (failures.length > 0) {
    console.log(`could not price ${failures.length}:`);
    console.log("  " + failures.join("\n  "));
  }
}

main().catch((err) => {
  console.error("REFRESH FAILED:", err);
  process.exit(1);
});
