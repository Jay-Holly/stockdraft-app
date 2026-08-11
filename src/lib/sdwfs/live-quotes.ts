import "server-only";

import { isCryptoSymbol } from "@/lib/draft/engine";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import {
  fetchCryptoQuotes,
  type CryptoQuote,
} from "@/lib/coingecko/service";
import { fetchFinnhubQuotes, type FinnhubQuote } from "@/lib/finnhub/service";
import { mergeQuotesWithFallback } from "@/lib/market/fallback-quotes";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * SDWFS needs true snapshots (Monday 9 AM ET open, Friday 4 PM ET close) for
 * a small, bounded symbol set. Fetching live from Finnhub/CoinGecko covers
 * every pick.
 *
 * `allowStaleFallback` gates the S&P snapshot / last-known-DB-price fallback.
 * It must stay off for the lock and score writes — those set real baselines
 * and payouts, and a stale or leftover DB price silently passing as "live"
 * once corrupted every later read of that symbol. It's fine for the mid-week
 * leaderboard preview (Tue/Wed/Thu), which is display-only and self-corrects
 * the next time a live quote succeeds.
 */
export async function fetchLiveSdwfsQuotes(
  symbols: string[],
  options?: { allowStaleFallback?: boolean }
): Promise<Record<string, number>> {
  const allowStaleFallback = options?.allowStaleFallback ?? false;

  // Load the crypto pool before classifying symbols — on a cold serverless
  // instance the in-memory pool starts empty (just a 4-coin legacy list), so
  // classifying first misrouted real pool coins like XRP to the stock path.
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

  const mergedStocks = allowStaleFallback
    ? mergeQuotesWithFallback(stockSymbols, stockQuotes)
    : { ...stockQuotes };

  const dbPrices: Record<string, number> = {};
  if (allowStaleFallback) {
    const stillMissing = stockSymbols.filter((s) => !mergedStocks[s]);
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
