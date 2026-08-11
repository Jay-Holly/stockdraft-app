import "server-only";

import { isCryptoSymbol } from "@/lib/draft/engine";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import {
  fetchCryptoQuotes,
  type CryptoQuote,
} from "@/lib/coingecko/service";
import { fetchFinnhubQuotes, type FinnhubQuote } from "@/lib/finnhub/service";
import { fetchWarmStockPrices } from "@/lib/market/warm-stock-prices";

/**
 * SDWFS needs true snapshots (Monday 9 AM ET open, Friday 4 PM ET close),
 * plus a live read on the mid-week leaderboard preview — all live-market
 * reads. A stale snapshot or leftover DB price is never a safer answer than
 * no price at all, so a symbol Finnhub/CoinGecko can't quote is simply left
 * out of the result (the caller treats a missing price as "no usable
 * quote").
 *
 * Stocks check the shared stock_prices table first — refreshed continuously
 * by its own cron — and only ask Finnhub directly for whatever's too stale
 * to trust. That table is 2 hours behind for crypto, too coarse to ever be
 * "fresh enough" for a lock/close moment, so crypto always goes straight to
 * a live CoinGecko read.
 */
export async function fetchLiveSdwfsQuotes(
  symbols: string[]
): Promise<Record<string, number>> {
  // Load the crypto pool before classifying symbols — on a cold serverless
  // instance the in-memory pool starts empty (just a 4-coin legacy list), so
  // classifying first misrouted real pool coins like XRP to the stock path.
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

  const prices: Record<string, number> = {};

  for (const symbol of stockSymbols) {
    prices[symbol] = warmStocks.warm[symbol] ?? coldQuotes[symbol]?.price ?? 0;
  }

  for (const symbol of cryptoSymbols) {
    const quote = cryptoQuotes[symbol];
    prices[symbol] = quote?.price ?? 0;
  }

  return prices;
}
