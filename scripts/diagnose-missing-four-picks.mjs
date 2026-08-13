#!/usr/bin/env node
/** What did today's lock and close actually write for every pick? Read-only. */
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

const date = process.argv[2] ?? new Date().toISOString().split("T")[0];

async function main() {
  const { data: contests } = await supabase
    .from("sddfs_contests")
    .select("id, buy_in, status, lock_at")
    .eq("contest_date", date);

  console.log(`SDDFS contests on ${date}: ${contests?.length ?? 0}`);
  for (const c of contests ?? []) {
    console.log(`  $${c.buy_in} ${c.status} lock_at=${c.lock_at}`);
  }
  console.log();

  if (!contests?.length) return;

  const { data: entries } = await supabase
    .from("sddfs_entries")
    .select("id, contest_id")
    .in("contest_id", contests.map((c) => c.id));

  const { data: picks } = await supabase
    .from("sddfs_entry_picks")
    .select("id, symbol, open_price, close_price, pct_change")
    .in("entry_id", (entries ?? []).map((e) => e.id));

  const bySymbol = new Map();
  for (const p of picks ?? []) {
    const s = p.symbol.toUpperCase();
    if (!bySymbol.has(s)) bySymbol.set(s, []);
    bySymbol.get(s).push(p);
  }

  const broken = [];
  const fine = [];
  for (const [symbol, rows] of bySymbol) {
    const anyMissing = rows.some((r) => !r.open_price || !r.close_price);
    (anyMissing ? broken : fine).push({ symbol, rows });
  }

  console.log(`Total picks: ${picks?.length ?? 0} across ${bySymbol.size} distinct symbols`);
  console.log(`Symbols fully priced: ${fine.length}`);
  console.log(`Symbols with a gap:  ${broken.length}\n`);

  for (const { symbol, rows } of broken) {
    console.log(`=== ${symbol} (${rows.length} pick(s)) ===`);
    for (const r of rows) {
      console.log(
        `  open=${r.open_price ?? "NULL"}  close=${r.close_price ?? "NULL"}  pct=${r.pct_change ?? "NULL"}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
