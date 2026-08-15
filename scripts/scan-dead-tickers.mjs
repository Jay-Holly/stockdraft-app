#!/usr/bin/env node
/**
 * Scans every draft-pool symbol for a ticker Finnhub still answers for but
 * that no longer trades — the SATS case, where a re-tickered company keeps
 * returning a complete, frozen quote.
 *
 * Rate limiting is handled explicitly rather than skipped. An earlier version
 * of this scan fired sequential calls, blew past 60/min, and dropped every
 * rate-limited response on the floor with `if (!ok) continue` — reporting a
 * clean pool from a run that had mostly not happened. A symbol that cannot be
 * checked here is counted as UNKNOWN, never as healthy.
 *
 *   node scripts/scan-dead-tickers.mjs
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

const MAX_QUOTE_AGE_MS = 5 * 24 * 60 * 60 * 1000;
const PACE_MS = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mirrors isDeadTickerQuote in src/lib/finnhub/service.ts. */
function deadTickerReason(tradeTime) {
  if (!tradeTime || !Number.isFinite(tradeTime)) return null;
  const at = new Date(tradeTime * 1000);
  if (
    at.getUTCHours() === 0 &&
    at.getUTCMinutes() === 0 &&
    at.getUTCSeconds() === 0
  ) {
    return `midnight stamp (${at.toISOString().slice(0, 16)})`;
  }
  const age = Date.now() - at.getTime();
  if (age > MAX_QUOTE_AGE_MS) {
    return `last trade ${Math.round(age / 86_400_000)}d ago (${at.toISOString().slice(0, 16)})`;
  }
  return null;
}

async function quoteWithRetry(symbol) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${TOKEN}`
      );
      if (res.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return { error: `HTTP ${res.status}` };
      return { body: await res.json() };
    } catch (err) {
      await sleep(1000 * (attempt + 1));
    }
  }
  return { error: "rate limited or unreachable after 4 attempts" };
}

async function main() {
  const { data: pool, error } = await supabase
    .from("draft_pool")
    .select("symbol, name")
    .order("symbol");
  if (error) throw new Error(error.message);

  console.log(`scanning ${pool.length} draft-pool symbols\n`);

  const dead = [];
  const noQuote = [];
  const unknown = [];
  let healthy = 0;

  for (let i = 0; i < pool.length; i++) {
    const symbol = pool[i].symbol.toUpperCase();
    const { body, error: err } = await quoteWithRetry(symbol);

    if (err) {
      unknown.push(`${symbol} — ${err}`);
    } else if (!(body?.c > 0)) {
      noQuote.push(symbol);
    } else {
      const reason = deadTickerReason(body.t);
      if (reason) dead.push(`${symbol} (${pool[i].name}) — ${reason}`);
      else healthy++;
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  ...${i + 1}/${pool.length}`);
    }
    await sleep(PACE_MS);
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`healthy:            ${healthy}`);
  console.log(`DEAD TICKERS:       ${dead.length}`);
  console.log(`no quote at all:    ${noQuote.length}`);
  console.log(`unchecked/unknown:  ${unknown.length}`);

  if (dead.length) {
    console.log(`\nDEAD — need re-mapping:`);
    dead.forEach((d) => console.log(`  ${d}`));
  }
  if (noQuote.length) {
    console.log(`\nNO QUOTE (price <= 0):`);
    console.log(`  ${noQuote.join(", ")}`);
  }
  if (unknown.length) {
    console.log(`\nUNCHECKED — not evidence of health:`);
    unknown.forEach((u) => console.log(`  ${u}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
