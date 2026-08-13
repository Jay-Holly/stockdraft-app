import "server-only";

import { isCryptoSymbol } from "@/lib/draft/engine";
import { fetchLiveSddfsQuotes } from "@/lib/sddfs/live-quotes";
import { fetchLiveSdwfsQuotes } from "@/lib/sdwfs/live-quotes";
import { isUsableQuote } from "@/lib/market/quote-guards";
import { fetchLiveCryptoPrices } from "@/lib/market/coinpaprika";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

/**
 * Second, third and fourth chance at the prices a lock or close moment needs.
 *
 * Finnhub/CoinGecko own these numbers. This only re-asks them for symbols that
 * came back empty — it never second-guesses a price they did return, and never
 * substitutes a different source or a different day.
 *
 * Retries cover stocks as well as crypto. On 2026-08-12 ANET reached the lock
 * with no open price and then closed cleanly at 4 PM off the very same code
 * path, which is what a one-off empty response looks like — asking again would
 * have answered it. An earlier version of this function bailed out unless a
 * crypto symbol was missing, so a stock in exactly that state got zero retries.
 *
 * Crypto retries force a cache bypass. The shared CoinGecko result is cached
 * for 45 seconds, so retries spaced a second or two apart would otherwise all
 * read back the same cached response — including the same missing coins.
 *
 * A symbol still unpriced after all this is left unset rather than substituted.
 * The tempting fallback — yesterday's close — hands everyone holding that
 * symbol the overnight gap as if they'd traded it. Unset scores the pick
 * neutral for now, and the backfill sweep recovers the real 09:30 price from
 * historical bars before anything pays out.
 */
export async function getOpeningPricesWithRetry(
  symbols: string[],
  options?: {
    maxRetries?: number;
    retryDelayMs?: number;
    isDailyContest?: boolean;
  }
): Promise<Record<string, number>> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const delayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const isDailyContest = options?.isDailyContest !== false;

  const fetchFn = isDailyContest ? fetchLiveSddfsQuotes : fetchLiveSdwfsQuotes;

  const quotes = await fetchFn(symbols);

  const stillMissing = () =>
    symbols.filter((s) => !isUsableQuote(quotes[s.toUpperCase()]));

  let missing = stillMissing();
  if (missing.length === 0) return quotes;

  console.error(
    `[open-price-retry] ${missing.length} of ${symbols.length} symbol(s) unpriced after first pass: ${missing.join(", ")}`
  );

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));

    const needsCryptoRefresh = missing.some((s) => isCryptoSymbol(s));
    const retryQuotes = await fetchFn(missing, {
      forceCryptoRefresh: needsCryptoRefresh,
    });

    let recovered = 0;
    for (const symbol of missing) {
      const price = retryQuotes[symbol.toUpperCase()];
      if (isUsableQuote(price)) {
        quotes[symbol.toUpperCase()] = price;
        recovered++;
      }
    }

    missing = stillMissing();
    console.error(
      `[open-price-retry] attempt ${attempt}/${maxRetries}: recovered ${recovered}, ${missing.length} still missing${missing.length ? ` (${missing.join(", ")})` : ""}`
    );

    if (missing.length === 0) break;
  }

  // Last resort for coins, and only for coins CoinGecko never answered for.
  // A stock in this state is genuinely better left unset: its true 09:30 price
  // is still sitting in the minute bars and the backfill sweep will recover it
  // exactly. A coin has no such second chance — nobody can reconstruct its
  // 09:30 price after the fact at minute precision — so the choice here is a
  // price about 90 seconds behind, or a baseline that never arrives and scores
  // the pick flat for the whole session. The stale price is the better of the
  // two, and the evening audit still bracket-checks it.
  const missingCrypto = missing.filter((s) => isCryptoSymbol(s));
  if (missingCrypto.length > 0) {
    try {
      const filled = await fetchLiveCryptoPrices(missingCrypto);
      for (const [symbol, price] of Object.entries(filled)) {
        if (isUsableQuote(price)) quotes[symbol.toUpperCase()] = price;
      }
      missing = stillMissing();
    } catch (err) {
      // The fallback must never be the reason a lock fails.
      console.error(
        `[open-price-retry] crypto fallback threw, continuing without it:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (missing.length > 0) {
    console.error(
      `[open-price-retry] GIVING UP on ${missing.join(", ")} — baselines left unset, backfill sweep will recover the equities`
    );
  }

  return quotes;
}
