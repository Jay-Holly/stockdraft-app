import "server-only";

import { fetchContestQuotesFromLog } from "@/lib/pricing/contest-quotes";

/**
 * SDDFS prices — read from the price log, never from a provider.
 *
 * This file used to hold its own provider chain: a warm-cache lookup, a cold
 * Finnhub call for whatever was stale, a CoinGecko call for crypto, and a
 * write-back so the next tick would find it warm. That is all gone. The
 * logger sweeps the whole pool on a schedule and records every observation
 * with its source and timestamp; SDDFS reads what it wrote.
 *
 * Contract unchanged for callers: every requested symbol appears in the
 * result, and a symbol with no usable price maps to 0 — which callers already
 * treat as "no usable quote." A stale or invented price is still never a
 * safer answer than no price at all.
 *
 * The old file also had to load the crypto pool first, because classifying a
 * symbol as stock-or-crypto on a cold instance misrouted real pool coins like
 * XRP to the Finnhub path. That whole hazard is gone with the branch: the log
 * is keyed by symbol and does not care which asset class a symbol belongs to.
 */
export async function fetchLiveSddfsQuotes(
  symbols: string[],
  _options?: { forceCryptoRefresh?: boolean }
): Promise<Record<string, number>> {
  return fetchContestQuotesFromLog(symbols, "sddfs");
}
