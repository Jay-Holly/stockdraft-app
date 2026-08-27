import "server-only";

import { isCryptoSymbol } from "@/lib/draft/engine";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import {
  fetchCryptoQuotes,
  type CryptoQuote,
} from "@/lib/coingecko/service";
import { fetchFinnhubQuotes, type FinnhubQuote } from "@/lib/finnhub/service";
import {
  fetchWarmStockPrices,
  persistColdQuotesToStockPrices,
} from "@/lib/market/warm-stock-prices";

/**
 * SDDFS needs a true intraday snapshot (lock at 9:30 AM ET, close at 4 PM ET)
 * for a small, bounded symbol set (at most a few dozen distinct tickers
 * across the day's contests). Every read here is live-market-hours — a stale
 * snapshot or leftover DB price is never a safer answer than no price at
 * all, so a symbol Finnhub/CoinGecko can't quote is simply left out of the
 * result (the caller treats a missing price as "no usable quote").
 *
 * Stocks check the shared stock_prices table first — refreshed continuously
 * by its own cron — and only ask Finnhub directly for whatever's too stale
 * to trust. That table is 2 hours behind for crypto, too coarse to ever be
 * "fresh enough" for a lock/close moment, so crypto always goes straight to
 * a live CoinGecko read.
 *
 * Finnhub/CoinGecko are authoritative here: whatever they return is the
 * price, and no second source gets to overrule it at a lock or close moment.
 * An earlier version cross-checked against another provider and dropped any
 * price the two disagreed on, which was worse than useless — the second
 * source's free tier could only answer for a handful of symbols before rate
 * limiting, so the check applied arbitrarily, and every rejection destroyed a
 * usable price and manufactured exactly the missing baseline it was supposed
 * to protect against. Verification belongs in the nightly audit, where it can
 * cover every symbol on a budget and flag disagreements without deleting
 * anything.
 */
export async function fetchLiveSddfsQuotes(
  symbols: string[],
  options?: { forceCryptoRefresh?: boolean }
): Promise<Record<string, number>> {
  // Load the crypto pool before classifying symbols — on a cold serverless
  // instance the in-memory pool starts empty (just a 4-coin legacy list), so
  // classifying first misrouted real pool coins like XRP to the stock path,
  // where Finnhub doesn't know them and used to serve up a leftover DB price
  // instead.
  await fetchCryptoPool();

  const unique = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  const stockSymbols = unique.filter((s) => !isCryptoSymbol(s));
  const cryptoSymbols = unique.filter((s) => isCryptoSymbol(s));

  const [warmStocks, cryptoQuotes] = await Promise.all([
    stockSymbols.length > 0
      ? fetchWarmStockPrices(stockSymbols)
      : Promise.resolve({
          warm: {} as Record<string, number>,
          cold: [] as string[],
        }),
    cryptoSymbols.length > 0
      ? fetchCryptoQuotes({ forceRefresh: options?.forceCryptoRefresh })
      : Promise.resolve({} as Record<string, CryptoQuote>),
  ]);

  const coldQuotes =
    warmStocks.cold.length > 0
      ? await fetchFinnhubQuotes(warmStocks.cold, { cache: "no-store" })
      : ({} as Record<string, FinnhubQuote>);

  // Make whatever this call recovered stick for the next tick and every
  // other reader of stock_prices, instead of it living only in this one
  // invocation's memory — see persistColdQuotesToStockPrices for why.
  if (Object.keys(coldQuotes).length > 0) {
    await persistColdQuotesToStockPrices(coldQuotes);
  }

  const stockCandidates: Record<string, number> = {};
  for (const symbol of stockSymbols) {
    const price = warmStocks.warm[symbol] ?? coldQuotes[symbol]?.price ?? 0;
    if (price > 0) stockCandidates[symbol] = price;
  }

  const cryptoCandidates: Record<string, number> = {};
  for (const symbol of cryptoSymbols) {
    const price = cryptoQuotes[symbol]?.price ?? 0;
    if (price > 0) cryptoCandidates[symbol] = price;
  }

  const prices: Record<string, number> = {};
  for (const symbol of stockSymbols) prices[symbol] = stockCandidates[symbol] ?? 0;
  for (const symbol of cryptoSymbols) prices[symbol] = cryptoCandidates[symbol] ?? 0;
  return prices;
}
