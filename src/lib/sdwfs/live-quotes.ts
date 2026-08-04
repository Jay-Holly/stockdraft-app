import "server-only";

import { isCryptoSymbol } from "@/lib/draft/engine";
import {
  fetchCryptoQuotes,
  type CryptoQuote,
} from "@/lib/coingecko/service";
import { fetchFinnhubQuotes, type FinnhubQuote } from "@/lib/finnhub/service";
import { mergeQuotesWithFallback } from "@/lib/market/fallback-quotes";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * SDWFS needs true snapshots (Monday 9 AM ET open, Friday 4 PM ET close)
 * for a small, bounded symbol set. Fetching live from Finnhub/CoinGecko, then
 * falling back to S&P snapshot, then to last-known DB price ensures we
 * always have a valid price for every pick.
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

  // Fill in missing stock prices: live → S&P fallback → last-known DB price
  const mergedStocks = mergeQuotesWithFallback(stockSymbols, stockQuotes);

  // For symbols still missing (not in live or fallback), fetch last-known prices from DB
  const stillMissing = stockSymbols.filter((s) => !mergedStocks[s]);
  const dbPrices: Record<string, number> = {};
  if (stillMissing.length > 0) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("sdwfs_entry_picks")
      .select("symbol, close_price, open_price")
      .in("symbol", stillMissing)
      .order("updated_at", { ascending: false })
      .limit(stillMissing.length);

    for (const row of data ?? []) {
      if (!dbPrices[row.symbol]) {
        dbPrices[row.symbol] = (row.close_price ?? row.open_price) || 0;
      }
    }
  }

  const prices: Record<string, number> = {};

  for (const symbol of stockSymbols) {
    const quote = mergedStocks[symbol];
    prices[symbol] =
      quote?.price ?? dbPrices[symbol] ?? 0;
  }

  for (const symbol of cryptoSymbols) {
    const quote = cryptoQuotes[symbol];
    prices[symbol] = quote?.price ?? 0;
  }

  return prices;
}
