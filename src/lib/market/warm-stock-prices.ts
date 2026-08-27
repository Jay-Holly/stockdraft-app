import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * How fresh a stock_prices row has to be to trust it at a lock/close moment
 * instead of asking Finnhub directly.
 *
 * This was 2 minutes against a refresh cron that runs every 30. Those two
 * numbers are incompatible: a row written by the cron is already ~30 minutes
 * old by the time the next one lands, so almost nothing ever qualified as
 * warm and effectively every symbol fell through to a live Finnhub call.
 * That was survivable while a contest meant ~50 symbols. It stopped being
 * survivable at 547 — Finnhub's free tier caps at 60 calls/minute, so a lock
 * spent ~9 minutes quoting, blew past the 300s function limit, and died
 * before writing anything. Three days of contests sat open because of it.
 *
 * 35 minutes is set deliberately just above the cron's own 30-minute cadence,
 * so a row is warm until roughly the moment its replacement is due. The
 * tradeoff is real and worth stating plainly: a lock baseline can now be up
 * to ~35 minutes old rather than ~2. For a contest scored on a full-day
 * 9:30-to-4:00 move that is a small fraction of the window, and it buys the
 * thing that actually matters — the lock completing at all, for every pick,
 * instead of timing out and leaving the whole slate unscored.
 *
 * If per-second precision at the lock instant ever becomes the requirement,
 * the fix is a faster refresh cadence (or a higher API tier), not a narrower
 * window here — narrowing it again without also speeding up the cron just
 * recreates this outage.
 */
const WARM_THRESHOLD_MS = 35 * 60 * 1000;

/**
 * Splits symbols into "warm" (a recent-enough price already sitting in
 * stock_prices) and "cold" (needs a live Finnhub call). Stocks only —
 * crypto_prices only refreshes every 2 hours, far too coarse to ever count
 * as warm for a lock/close moment.
 */
export async function fetchWarmStockPrices(
  symbols: string[]
): Promise<{ warm: Record<string, number>; cold: string[] }> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (unique.length === 0) return { warm: {}, cold: [] };

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("stock_prices")
    .select("symbol, price, updated_at")
    .in("symbol", unique);

  const warm: Record<string, number> = {};
  const cutoff = Date.now() - WARM_THRESHOLD_MS;

  if (!error && data) {
    for (const row of data) {
      const price = Number(row.price);
      if (!(price > 0)) continue;
      const updatedAt = new Date(row.updated_at).getTime();
      if (Number.isFinite(updatedAt) && updatedAt >= cutoff) {
        warm[row.symbol.toUpperCase()] = price;
      }
    }
  }

  const cold = unique.filter((symbol) => !(symbol in warm));
  return { warm, cold };
}

/**
 * Writes a lock/close moment's live Finnhub recovery back into stock_prices,
 * the same table refresh-stock-prices.ts maintains.
 *
 * Without this, a symbol resolved the hard way (a cold Finnhub call at lock
 * or score time) only ever lived in fetchFinnhubQuotes' in-memory cache —
 * gone the moment the serverless instance recycles, and never visible to a
 * different invocation anyway. On 2026-08-26, after the day's regular refresh
 * cron had stopped running (market closed, no runs scheduled again until
 * tomorrow), a contest stuck retrying a large cold list had no way to make
 * any of its recovered prices stick between 15-minute ticks — every tick
 * re-asked Finnhub for the same symbols from scratch. Persisting here means
 * each tick's progress is real progress: whatever it manages to resolve is
 * warm for every subsequent tick (and every other contest/product reading
 * the same table) until WARM_THRESHOLD_MS actually elapses.
 */
export async function persistColdQuotesToStockPrices(
  quotes: Record<string, { price: number; changePercent: number }>
): Promise<void> {
  const rows = Object.entries(quotes)
    .filter(([, quote]) => quote.price > 0)
    .map(([symbol, quote]) => ({
      symbol: symbol.toUpperCase(),
      price: quote.price,
      change_percent: quote.changePercent,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("stock_prices")
    .upsert(rows, { onConflict: "symbol" });

  if (error) {
    // Never let a caching side-effect break the price the caller already
    // has in hand — the quote itself is still good even if it doesn't stick.
    console.error(`[warm-stock-prices] failed to persist ${rows.length} recovered quote(s):`, error.message);
  }
}
