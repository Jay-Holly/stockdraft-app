import "server-only";

import { isCryptoSymbol } from "@/lib/draft/engine";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import {
  fetchCryptoQuotes,
  type CryptoQuote,
} from "@/lib/coingecko/service";
import { fetchFinnhubQuotes, type FinnhubQuote } from "@/lib/finnhub/service";

/**
 * SDDFS needs a true intraday snapshot (lock at 9:30 AM ET, close at 4 PM ET)
 * for a small, bounded symbol set (at most a few dozen distinct tickers
 * across the day's contests). Every read here is live-market-hours — a stale
 * snapshot or leftover DB price is never a safer answer than no price at
 * all, so a symbol Finnhub/CoinGecko can't quote is simply left out of the
 * result (the caller treats a missing price as "no usable quote").
 */
export async function fetchLiveSddfsQuotes(
  symbols: string[]
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

  const [stockQuotes, cryptoQuotes] = await Promise.all([
    stockSymbols.length > 0
      ? fetchFinnhubQuotes(stockSymbols, { cache: "no-store" })
      : Promise.resolve({} as Record<string, FinnhubQuote>),
    cryptoSymbols.length > 0
      ? fetchCryptoQuotes()
      : Promise.resolve({} as Record<string, CryptoQuote>),
  ]);

  const prices: Record<string, number> = {};

  for (const symbol of stockSymbols) {
    const quote = stockQuotes[symbol];
    prices[symbol] = quote?.price ?? 0;
  }

  for (const symbol of cryptoSymbols) {
    const quote = cryptoQuotes[symbol];
    prices[symbol] = quote?.price ?? 0;
  }

  return prices;
}
