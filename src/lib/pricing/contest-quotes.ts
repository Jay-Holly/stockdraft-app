import "server-only";

import { getAnchors, getLatestPrices } from "@/lib/pricing/read";

/**
 * Contest-facing prices, served from the price log.
 *
 * SDDFS and SDWFS each used to carry their own copy of a provider chain —
 * a warm-cache read, a cold Finnhub call, a separate CoinGecko call, and a
 * write-back into `stock_prices` so the next tick would find it warm. All of
 * that existed because each contest had to solve "get me a price right now"
 * by itself. The logger solves it once for the whole system, on a schedule,
 * and writes down what it got. There is nothing left for a contest to do but
 * read.
 *
 * The old contract is preserved exactly: the returned map has an entry for
 * every symbol requested, and a symbol with no usable price maps to 0, which
 * is what every caller already tests for. Zero cannot be a real price — the
 * log's own constraint forbids storing one — so a zero here always means
 * "absent" and never "worthless."
 */
export type ContestPriceMap = Record<string, number>;

function emptyFor(symbols: readonly string[]): ContestPriceMap {
  const out: ContestPriceMap = {};
  for (const s of symbols) out[s] = 0;
  return out;
}

function normalize(symbols: readonly string[]): string[] {
  return [...new Set((symbols ?? []).map((s) => String(s).toUpperCase()).filter(Boolean))];
}

function report(context: string, missing: readonly string[]) {
  if (missing.length === 0) return;
  const shown = missing.slice(0, 10).join(", ");
  const more = missing.length > 10 ? ` (+${missing.length - 10} more)` : "";
  console.warn(`[contest-quotes] ${context}: no usable price in the log for ${shown}${more}`);
}

/**
 * Most recent price the log holds for each symbol.
 *
 * For live views — an in-progress leaderboard, a mid-week preview. NOT for
 * settling: a contest settles against the anchor for its own session, which
 * is `fetchContestAnchors` below. Settling against "whatever was latest"
 * is how a Friday close ends up scored at a Tuesday price.
 */
export async function fetchContestQuotesFromLog(
  symbols: readonly string[],
  context = "live"
): Promise<ContestPriceMap> {
  const unique = normalize(symbols);
  if (unique.length === 0) return {};

  const lookup = await getLatestPrices(unique);
  const prices = emptyFor(unique);
  for (const [symbol, hit] of lookup.hits) prices[symbol] = hit.price;

  report(context, [...lookup.misses.keys()]);
  return prices;
}

/**
 * The open or close anchor for a specific session date — the price a contest
 * actually settles on. Same 0-means-absent contract.
 */
export async function fetchContestAnchors(
  symbols: readonly string[],
  sessionDate: string,
  kind: "open" | "close",
  context = "settle"
): Promise<ContestPriceMap> {
  const unique = normalize(symbols);
  if (unique.length === 0) return {};

  const lookup = await getAnchors(unique, sessionDate, kind);
  const prices = emptyFor(unique);
  for (const [symbol, hit] of lookup.hits) prices[symbol] = hit.price;

  report(`${context} ${kind} ${sessionDate}`, [...lookup.misses.keys()]);
  return prices;
}
