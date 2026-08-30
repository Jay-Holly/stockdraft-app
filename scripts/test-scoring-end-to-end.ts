/**
 * END-TO-END, READ-ONLY. Real leagues, real picks, real prices from the price
 * log, through the real valuation and gain code. Writes nothing.
 */
import { createServiceClient } from "../src/lib/supabase/service";
import { getLatestPrices } from "../src/lib/pricing/read";
import { valueRoster, computePeriodGain } from "../src/lib/scoring/portfolio";
import { planPeriodOpenBaselines } from "../src/lib/scoring/baseline-chain";

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

async function main() {
  const supabase = createServiceClient();

  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, name, league_type, status, current_week")
    .not("status", "in", "(completed,cancelled,archived)");

  let scored = 0, heldRosters = 0, problems: string[] = [];

  for (const league of leagues ?? []) {
    const { data: drafts } = await supabase
      .from("drafts").select("id, user_id").eq("league_id", league.id);
    if (!drafts?.length) continue;

    console.log(`\n=== ${league.name}  [${league.league_type}, week ${league.current_week}, ${league.status}] ===`);

    const { data: allPicks } = await supabase
      .from("draft_picks")
      .select("id, user_id, symbol, shares, pick_type, draft_id")
      .in("draft_id", drafts.map((d) => d.id));

    const { data: baselines } = await supabase
      .from("roster_week_baselines")
      .select("user_id, pick_id, value_at_open, value_at_close")
      .eq("league_id", league.id)
      .eq("week_number", league.current_week ?? 1);

    const openByPick = new Map((baselines ?? []).map((b) => [b.pick_id as string, Number(b.value_at_open)]));
    const priorCloseByPick = new Map(
      (baselines ?? []).filter((b) => b.value_at_close != null).map((b) => [b.pick_id as string, Number(b.value_at_close)])
    );

    for (const draft of drafts) {
      const picks = (allPicks ?? []).filter(
        (p) => p.draft_id === draft.id && p.pick_type !== "skip" && p.symbol?.toUpperCase() !== "__OPEN__"
      );
      if (picks.length === 0) { console.log(`  ${draft.user_id.slice(0, 8)}  (no picks)`); continue; }

      // 1. Prices, from the log only.
      const symbols = [...new Set(picks.map((p) => String(p.symbol).toUpperCase()))];
      const lookup = await getLatestPrices(symbols);
      const priceMap = new Map([...lookup.hits].map(([s, h]) => [s, h.price]));

      // 2. Value the roster — completely, or hold.
      const valued = valueRoster(
        picks.map((p) => ({ id: p.id, symbol: p.symbol, shares: Number(p.shares) })),
        priceMap
      );

      if (valued.decision === "hold") {
        heldRosters++;
        console.log(`  ${draft.user_id.slice(0, 8)}  HELD — no price for ${valued.missingSymbols.slice(0, 5).join(", ")}${valued.missingSymbols.length > 5 ? ` +${valued.missingSymbols.length - 5}` : ""}`);
        problems.push(`${league.name}: ${valued.missingSymbols.length} unpriced symbol(s)`);
        continue;
      }

      // 3. The period's opening value — chained where a prior close exists.
      const chain = planPeriodOpenBaselines(
        picks.map((p) => ({ id: p.id, symbol: p.symbol, shares: Number(p.shares) })),
        priorCloseByPick, priceMap
      );
      const storedOpen = picks.reduce((sum, p) => sum + (openByPick.get(p.id) ?? 0), 0);
      const openValue = storedOpen > 0 ? storedOpen : chain.write.reduce((s, w) => s + w.openValue, 0);

      // 4. The gain.
      const gain = computePeriodGain({ openValue, closeValue: valued.total });
      scored++;

      const src = storedOpen > 0 ? "stored baseline" : `chained/seeded (${chain.write.length} picks, ${chain.held.length} held)`;
      console.log(
        `  ${draft.user_id.slice(0, 8)}  ${picks.length} picks  open ${money(openValue)} -> now ${money(valued.total)}  ` +
        `${gain.dollarGain >= 0 ? "+" : ""}${money(gain.dollarGain)} (${gain.percentGain.toFixed(2)}%)  [${src}]`
      );
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`  rosters scored end to end: ${scored}`);
  console.log(`  rosters HELD (unpriced):   ${heldRosters}`);
  if (problems.length) { console.log(`  problems:`); for (const p of [...new Set(problems)]) console.log(`    - ${p}`); }
  console.log(`  NOTHING WAS WRITTEN.`);
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });
