#!/usr/bin/env node
/**
 * Repair crypto baseline history frozen at book value.
 *
 * Until e259b5e, crypto_pool was read with the user-scoped client, which RLS
 * limits to `authenticated`. Every background capture therefore saw an empty
 * pool, resolved no crypto quotes, and fell back to price_at_pick — and since
 * shares = budget / price_at_pick, that recorded a close of exactly the book
 * value every week. Crypto never compounded.
 *
 * This rebuilds those rows from real historical prices (CoinGecko hourly),
 * priced at each league-week's own finalize_at:
 *
 *   close(week N) = shares x price(symbol, finalize_at of week N)
 *   open(week N)  = close(week N-1)
 *   open(week 1)  = unchanged — the manager really did buy in at book value
 *
 * Picks whose share count changed (crypto rebalance/swap) are skipped: today's
 * share count cannot be applied to an earlier week. They are reported, not
 * guessed at.
 *
 * Usage:
 *   node scripts/repair-crypto-baseline-history.mjs            # dry run
 *   node scripts/repair-crypto-baseline-history.mjs --apply    # write
 *   node scripts/repair-crypto-baseline-history.mjs --league <uuid-prefix>
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing Supabase env (checked .env.local).");
  process.exit(1);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const leagueIdx = args.indexOf("--league");
const LEAGUE_FILTER = leagueIdx !== -1 ? args[leagueIdx + 1] : null;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function pageAll(table, select, refine) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let q = supabase.from(table).select(select).range(offset, offset + 999);
    if (refine) q = refine(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hourly USD prices for one coin across the whole span, in one request. */
async function fetchPriceSeries(coingeckoId, fromSec, toSec) {
  const url =
    `https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart/range` +
    `?vs_currency=usd&from=${fromSec}&to=${toSec}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(15000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${coingeckoId}: HTTP ${res.status}`);
    const json = await res.json();
    return (json.prices ?? []).map(([ms, price]) => [ms, price]);
  }
  throw new Error(`${coingeckoId}: rate limited after retries`);
}

/** Nearest sample to a timestamp; null when the series does not cover it. */
function priceAt(series, targetMs, toleranceMs = 36 * 60 * 60 * 1000) {
  if (!series.length) return null;
  let best = null;
  let bestGap = Infinity;
  for (const [ms, price] of series) {
    const gap = Math.abs(ms - targetMs);
    if (gap < bestGap) {
      bestGap = gap;
      best = price;
    }
  }
  return bestGap <= toleranceMs ? best : null;
}

