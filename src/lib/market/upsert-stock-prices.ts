import "server-only";

/**
 * Writing to the old stock price cache — now a deliberate no-op.
 *
 * `stock_prices` was the reader-facing cache, refreshed by its own cron and
 * topped up by whichever route happened to fetch a fresh quote. Nothing reads
 * it any more: every price in the app comes from `price_log`, which only the
 * logger writes. Keeping this writing to a table nobody reads would produce a
 * second, diverging record of what a price was — which is precisely the
 * situation the price log was built to end.
 *
 * Kept as a no-op rather than deleted because a caller still exists
 * (`/api/market/search`). It returns quietly so nothing breaks, and this
 * comment explains why the write is gone rather than leaving a future reader
 * to wonder whether it was lost by accident.
 */
export async function upsertStockPriceCache(
  _quotes: unknown
): Promise<void> {
  return;
}
