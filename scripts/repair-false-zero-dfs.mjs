#!/usr/bin/env node
/**
 * Repairs SDDFS picks whose open and close are identical to the cent — the
 * false-zero signature left when a contest's lock and score ran in the same
 * pass and both read the same cached price, so every pick scored 0.00%.
 *
 * Both ends are rewritten from that contest date's real session bar, not just
 * the close: the open written during a backlog drain came from the same stale
 * cache and is no more trustworthy than the close was.
 *
 * A pick whose real bar cannot be fetched is left exactly as it is rather than
 * half-corrected. Crypto is skipped outright — a coin's ticker resolves to a
 * different asset on this source.
 *
 * NOTE ON COST: counting affected picks is free (database only), but resolving
 * what they SHOULD be costs one Twelve Data credit per symbol, and the free
 * tier allows 800 per day. Running this over ~600 symbols exhausts a day's
 * budget in one pass whether or not --write is given. Use --count-only to see
 * the scope without spending anything; the first version of this script did
 * not have that flag and burned the day's credits on a "dry run".
 *
 *   node scripts/repair-false-zero-dfs.mjs --count-only   # free, DB only
 *   node scripts/repair-false-zero-dfs.mjs                # fetches, no writes
 *   node scripts/repair-false-zero-dfs.mjs --write        # fetches and applies
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const l of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) process.env[l.slice(0,i)] = l.slice(i+1).replace(/^["']|["']$/g, "");
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TD = process.env.TWELVE_DATA_API_KEY;
const WRITE = process.argv.includes("--write");
const COUNT_ONLY = process.argv.includes("--count-only");
const DATES = process.argv.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (DATES.length === 0) { console.error("pass one or more contest dates"); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function barsFor(symbols, date) {
  const out = {};
  const CHUNK = 8; // free-tier credits per minute
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const batch = symbols.slice(i, i + CHUNK);
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(batch.join(","))}`
      + `&interval=1day&start_date=${date}&end_date=${date}&apikey=${TD}`;
    const res = await fetch(url);
    if (!res.ok) { await sleep(1500); continue; }
    const body = await res.json();
    const blocks = batch.length === 1 ? { [batch[0]]: body } : body;
    for (const [sym, blk] of Object.entries(blocks)) {
      const v = blk?.values?.[0];
      if (v?.open && v?.close) out[sym.toUpperCase()] = { open: Number(v.open), close: Number(v.close) };
    }
    if (i + CHUNK < symbols.length) await sleep(8000);
  }
  return out;
}

async function main() {
  for (const date of DATES) {
    const { data: contests } = await sb.from("sddfs_contests")
      .select("id,buy_in,status").eq("contest_date", date);
    if (!contests?.length) { console.log(`${date}: no contests`); continue; }

    console.log(`\n=== ${date} ===`);
    const affected = [];
    for (const c of contests) {
      const { data: es } = await sb.from("sddfs_entries").select("id").eq("contest_id", c.id);
      const ids = (es ?? []).map(e => e.id);
      if (!ids.length) continue;
      const { data: ps } = await sb.from("sddfs_entry_picks")
        .select("id,symbol,open_price,close_price").in("entry_id", ids);
      for (const p of ps ?? []) {
        if (p.open_price == null || p.close_price == null) continue;
        if (Math.abs(Number(p.open_price) - Number(p.close_price)) < 0.0001) {
          affected.push({ ...p, contestId: c.id, buyIn: c.buy_in, status: c.status });
        }
      }
    }

    if (!affected.length) { console.log("  no false zeros"); continue; }
    const symbols = [...new Set(affected.map(p => p.symbol.toUpperCase()))];
    console.log(`  false-zero picks: ${affected.length} across ${symbols.length} symbols`);

    if (COUNT_ONLY) {
      console.log("  (--count-only: skipping the fetch, no credits spent)");
      continue;
    }

    const bars = await barsFor(symbols, date);
    console.log(`  real bars fetched: ${Object.keys(bars).length}/${symbols.length}`);

    let fixable = 0, unfixable = 0;
    const preview = [];
    for (const p of affected) {
      const bar = bars[p.symbol.toUpperCase()];
      if (!bar) { unfixable++; continue; }
      fixable++;
      if (preview.length < 8) {
        const pct = ((bar.close - bar.open) / bar.open) * 100;
        preview.push(`    ${p.symbol.padEnd(6)} stored ${p.open_price}/${p.close_price} (0.00%)  ->  real ${bar.open}/${bar.close} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`);
      }
    }
    console.log(`  fixable: ${fixable}   unfixable (no bar / crypto): ${unfixable}`);
    preview.forEach(l => console.log(l));

    if (!WRITE) continue;

    let written = 0;
    for (const p of affected) {
      const bar = bars[p.symbol.toUpperCase()];
      if (!bar) continue;
      const pct = ((bar.close - bar.open) / bar.open) * 100;
      const { error } = await sb.from("sddfs_entry_picks")
        .update({ open_price: bar.open, close_price: bar.close, pct_change: pct })
        .eq("id", p.id);
      if (error) { console.error(`    write failed ${p.symbol}: ${error.message}`); continue; }
      written++;
    }
    console.log(`  WROTE ${written} pick(s)`);
  }
  if (!WRITE) console.log("\nDry run. Re-run with --write to apply.");
}

main().catch(e => { console.error(e); process.exit(1); });
