import "server-only";

import { getLatestPrices } from "@/lib/pricing/read";

/**
 * Quotes for the market API routes, served from the price log.
 *
 * These functions used to read the `stock_prices` and `crypto_prices` tables —
 * a cache refreshed by its own cron. Nothing writes those tables any more: the
 * logger sweeps the whole pool every minute and records every observation, with
 * its source and the moment it was true, in `price_log`. Reading the old cache
 * now would serve prices frozen at whenever that cron last ran, which is a
 * quieter and worse failure than serving none.
 *
 * The exported shapes are unchanged so the API routes did not need rewriting.
 * A symbol the log has no price for is simply absent from the result — the
 * same thing an empty cache row meant, without inventing anything.
 */

export type CachedQuote = {
  price: number;
  prevClose: number;
  changePercent: number;
  updatedAt: string;
};

export type ApiQuote = {
  price: number;
  prevClose: number;
  changePercent: number;
  updatedAt: string;
};

export type CachedQuoteMap = Record<string, CachedQuote>;

export function toApiQuote(quote: CachedQuote): ApiQuote {
  return {
    price: quote.price,
    prevClose: quote.prevClose,
    changePercent: quote.changePercent,
    updatedAt: quote.updatedAt,
  };
}

async function quotesFromLog(symbols: readonly string[]): Promise<CachedQuoteMap> {
  const unique = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))];
  if (unique.length === 0) return {};

  const lookup = await getLatestPrices(unique);
  const out: CachedQuoteMap = {};

  for (const [symbol, hit] of lookup.hits) {
    const changePercent = hit.changePercent ?? 0;
    // Derived from the provider's own change rather than invented. With no
    // change reported, prevClose equals the price and the move reads as flat,
    // which is the honest "we don't know" rendering.
    const prevClose =
      changePercent !== 0 ? hit.price / (1 + changePercent / 100) : hit.price;

    out[symbol] = {
      price: hit.price,
      prevClose,
      changePercent,
      updatedAt: hit.asOf.toISOString(),
    };
  }

  return out;
}

export async function fetchCachedStockQuotes(
  symbols: readonly string[]
): Promise<CachedQuoteMap> {
  return quotesFromLog(symbols);
}

export async function fetchCachedCryptoQuotes(
  symbols: readonly string[]
): Promise<CachedQuoteMap> {
  return quotesFromLog(symbols);
}

/**
 * Every crypto price the log currently holds. Reads the pool with the async
 * loader, never the synchronous in-memory accessor — that accessor is only
 * populated as a side effect of some other route having run first, so on a
 * cold serverless instance it is empty and every coin silently disappears.
 */
export async function fetchAllCachedCryptoQuotes(): Promise<CachedQuoteMap> {
  const { fetchCryptoPool } = await import("@/lib/crypto-pool/server");
  const pool = await fetchCryptoPool();
  return quotesFromLog(pool.map((coin) => coin.symbol));
}
