#!/usr/bin/env node
/**
 * Replays the exact Finnhub fetch the 9:30 lock performs — same symbol set,
 * same batch size, same retry policy — and reports which symbols come back
 * empty and why. Read-only against our DB; does hit Finnhub for real.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1).replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const TOKEN = process.env.NEXT_PUBLIC_FINNHUB_KEY;
const date = process.argv[2] ?? "2026-08-12";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { data: contests } = await supabase
    .from("sddfs_contests")
    .select("id")
    .eq("contest_date", date);
  const { data: entries } = await supabase
    .from("sddfs_entries")
    .select("id")
    .in("contest_id", (contests ?? []).map((c) => c.id));
  const { data: picks } = await supabase
    .from("sddfs_entry_picks")
    .select("symbol")
    .in("entry_id", (entries ?? []).map((e) => e.id));

  const { data: pool } = await supabase.from("crypto_pool").select("symbol");
  const cryptoSet = new Set((pool ?? []).map((c) => c.symbol.toUpperCase()));

  // Same ordering the lifecycle produces: distinct, in pick-row order.
  const allSymbols = [...new Set((picks ?? []).map((p) => p.symbol.toUpperCase()))];
  const stocks = allSymbols.filter((s) => !cryptoSet.has(s));

  console.log(`${allSymbols.length} distinct symbols; ${stocks.length} route to Finnhub`);
  console.log(`Position of the four that failed:`);
  for (const s of ["ANET", "SATS", "RAIN", "HYPE"]) {
    const i = stocks.indexOf(s);
    console.log(`  ${s}: ${i === -1 ? "(not on the stock path)" : `#${i + 1} of ${stocks.length}`}`);
  }
  console.log();

  const batchSize = 8;
  const results = {};
  const failures = [];
  let calls = 0;
  const started = Date.now();

  for (let i = 0; i < stocks.length; i += batchSize) {
    const batch = stocks.slice(i, i + batchSize);
    for (const symbol of batch) {
      let got = null;
      const attempts = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        calls++;
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${TOKEN}`
        );
        if (res.status === 429) {
          attempts.push("429");
          await sleep(500);
          continue;
        }
        if (!res.ok) {
          attempts.push(`HTTP${res.status}`);
          await sleep(200);
          continue;
        }
        const body = await res.json();
        const price = body.c ?? 0;
        if (price <= 0) {
          attempts.push("c=0");
          await sleep(200);
          continue;
        }
        got = price;
        attempts.push(`ok ${price}`);
        break;
      }
      results[symbol] = got;
      if (got === null) failures.push({ symbol, attempts });
    }
    if (i + batchSize < stocks.length) await sleep(150);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const rate = ((calls / elapsed) * 60).toFixed(0);

  console.log(`${calls} Finnhub calls in ${elapsed}s  (~${rate}/min against a 60/min cap)\n`);
  console.log(`Priced: ${Object.values(results).filter(Boolean).length}/${stocks.length}`);
  if (failures.length) {
    console.log(`\nFailed:`);
    for (const f of failures) {
      console.log(`  ${f.symbol}: ${f.attempts.join(" -> ")}`);
    }
  } else {
    console.log(`\nNo failures on this replay.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
