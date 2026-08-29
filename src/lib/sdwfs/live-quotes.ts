import "server-only";

import { fetchContestQuotesFromLog } from "@/lib/pricing/contest-quotes";

/**
 * SDWFS prices — read from the price log, never from a provider.
 *
 * Identical in substance to the SDDFS version: the per-contest provider chain
 * (warm cache, cold Finnhub, CoinGecko, write-back) is gone, replaced by a
 * read of what the logger already recorded. See
 * `src/lib/pricing/contest-quotes.ts` for the reasoning.
 *
 * Contract unchanged: every requested symbol appears in the result, and a
 * symbol with no usable price maps to 0.
 */
export async function fetchLiveSdwfsQuotes(
  symbols: string[],
  _options?: { forceCryptoRefresh?: boolean }
): Promise<Record<string, number>> {
  return fetchContestQuotesFromLog(symbols, "sdwfs");
}
