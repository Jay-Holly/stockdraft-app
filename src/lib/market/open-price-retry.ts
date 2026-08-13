import "server-only";

import { isCryptoSymbol } from "@/lib/draft/engine";
import { fetchLiveSddfsQuotes } from "@/lib/sddfs/live-quotes";
import { fetchLiveSdwfsQuotes } from "@/lib/sdwfs/live-quotes";
import { isUsableQuote } from "@/lib/market/quote-guards";

/**
 * Second chance at the prices a lock or close moment needs.
 *
 * Finnhub/CoinGecko own these numbers. This only re-asks them for symbols
 * that came back empty — it never second-guesses a price they did return.
 *
 * Crypto retries in place: its market is always open, so a miss is a
 * transient fetch failure and asking again a second later usually answers it.
 *
 * A stock that still has no price is left unset rather than substituted. The
 * tempting fallback — yesterday's close — is wrong: it hands everyone holding
 * that symbol the overnight gap as if they'd traded it, unfair and
 * unrecoverable once baked into a baseline. Unset scores the pick neutral for
 * now, and the blank gets filled with that session's real 09:30 price by the
 * backfill sweep (see fillMissingOpens) well before anything pays out. A
 * missing open is a delay, not a hole.
 */
export async function getOpeningPricesWithRetry(
  symbols: string[],
  options?: {
    maxCryptoRetries?: number;
    retryDelayMs?: number;
    isDailyContest?: boolean;
  }
): Promise<Record<string, number>> {
  const maxRetries = options?.maxCryptoRetries ?? 3;
  const delayMs = options?.retryDelayMs ?? 1000;
  const isDailyContest = options?.isDailyContest !== false;

  const fetchFn = isDailyContest ? fetchLiveSddfsQuotes : fetchLiveSdwfsQuotes;

  const quotes = await fetchFn(symbols);

  const missing = symbols.filter((s) => !isUsableQuote(quotes[s.toUpperCase()]));
  if (missing.length === 0) return quotes;

  console.log(
    `[open-price-retry] ${missing.length} missing: ${missing.join(", ")}`
  );

  const crypto = missing.filter((s) => isCryptoSymbol(s));
  if (crypto.length === 0) return quotes;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }

    console.log(
      `[open-price-retry] crypto retry ${attempt}/${maxRetries} for ${crypto.join(", ")}`
    );
    const retryQuotes = await fetchFn(crypto);

    for (const symbol of crypto) {
      const price = retryQuotes[symbol.toUpperCase()];
      if (isUsableQuote(price) && !isUsableQuote(quotes[symbol.toUpperCase()])) {
        quotes[symbol.toUpperCase()] = price;
      }
    }

    if (crypto.every((s) => isUsableQuote(quotes[s.toUpperCase()]))) break;
  }

  return quotes;
}
