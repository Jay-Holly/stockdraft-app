#!/usr/bin/env node
/**
 * Resolves each crypto_pool coin to a CoinPaprika id and stores it.
 *
 * Matching is by price agreement with CoinGecko, never by ticker and never by
 * rank. Ten of the fifty tickers have more than one candidate on CoinPaprika,
 * and the highest-ranked candidate is the wrong asset for several of them —
 * RAIN's top-ranked match is a different token trading at less than half the
 * price. Price is the only signal here that actually identifies the asset.
 *
 * This runs once (and again whenever the pool changes). The runtime audit uses
 * the stored id and never re-resolves, because a check that re-picks whichever
 * coin currently matches would agree with itself forever.
 *
 *   node scripts/map-coinpaprika-ids.mjs           # report only
 *   node scripts/map-coinpaprika-ids.mjs --write   # persist the mapping
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

/** How close a candidate must sit to CoinGecko's price to count as the same asset. */
const MATCH_TOLERANCE_PCT = 3;
const WRITE = process.argv.includes("--write");

async function main() {
  const { data: pool, error } = await supabase
    .from("crypto_pool")
    .select("symbol, coingecko_id, name")
    .order("market_cap_rank");

  if (error) throw new Error(error.message);

  const cg = await (
    await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${pool
        .map((c) => c.coingecko_id)
        .join(",")}&vs_currencies=usd`
    )
  ).json();

  const tickers = await (
    await fetch("https://api.coinpaprika.com/v1/tickers")
  ).json();

  const bySymbol = new Map();
  for (const t of tickers) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol).push(t);
  }

  const resolved = [];
  const unresolved = [];

  for (const coin of pool) {
    const geckoPrice = cg[coin.coingecko_id]?.usd;
    const candidates = bySymbol.get(coin.symbol) ?? [];

    if (!geckoPrice || candidates.length === 0) {
      unresolved.push({ symbol: coin.symbol, why: "no candidate or no reference price" });
      continue;
    }

    const scored = candidates
      .map((t) => {
        const price = t.quotes?.USD?.price;
        return {
          id: t.id,
          price,
          diffPct: price ? (Math.abs(price - geckoPrice) / geckoPrice) * 100 : Infinity,
        };
      })
      .sort((a, b) => a.diffPct - b.diffPct);

    const best = scored[0];
    if (best.diffPct > MATCH_TOLERANCE_PCT) {
      unresolved.push({
        symbol: coin.symbol,
        why: `best candidate ${best.id} is ${best.diffPct.toFixed(0)}% off (cg=${geckoPrice} cp=${best.price})`,
      });
      continue;
    }

    resolved.push({
      symbol: coin.symbol,
      coinpaprikaId: best.id,
      diffPct: best.diffPct,
      rejected: scored.length - 1,
    });
  }

  console.log(`pool: ${pool.length}   resolved: ${resolved.length}   unresolved: ${unresolved.length}\n`);

  const contested = resolved.filter((r) => r.rejected > 0);
  if (contested.length > 0) {
    console.log("Tickers with more than one candidate, decided on price:");
    for (const r of contested) {
      console.log(
        `  ${r.symbol.padEnd(6)} -> ${r.coinpaprikaId.padEnd(28)} ${r.diffPct.toFixed(2)}%  (rejected ${r.rejected})`
      );
    }
    console.log();
  }

  if (unresolved.length > 0) {
    console.log("UNRESOLVED — these stay single-sourced:");
    for (const u of unresolved) console.log(`  ${u.symbol.padEnd(6)} ${u.why}`);
    console.log();
  }

  if (!WRITE) {
    console.log("Report only. Re-run with --write to persist.");
    return;
  }

  let written = 0;
  for (const r of resolved) {
    const { error: updateError } = await supabase
      .from("crypto_pool")
      .update({ coinpaprika_id: r.coinpaprikaId })
      .eq("symbol", r.symbol);

    if (updateError) {
      console.error(`  ${r.symbol}: ${updateError.message}`);
      continue;
    }
    written++;
  }

  console.log(`Wrote ${written} mapping(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
