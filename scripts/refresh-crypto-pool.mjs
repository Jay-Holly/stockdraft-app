/**
 * Refresh crypto_pool in Supabase from CoinGecko (requires service role env vars).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run refresh:crypto-pool
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error(
      "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
    );
    process.exit(1);
  }

  const sqlPath = join(root, "supabase/migrations/030_crypto_pool.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const valueBlock = sql.match(/insert into public\.crypto_pool[\s\S]*?values\s*([\s\S]*?)\n/on conflict/i);

  if (!valueBlock) {
    throw new Error("Could not parse seed rows from 030_crypto_pool.sql — run generate:crypto-pool first.");
  }

  const rows = [];
  const tuplePattern =
    /\('([^']*)',\s*'([^']*)',\s*'([^']*)',\s*(\d+),\s*([0-9.]+|null)\)/g;

  for (const match of valueBlock[1].matchAll(tuplePattern)) {
    rows.push({
      symbol: match[1],
      name: match[2].replace(/''/g, "'"),
      coingecko_id: match[3],
      market_cap_rank: Number(match[4]),
      reference_price_usd: match[5] === "null" ? null : Number(match[5]),
      updated_at: new Date().toISOString(),
    });
  }

  if (rows.length === 0) {
    throw new Error("No crypto pool rows parsed.");
  }

  const supabase = createClient(url, serviceKey);
  const { error } = await supabase.from("crypto_pool").upsert(rows, {
    onConflict: "symbol",
  });

  if (error) {
    throw error;
  }

  console.log(`Upserted ${rows.length} crypto pool rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
