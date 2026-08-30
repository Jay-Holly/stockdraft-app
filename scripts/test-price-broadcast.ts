/** Proves the broadcast endpoint actually accepts a push. */
import { broadcastPriceChanges } from "../src/lib/pricing/broadcast";

async function main() {
  console.log("\n[1] pushing two synthetic ticks");
  const ok = await broadcastPriceChanges([
    { symbol: "ZZ.SELFTEST", price: 101, changePercent: 1 },
    { symbol: "ZZ.SELFTEST2", price: 202, changePercent: -0.5 },
  ]);
  console.log(`  accepted by Supabase: ${ok}`);

  console.log("\n[2] empty push is a no-op, never an error");
  console.log(`  result: ${await broadcastPriceChanges([])}`);

  process.exitCode = ok ? 0 : 1;
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });
