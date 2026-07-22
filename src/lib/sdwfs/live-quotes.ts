import "server-only";

import { isCryptoSymbol } from "@/lib/draft/engine";
import {
  fetchCryptoQuotes,
  type CryptoQuote,
} from "@/lib/coingecko/service";
import { fetchFinnhubQuotes, type FinnhubQuote } from "@/lib/finnhub/service";
import { getFallbackStockQuote } from "@/lib/market/fallback-quotes";

/**
 * SDWFS needs true snapshots (Monday 9 AM ET open, Friday 4 PM ET close)
 * for a small, bounded symbol set (at most a few dozen distinct tickers
 * across the week's contests). The shared `stock_prices`/`crypto_prices`
 * cache tables are refreshed on a rotating once-daily cron that only
 * covers a portion of the ~500-symbol draft pool per run — reading from
 * them here silently produces stale/duplicate open+close prices (a flat
 * 0% score) for any symbol the rotation didn't touch that week. Fetching
 * live here instead (Finnhub for stocks, CoinGecko for crypto) stays well
 * within rate limits for a set this small and guarantees both snapshots
 * are real prices, same as the SDDFS daily contest fix this mirrors.
 */
export async function fetchLiveSdwfsQuotes(
  symbols: string[]
): Promise<Record<string, number>> {
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
    const live = stockQuotes[symbol]?.price;
    prices[symbol] = live && live > 0 ? live : getFallbackStockQuote(symbol)?.price ?? 0;
  }
  for (const symbol of cryptoSymbols) {
    prices[symbol] = cryptoQuotes[symbol]?.price ?? 0;
  }

  return prices;
}
