import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { makePrice, type Price } from "@/lib/pricing/types";

/**
 * The shared price table — the one place a price is kept, and the only code
 * allowed to read or write it.
 *
 * The old system had four separate writers into `stock_prices` (a refresh
 * cron, a cache-upsert helper, a lock-time persister, and a page-render
 * backfill) and three readers that each applied a different staleness rule —
 * 35 minutes, 30 seconds, and no limit at all. Every fix landed in one of
 * those paths and left the others intact, which is the machine that produced
 * a new patch every week.
 *
 * So the rule here is structural, not stylistic: nothing outside this file
 * touches these tables. One `read`, one `write`. A fix applied here is applied
 * everywhere by construction.
 *
 * Freshness is deliberately NOT enforced at this layer. The store's job is to
 * report faithfully what it holds and when it was taken; deciding whether that
 * is fresh enough belongs to the caller, because the answer differs by product
 * (see `Freshness` in ./types). A store that silently withheld stale rows would
 * be making that decision on everyone's behalf again.
 */

const STOCK_TABLE = "stock_prices";
const CRYPTO_TABLE = "crypto_prices";

export type AssetClass = "stock" | "crypto";

type PriceRow = {
  symbol: string;
  price: number | string;
  change_percent: number | string | null;
  updated_at: string;
};

function tableFor(asset: AssetClass): string {
  return asset === "crypto" ? CRYPTO_TABLE : STOCK_TABLE;
}

function rowToPrice(row: PriceRow): Price | null {
  return makePrice({
    symbol: String(row.symbol),
    price: Number(row.price),
    changePercent: Number(row.change_percent ?? 0),
    asOf: new Date(row.updated_at),
    // The store reports itself as the source. Which provider originally
    // produced the number is not recoverable from the row, and guessing would
    // be the same class of lie this module exists to prevent.
    source: "store",
  });
}

/**
 * Reads whatever the store holds for these symbols. Symbols with no row, or a
 * row that can't produce a valid Price, are simply absent from the result —
 * never present with a zero.
 */
export async function readStoredPrices(
  symbols: readonly string[],
  asset: AssetClass
): Promise<Map<string, Price>> {
  const out = new Map<string, Price>();
  const unique = [
    ...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ];
  if (unique.length === 0) return out;

  let supabase;
  try {
    supabase = createServiceClient();
  } catch (err) {
    console.error(
      `[pricing/store] no service client, cannot read ${tableFor(asset)}:`,
      err instanceof Error ? err.message : err
    );
    return out;
  }

  const { data, error } = await supabase
    .from(tableFor(asset))
    .select("symbol, price, change_percent, updated_at")
    .in("symbol", unique);

  if (error) {
    console.error(
      `[pricing/store] read of ${tableFor(asset)} failed: ${error.message}`
    );
    return out;
  }

  for (const row of data ?? []) {
    const price = rowToPrice(row as PriceRow);
    if (price) out.set(price.symbol, price);
  }

  return out;
}

/**
 * Writes freshly-observed prices back to the store.
 *
 * Every live fetch goes through here, so the first caller to notice a gap
 * repairs it for everyone who asks next. That write-through is what makes the
 * per-instance in-memory caching of the old system unnecessary: on Vercel each
 * serverless instance started cold and re-fanned-out the same requests, so a
 * "cache" that lived in process memory stopped working precisely when traffic
 * arrived. A row in the table is visible to every instance immediately.
 *
 * `asOf` is written as-is rather than as "now". A price observed at 15:59 and
 * written at 16:02 is three minutes old, and the caller deciding whether it is
 * fresh enough needs the observation time to be true.
 */
export async function writeStoredPrices(
  prices: readonly Price[],
  asset: AssetClass
): Promise<void> {
  if (prices.length === 0) return;

  const rows = prices.map((price) => ({
    symbol: price.symbol,
    price: price.price,
    change_percent: price.changePercent,
    updated_at: price.asOf.toISOString(),
  }));

  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from(tableFor(asset))
      .upsert(rows, { onConflict: "symbol" });

    if (error) {
      // A failed write never invalidates the price the caller already holds —
      // it just means the next reader pays for another fetch.
      console.error(
        `[pricing/store] failed to persist ${rows.length} price(s) to ${tableFor(asset)}: ${error.message}`
      );
    }
  } catch (err) {
    console.error(
      `[pricing/store] persist skipped:`,
      err instanceof Error ? err.message : err
    );
  }
}
