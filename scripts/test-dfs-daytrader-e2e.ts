/** READ-ONLY end-to-end for SDDFS scoring and Day Trader valuation. Writes nothing. */
import { createServiceClient } from "../src/lib/supabase/service";
import { fetchDayTraderPositionQuotes, computeDayTraderEntryValue, computeDayTraderFinalMetrics } from "../src/lib/day-trader/portfolio-value";
import { safePctChange } from "../src/lib/market/quote-guards";
import { fetchContestAnchors } from "../src/lib/pricing/contest-quotes";

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

async function main() {
  const supabase = createServiceClient();

  console.log("\n=== DAY TRADER: value a portfolio from the log ===");
  const positions = [
    { symbol: "AAPL", shares: 100 },
    { symbol: "MSFT", shares: 50 },
    { symbol: "NVDA", shares: 200 },
    { symbol: "ZZZZFAKE", shares: 10 },
  ];
  const quotes = await fetchDayTraderPositionQuotes(positions);
  for (const [s, q] of Object.entries(quotes)) console.log(`  ${s.padEnd(9)} $${q.price}  (${q.changePercent.toFixed(2)}%)  prevClose ${q.prevClose.toFixed(2)}`);
  console.log(`  ZZZZFAKE present: ${"ZZZZFAKE" in quotes ? "YES — WRONG" : "no (correct, absent not invented)"}`);
  const cash = 50_000;
  const value = computeDayTraderEntryValue(cash, positions, quotes);
  console.log(`  cash ${money(cash)} + equity = ${money(value)}`);
  const m = computeDayTraderFinalMetrics(500_000, value);
  console.log(`  vs $500,000 start: ${m.finalDollarGain >= 0 ? "+" : ""}${money(m.finalDollarGain)} (${m.finalPctGain.toFixed(2)}%)`);

  console.log("\n=== SDDFS: re-score a real, already-scored contest from stored prices ===");
  const { data: contests } = await supabase
    .from("sddfs_contests").select("id, contest_date, status").eq("status", "scored")
    .order("contest_date", { ascending: false }).limit(1);
  const contest = contests?.[0];
  if (!contest) { console.log("  (no scored contest found)"); return; }
  console.log(`  contest ${contest.id.slice(0, 8)}  ${contest.contest_date}`);

  const { data: entries } = await supabase.from("sddfs_entries").select("id, user_id").eq("contest_id", contest.id).limit(200);
  const { data: picks } = await supabase
    .from("sddfs_entry_picks").select("entry_id, symbol, open_price, close_price, pct_change")
    .in("entry_id", (entries ?? []).map((e) => e.id));

  const byEntry = new Map<string, { sym: string; open: number | null; close: number | null; stored: number | null }[]>();
  for (const p of picks ?? []) {
    const list = byEntry.get(p.entry_id as string) ?? [];
    list.push({ sym: String(p.symbol), open: p.open_price == null ? null : Number(p.open_price), close: p.close_price == null ? null : Number(p.close_price), stored: p.pct_change == null ? null : Number(p.pct_change) });
    byEntry.set(p.entry_id as string, list);
  }

  let matched = 0, mismatched = 0;
  const board: { entry: string; total: number }[] = [];
  for (const [entryId, list] of byEntry) {
    let total = 0;
    for (const p of list) {
      const recomputed = safePctChange(p.open, p.close);
      total += recomputed ?? 0;
      if (p.stored != null && recomputed != null) {
        if (Math.abs(p.stored - recomputed) < 0.0001) matched++; else { mismatched++; if (mismatched <= 3) console.log(`    MISMATCH ${p.sym}: stored ${p.stored} vs recomputed ${recomputed}`); }
      }
    }
    board.push({ entry: entryId.slice(0, 8), total });
  }
  board.sort((a, b) => b.total - a.total);
  console.log(`  entries: ${board.length}`);
  console.log(`  pick pct_change recomputed and MATCHING stored: ${matched}`);
  console.log(`  MISMATCHED: ${mismatched}`);
  console.log("  leaderboard (top 5, recomputed from stored open/close):");
  for (const r of board.slice(0, 5)) console.log(`    ${r.entry}  ${r.total >= 0 ? "+" : ""}${r.total.toFixed(3)}%`);

  console.log("\n=== the same contest's anchors, from the log ===");
  const syms = [...new Set((picks ?? []).map((p) => String(p.symbol).toUpperCase()))].slice(0, 8);
  const anchors = await fetchContestAnchors(syms, contest.contest_date as string, "close", "verify");
  const have = Object.values(anchors).filter((v) => v > 0).length;
  console.log(`  ${have} of ${syms.length} sampled symbols have a close anchor logged for ${contest.contest_date}`);
  console.log(`  (the log only started collecting 2026-08-28, so older contests having none is expected)`);
  console.log("\n  NOTHING WAS WRITTEN.");
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });
