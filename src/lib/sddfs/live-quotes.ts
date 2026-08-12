import "server-only";

import { isCryptoSymbol } from "@/lib/draft/engine";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import {
  fetchCryptoQuotes,
  type CryptoQuote,
} from "@/lib/coingecko/service";
import { fetchFinnhubQuotes, type FinnhubQuote } from "@/lib/finnhub/service";
import { fetchWarmStockPrices } from "@/lib/market/warm-stock-prices";
import {
  verifyStockPrices,
  verifyCryptoPrices,
} from "@/lib/market/second-source-check";

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
 * `verifyAgainstSecondSource` cross-checks every price against Yahoo
 * Finance before trusting it — a real ETH close and a real GOOGL open both
 * got through Finnhub/CoinGecko silently wrong on Aug 11, and a single
 * source with no plausibility check can't catch its own bad tick. Only the
 * lock/score paths turn this on; the frequently-polled leaderboard preview
 * doesn't need the extra latency for a number nobody can act on anyway.
 */
export async function fetchLiveSddfsQuotes(
  symbols: string[],
  options?: { verifyAgainstSecondSource?: boolean }
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
      ? fetchCryptoQuotes()
      : Promise.resolve({} as Record<string, CryptoQuote>),
  ]);

  const coldQuotes =
    warmStocks.cold.length > 0
      ? await fetchFinnhubQuotes(warmStocks.cold, { cache: "no-store" })
      : ({} as Record<string, FinnhubQuote>);

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

  if (!options?.verifyAgainstSecondSource) {
    const prices: Record<string, number> = {};
    for (const symbol of stockSymbols) prices[symbol] = stockCandidates[symbol] ?? 0;
    for (const symbol of cryptoSymbols) prices[symbol] = cryptoCandidates[symbol] ?? 0;
    return prices;
  }

  const [verifiedStocks, verifiedCrypto] = await Promise.all([
    Object.keys(stockCandidates).length > 0
      ? verifyStockPrices(stockCandidates)
      : Promise.resolve({} as Record<string, number>),
    Object.keys(cryptoCandidates).length > 0
      ? verifyCryptoPrices(cryptoCandidates)
      : Promise.resolve({} as Record<string, number>),
  ]);

  const prices: Record<string, number> = {};
  for (const symbol of stockSymbols) prices[symbol] = verifiedStocks[symbol] ?? 0;
  for (const symbol of cryptoSymbols) prices[symbol] = verifiedCrypto[symbol] ?? 0;
  return prices;
}
