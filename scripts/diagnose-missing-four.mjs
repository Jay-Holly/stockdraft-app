#!/usr/bin/env node
/**
 * Why do ANET, SATS, RAIN and HYPE keep coming out of the lock with no price?
 * Read-only. Asks three questions per symbol:
 *   1. How does our own code classify it — stock or crypto?
 *   2. Is it in the pools/price tables it would need to be in?
 *   3. Can the source it routes to actually quote it right now?
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1).replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.local"));

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const FINNHUB = process.env.NEXT_PUBLIC_FINNHUB_KEY;
const TARGETS = ["ANET", "SATS", "RAIN", "HYPE"];

async function main() {
  const { data: pool } = await supabase
    .from("crypto_pool")
    .select("symbol, coingecko_id, name");
  const poolMap = new Map((pool ?? []).map((c) => [c.symbol.toUpperCase(), c]));
  console.log(`crypto_pool has ${pool?.length ?? 0} coins\n`);

  const { data: stockRows } = await supabase
    .from("stock_prices")
    .select("symbol, price, updated_at")
    .in("symbol", TARGETS);
  const stockMap = new Map((stockRows ?? []).map((r) => [r.symbol.toUpperCase(), r]));

  const { data: cryptoRows } = await supabase
    .from("crypto_prices")
    .select("symbol, price, updated_at")
    .in("symbol", TARGETS);
  const cryptoMap = new Map((cryptoRows ?? []).map((r) => [r.symbol.toUpperCase(), r]));

  for (const symbol of TARGETS) {
    console.log(`=== ${symbol} ===`);

    const inPool = poolMap.get(symbol);
    console.log(
      `  crypto_pool:   ${inPool ? `YES (id=${inPool.coingecko_id}, ${inPool.name})` : "no -> routes to STOCK path"}`
    );

    const sp = stockMap.get(symbol);
    console.log(
      `  stock_prices:  ${sp ? `${sp.price} @ ${sp.updated_at}` : "NO ROW"}`
    );

    const cp = cryptoMap.get(symbol);
    console.log(
      `  crypto_prices: ${cp ? `${cp.price} @ ${cp.updated_at}` : "NO ROW"}`
    );

    // Ask Finnhub directly.
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB}`
      );
      const body = await res.json();
      console.log(
        `  finnhub quote: HTTP ${res.status} c=${body.c} pc=${body.pc}` +
          (body.c === 0 ? "  <-- ZERO = Finnhub does not price this" : "")
      );
    } catch (err) {
      console.log(`  finnhub quote: ERROR ${err.message}`);
    }

    // Is it a tradable US equity as far as Finnhub is concerned?
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/search?q=${symbol}&token=${FINNHUB}`
      );
      const body = await res.json();
      const exact = (body.result ?? []).filter(
        (r) => r.symbol?.toUpperCase() === symbol
      );
      console.log(
        `  finnhub search: ${exact.length ? exact.map((e) => `${e.symbol} (${e.type}, mic=${e.mic ?? "?"})`).join("; ") : "no exact match"}`
      );
    } catch (err) {
      console.log(`  finnhub search: ERROR ${err.message}`);
    }

    if (inPool) {
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${inPool.coingecko_id}&vs_currencies=usd`
        );
        const body = await res.json();
        console.log(
          `  coingecko:     HTTP ${res.status} ${JSON.stringify(body)}`
        );
      } catch (err) {
        console.log(`  coingecko:     ERROR ${err.message}`);
      }
    }

    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
