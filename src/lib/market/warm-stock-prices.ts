import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * How fresh a stock_prices row has to be to trust it at a lock/close moment
 * instead of asking Finnhub directly. The shared refresh cron runs every
 * 30 minutes during market hours (and always refreshes the stalest symbols
 * first), so a row inside this window is very likely either the same lock
 * time's own refresh cycle or one that just ran moments before — reusing it
 * skips a redundant Finnhub call for a price we already have. Anything
 * older falls through to a live fetch; the goal is cutting duplicate calls,
 * never trusting a number too old to represent "right now."
 */
const WARM_THRESHOLD_MS = 2 * 60 * 1000;

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