async function main() {
  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — crypto baseline history repair\n`);

  const [pool, picks, baselines, matchups, moves] = await Promise.all([
    pageAll("crypto_pool", "symbol, coingecko_id"),
    pageAll("draft_picks", "id, symbol, pick_type, shares, budget_spent"),
    pageAll(
      "roster_week_baselines",
      "id, league_id, user_id, week_number, pick_id, value_at_open, value_at_close"
    ),
    pageAll("league_matchups", "league_id, week_number, finalize_at"),
    pageAll("roster_moves", "pick_id, move_type"),
  ]);

  const pickById = new Map(picks.map((p) => [p.id, p]));
  const geckoBySymbol = new Map(
    pool.map((c) => [c.symbol.toUpperCase(), c.coingecko_id])
  );

  // A pick whose crypto position was rebalanced has a share count that no
  // longer describes earlier weeks. Never guess at those.
  const movedPicks = new Set(
    moves
      .filter((m) => String(m.move_type ?? "").startsWith("crypto"))
      .map((m) => m.pick_id)
  );

  // Each league-week's own close time.
  const weekClose = new Map();
  for (const m of matchups) {
    if (!m.finalize_at) continue;
    const key = `${m.league_id}:${m.week_number}`;
    const ts = Date.parse(m.finalize_at);
    const prev = weekClose.get(key);
    if (prev == null || ts < prev) weekClose.set(key, ts);
  }

  const inScope = (leagueId) =>
    !LEAGUE_FILTER || leagueId.startsWith(LEAGUE_FILTER);

  const cryptoRows = baselines.filter((b) => {
    const p = pickById.get(b.pick_id);
    return p && p.pick_type === "crypto" && inScope(b.league_id);
  });

  const frozen = cryptoRows.filter((b) => {
    const p = pickById.get(b.pick_id);
    return Math.abs(Number(b.value_at_open) - Number(p.budget_spent)) < 0.01;
  });

  console.log(`crypto baseline rows in scope: ${cryptoRows.length}`);
  console.log(`  frozen at book value:        ${frozen.length}`);

  const skippedRebalanced = frozen.filter((b) => movedPicks.has(b.pick_id));
  const repairable = frozen.filter((b) => !movedPicks.has(b.pick_id));
  console.log(`  skipped (rebalanced pick):   ${skippedRebalanced.length}`);
  console.log(`  candidates:                  ${repairable.length}\n`);

  if (repairable.length === 0) {
    console.log("Nothing to repair.\n");
    return;
  }

  // Span to fetch, padded either side of the earliest/latest close.
  const times = repairable
    .map((b) => weekClose.get(`${b.league_id}:${b.week_number}`))
    .filter((t) => t != null);
  if (times.length === 0) {
    console.log("No finalize_at times available for these weeks — cannot price them.\n");
    return;
  }
  const fromSec = Math.floor(Math.min(...times) / 1000) - 3 * 86400;
  const toSec = Math.floor(Math.max(...times) / 1000) + 3 * 86400;

  const symbols = [
    ...new Set(repairable.map((b) => pickById.get(b.pick_id).symbol.toUpperCase())),
  ];
  console.log(`fetching hourly history for ${symbols.length} symbols…`);

  const seriesBySymbol = new Map();
  for (const sym of symbols) {
    const id = geckoBySymbol.get(sym);
    if (!id) {
      console.log(`  ${sym.padEnd(6)} no coingecko_id — skipping`);
      continue;
    }
    try {
      const series = await fetchPriceSeries(id, fromSec, toSec);
      seriesBySymbol.set(sym, series);
      console.log(`  ${sym.padEnd(6)} ${series.length} points`);
    } catch (err) {
      console.log(`  ${sym.padEnd(6)} FAILED: ${err.message}`);
    }
    await sleep(2500); // free tier is rate limited
  }

  // Compute the corrected close for every candidate row.
  const now = Date.now();
  const closeByRow = new Map();
  let unpriced = 0;
  let notYetClosed = 0;
  for (const b of repairable) {
    const p = pickById.get(b.pick_id);
    const series = seriesBySymbol.get(p.symbol.toUpperCase());
    const ts = weekClose.get(`${b.league_id}:${b.week_number}`);
    if (!series || ts == null) {
      unpriced++;
      continue;
    }
    // A week that has not reached its finalize_at has no close yet. Writing
    // one would invent a result the normal capture is about to produce.
    if (ts > now) {
      notYetClosed++;
      continue;
    }
    const price = priceAt(series, ts);
    if (price == null) {
      unpriced++;
      continue;
    }
    closeByRow.set(b.id, Number(p.shares) * price);
  }

  // open(week N) = close(week N-1); week 1's open is genuinely the buy-in.
  const byPick = new Map();
  for (const b of repairable) {
    if (!byPick.has(b.pick_id)) byPick.set(b.pick_id, []);
    byPick.get(b.pick_id).push(b);
  }

  const updates = [];
  for (const rows of byPick.values()) {
    rows.sort((a, b) => a.week_number - b.week_number);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const newClose = closeByRow.get(row.id);
      if (newClose == null) continue;

      // Only carry forward across genuinely consecutive weeks. A gap means
      // the intervening weeks were never captured, and pulling an old close
      // across it would credit this week with months of movement it did not
      // see. Those keep the open they already have.
      const prev = i > 0 ? rows[i - 1] : null;
      const isAdjacent = prev != null && prev.week_number === row.week_number - 1;
      const newOpen =
        isAdjacent && closeByRow.has(prev.id)
          ? closeByRow.get(prev.id)
          : Number(row.value_at_open);

      updates.push({
        id: row.id,
        symbol: pickById.get(row.pick_id).symbol,
        week: row.week_number,
        league: row.league_id,
        oldOpen: Number(row.value_at_open),
        newOpen,
        oldClose: row.value_at_close == null ? null : Number(row.value_at_close),
        newClose,
      });
    }
  }

  console.log(`\nrows that can be priced: ${updates.length}`);
  console.log(`rows with no usable price: ${unpriced}`);
  console.log(`rows in a week that has not closed yet: ${notYetClosed}\n`);

  const sample = updates.slice(0, 25);
  console.log(
    `${"sym".padEnd(6)}${"wk".padStart(3)}${"open (old->new)".padStart(26)}${"close (old->new)".padStart(28)}`
  );
  for (const u of sample) {
    const o = `${u.oldOpen.toFixed(0)} -> ${u.newOpen.toFixed(0)}`;
    const c = `${u.oldClose == null ? "null" : u.oldClose.toFixed(0)} -> ${u.newClose.toFixed(0)}`;
    console.log(
      `${u.symbol.padEnd(6)}${String(u.week).padStart(3)}${o.padStart(26)}${c.padStart(28)}`
    );
  }
  if (updates.length > sample.length) {
    console.log(`  … and ${updates.length - sample.length} more`);
  }

  if (skippedRebalanced.length > 0) {
    console.log(
      `\n${skippedRebalanced.length} row(s) left alone — their pick was rebalanced, so today's share count does not describe those weeks.`
    );
  }

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to write.\n");
    return;
  }

  console.log(`\nwriting ${updates.length} rows…`);
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(
      chunk.map(async (u) => {
        const { error } = await supabase
          .from("roster_week_baselines")
          .update({ value_at_open: u.newOpen, value_at_close: u.newClose })
          .eq("id", u.id);
        if (error) {
          failed++;
          if (failed <= 5) console.log(`  FAILED ${u.symbol} w${u.week}: ${error.message}`);
        } else ok++;
      })
    );
    process.stdout.write(`  ${Math.min(i + 100, updates.length)}/${updates.length}\r`);
  }
  console.log(`\n\nupdated ${ok}, failed ${failed}\n`);
}

main().catch((err) => {
  console.error(`Repair failed: ${err.message}`);
  process.exit(1);
});
