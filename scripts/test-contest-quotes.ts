/** Live check that DFS/WFS quotes now come from the log. Read-only. */
import { fetchLiveSddfsQuotes } from "../src/lib/sddfs/live-quotes";
import { fetchLiveSdwfsQuotes } from "../src/lib/sdwfs/live-quotes";
import { getOpeningPricesWithRetry } from "../src/lib/market/open-price-retry";
import { fetchContestAnchors } from "../src/lib/pricing/contest-quotes";

const p = (l: string, v: unknown) => console.log(`  ${l}: ${String(v)}`);

async function main() {
  const syms = ["AAPL", "TSLA", "BTC", "ETH", "ZZZZFAKE"];

  console.log("\n[1] fetchLiveSddfsQuotes (stocks + crypto in one call)");
  const a = await fetchLiveSddfsQuotes(syms);
  for (const [s, v] of Object.entries(a)) p(s, `$${v}`);
  p("every requested symbol present", Object.keys(a).length === syms.length);
  p("ZZZZFAKE is 0 (absent sentinel)", a.ZZZZFAKE === 0);

  console.log("\n[2] fetchLiveSdwfsQuotes");
  const b = await fetchLiveSdwfsQuotes(["AAPL", "BTC"]);
  for (const [s, v] of Object.entries(b)) p(s, `$${v}`);

  console.log("\n[3] getOpeningPricesWithRetry — reads today's OPEN anchor");
  const o = await getOpeningPricesWithRetry(["AAPL", "MSFT"]);
  for (const [s, v] of Object.entries(o)) p(s, v > 0 ? `$${v}` : "0 — no open anchor logged yet");

  console.log("\n[4] fetchContestAnchors — a real past CLOSE");
  const c = await fetchContestAnchors(["AAPL", "MSFT", "NVDA"], "2026-08-28", "close");
  for (const [s, v] of Object.entries(c)) p(s, v > 0 ? `$${v}` : "0 — none");

  console.log("\n[5] invariant: crypto and stocks both resolved from one source");
  p("BTC priced via the DFS path", (a.BTC ?? 0) > 0 ? "yes" : "NO — FAIL");
  p("AAPL priced via the DFS path", (a.AAPL ?? 0) > 0 ? "yes" : "NO — FAIL");
  if (!((a.BTC ?? 0) > 0 && (a.AAPL ?? 0) > 0)) process.exitCode = 1;
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });
