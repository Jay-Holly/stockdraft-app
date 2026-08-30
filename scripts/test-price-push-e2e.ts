/**
 * End-to-end: subscribe the way a browser does, then push the way the logger
 * does, and confirm the message actually arrives.
 */
import { createClient } from "@supabase/supabase-js";
import { broadcastPriceChanges } from "../src/lib/pricing/broadcast";
import { PRICE_CHANNEL } from "../src/lib/pricing/price-channel";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !anon) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");

  // Exactly what the browser hook uses: the public anon key, not the service key.
  const supabase = createClient(url, anon, { realtime: { params: { eventsPerSecond: 10 } } });

  const received: unknown[] = [];
  const channel = supabase.channel(PRICE_CHANNEL);

  const subscribed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("subscribe timed out after 15s")), 15000);
    channel
      .on("broadcast", { event: "prices" }, (msg) => { received.push(msg.payload); })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
        if (status === "CHANNEL_ERROR") { clearTimeout(timer); reject(new Error("channel error")); }
      });
  });

  console.log("\n[1] subscribing as a browser would (anon key)");
  await subscribed;
  console.log("  PASS  subscribed to", PRICE_CHANNEL);

  console.log("\n[2] logger pushes two changed symbols");
  const sent = await broadcastPriceChanges([
    { symbol: "AAPL", price: 319.7, changePercent: 1.63 },
    { symbol: "BTC", price: 78039, changePercent: 0.41 },
  ]);
  console.log("  PASS  push accepted:", sent);

  console.log("\n[3] waiting for delivery...");
  const deadline = Date.now() + 10000;
  while (received.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }

  if (received.length === 0) {
    console.log("  FAIL  nothing arrived within 10s");
    process.exitCode = 1;
  } else {
    console.log("  PASS  received:", JSON.stringify(received[0]));
    const p = received[0] as { ticks?: { symbol: string }[] };
    const symbols = (p.ticks ?? []).map((t) => t.symbol).join(",");
    console.log(`  PASS  carried symbols: ${symbols}`);
    console.log(symbols === "AAPL,BTC" ? "\nEND-TO-END PUSH WORKS" : "\nMISMATCH");
    if (symbols !== "AAPL,BTC") process.exitCode = 1;
  }

  await supabase.removeChannel(channel);
  process.exit(process.exitCode ?? 0);
}
main().catch((e) => { console.error("FAILED:", e.message ?? e); process.exit(1); });
