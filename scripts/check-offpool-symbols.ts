/** Read-only: which rostered symbols are outside the symbol universe the logger sweeps? */
import { createServiceClient } from "../src/lib/supabase/service";

async function main() {
  const supabase = createServiceClient();

  const pool = new Set<string>();
  for (const table of ["draft_pool", "crypto_pool"] as const) {
    let from = 0;
    for (;;) {
      const { data } = await supabase.from(table).select("symbol").range(from, from + 999);
      for (const r of data ?? []) pool.add(String(r.symbol).toUpperCase());
      if (!data || data.length < 1000) break;
      from += 1000;
    }
  }
  console.log(`  symbol universe the logger sweeps: ${pool.size}`);

  // Every rostered pick, paginated past the 1000-row ceiling.
  const picks: { symbol: string; draft_id: string; pick_type: string }[] = [];
  let from = 0;
  for (;;) {
    const { data } = await supabase
      .from("draft_picks").select("symbol, draft_id, pick_type").range(from, from + 999);
    picks.push(...((data ?? []) as typeof picks));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`  draft picks examined: ${picks.length}`);

  const offPool = new Map<string, number>();
  for (const p of picks) {
    const s = String(p.symbol).toUpperCase();
    if (!s || s === "__OPEN__" || p.pick_type === "skip") continue;
    if (!pool.has(s)) offPool.set(s, (offPool.get(s) ?? 0) + 1);
  }

  if (offPool.size === 0) { console.log("\n  No off-pool symbols. Every rostered pick is sweepable."); return; }

  console.log(`\n  OFF-POOL SYMBOLS: ${offPool.size} distinct, ${[...offPool.values()].reduce((a, b) => a + b, 0)} picks`);

  // Which leagues are affected, and are any of them live?
  const drafts = new Map<string, string>();
  const { data: draftRows } = await supabase.from("drafts").select("id, league_id");
  for (const d of draftRows ?? []) drafts.set(d.id as string, d.league_id as string);
  const { data: leagueRows } = await supabase.from("leagues").select("id, name, status");
  const leagues = new Map((leagueRows ?? []).map((l) => [l.id as string, l]));

  const affected = new Map<string, Set<string>>();
  for (const p of picks) {
    const s = String(p.symbol).toUpperCase();
    if (!offPool.has(s)) continue;
    const lid = drafts.get(p.draft_id);
    const l = lid ? leagues.get(lid) : null;
    const label = l ? `${l.name} [${l.status}]` : "(unknown league)";
    if (!affected.has(label)) affected.set(label, new Set());
    affected.get(label)!.add(s);
  }

  console.log("\n  by symbol:");
  for (const [s, n] of [...offPool].sort((a, b) => b[1] - a[1])) console.log(`    ${s.padEnd(10)} ${n} pick(s)`);

  console.log("\n  by league:");
  for (const [label, syms] of affected) console.log(`    ${label}\n      ${[...syms].sort().join(", ")}`);
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });
