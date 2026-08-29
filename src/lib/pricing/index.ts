import "server-only";

import { isCryptoSymbol } from "@/lib/draft/engine";
import { isUsMarketOpen } from "@/lib/market/hours";
import {
  fetchCoinGeckoPrices,
  fetchFinnhubPrices,
  successesOf,
} from "@/lib/pricing/providers";
import { readStoredPrices, writeStoredPrices } from "@/lib/pricing/store";
import {
  Freshness,
  PriceBook,
  available,
  unavailable,
  type FreshnessMs,
  type PriceLookup,
} from "@/lib/pricing/types";

export { Freshness, PriceBook } from "@/lib/pricing/types";
export type { Price, PriceLookup, PriceFailure } from "@/lib/pricing/types";

/**
 * The one way to get a price.
 *
 * Everything in the app asks this function and states how fresh an answer it
 * needs. Nothing else reads the price tables and nothing else calls a market
 * data provider.
 *
 * The shape of a request is always the same:
 *
 *   1. Read what the store already holds.
 *   2. Keep the rows that satisfy THIS caller's freshness requirement.
 *   3. Fetch the rest live, and write them back so the next caller is served
 *      from the store.
 *   4. Report anything still missing, by name and with a reason.
 *
 * Step 2 is the part the old system never had. One shared quote path served a
 * day-trading simulator that needs prices by the second and a season league
 * that needs two a day, with no way for either to say which it was — so the
 * trading path enforced nothing and the lock path enforced 35 minutes, exactly
 * backwards from what each needed.
 */

/**
 * How many symbols a single request may fetch live.
 *
 * A page render that finds 300 symbols missing should not fire 300 provider
 * calls — that turns one broken refresh cron into a rate-limit outage across
 * every product sharing the key. Past the cap, symbols come back as
 * `not-attempted`, which says plainly in the logs that the cause is upstream.
 */
const DEFAULT_MAX_LIVE_FETCH = 25;

/**
 * Wall-clock budget for the live portion of one request.
 *
 * Paced at 50 calls/minute, 25 symbols is ~30 seconds. The deadline exists so
 * a caller inside a serverless function with its own timeout gets a partial
 * book plus an honest list of what was skipped, rather than being killed
 * mid-flight and losing everything it had already resolved.
 */
const DEFAULT_FETCH_BUDGET_MS = 45_000;

/**
 * How stale a closing price may get before we stop trusting it at all.
 *
 * Bounds the market-closed rule below: a Friday close is the freshest price
 * that exists all weekend, but a price from two weeks ago means the symbol
 * stopped trading and should fail rather than be served forever.
 */
const MAX_CLOSED_MARKET_AGE_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Whether a stored price is good enough for this caller.
 *
 * Freshness means "as fresh as it is possible to be", not "recently fetched" —
 * a distinction that cost a full re-fetch cycle to discover. When US equity
 * markets are closed, the 4 PM close IS the current price: no newer one exists
 * anywhere, so re-asking the provider returns the identical value with the
 * identical timestamp, which is still stale by a wall-clock rule, so the caller
 * asks again. That loop burns the API all night and never succeeds. Treating a
 * closing price as fresh while the market is shut is not a leniency, it is the
 * correct reading of what freshness means.
 *
 * Crypto never gets this exemption — those markets don't close, so a stale
 * crypto price is genuinely stale.
 */
function storedPriceSatisfies(
  price: { asOf: Date },
  maxAge: FreshnessMs,
  asset: "stock" | "crypto",
  now: Date
): boolean {
  const ageMs = now.getTime() - price.asOf.getTime();

  if (ageMs <= maxAge) return true;
  if (asset === "crypto") return false;
  if (isUsMarketOpen(now)) return false;

  return ageMs <= MAX_CLOSED_MARKET_AGE_MS;
}

export type GetPricesOptions = {
  /** How old a stored price may be. Use a `Freshness` constant. */
  maxAge: FreshnessMs;
  /** Cap on live provider calls for this request. */
  maxLiveFetch?: number;
  /** Wall-clock budget for the live portion. */
  budgetMs?: number;
  /**
   * Skip live fetching entirely and answer only from the store. For read-only
   * surfaces that would rather render a gap than spend quota.
   */
  storeOnly?: boolean;
};

export async function getPrices(
  symbols: readonly string[],
  options: GetPricesOptions
): Promise<PriceBook> {
  const asked = [
    ...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ];
  const entries = new Map<string, PriceLookup>();

  if (asked.length === 0) return new PriceBook(entries, asked);

  const now = new Date();
  const stocks = asked.filter((s) => !isCryptoSymbol(s));
  const crypto = asked.filter((s) => isCryptoSymbol(s));

  const [storedStocks, storedCrypto] = await Promise.all([
    stocks.length > 0
      ? readStoredPrices(stocks, "stock")
      : Promise.resolve(new Map()),
    crypto.length > 0
      ? readStoredPrices(crypto, "crypto")
      : Promise.resolve(new Map()),
  ]);

  const staleStocks: string[] = [];
  const staleCrypto: string[] = [];

  for (const symbol of stocks) {
    const stored = storedStocks.get(symbol);
    if (stored && storedPriceSatisfies(stored, options.maxAge, "stock", now)) {
      entries.set(symbol, available(stored));
    } else {
      staleStocks.push(symbol);
    }
  }

  for (const symbol of crypto) {
    const stored = storedCrypto.get(symbol);
    if (stored && storedPriceSatisfies(stored, options.maxAge, "crypto", now)) {
      entries.set(symbol, available(stored));
    } else {
      staleCrypto.push(symbol);
    }
  }

  const missing = [...staleStocks, ...staleCrypto];
  if (missing.length === 0) return new PriceBook(entries, asked);

  if (options.storeOnly) {
    for (const symbol of missing) {
      entries.set(
        symbol,
        unavailable(
          symbol,
          "too-stale",
          `${symbol}: no price within ${Math.round(options.maxAge / 1000)}s and live fetching was disabled`
        )
      );
    }
    return new PriceBook(entries, asked);
  }

  const cap = options.maxLiveFetch ?? DEFAULT_MAX_LIVE_FETCH;
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_FETCH_BUDGET_MS);

  // Crypto is fetched first and costs one call for any number of coins, so it
  // is not charged against the per-symbol cap.
  if (staleCrypto.length > 0) {
    const fetched = await fetchCoinGeckoPrices(staleCrypto);
    for (const [symbol, lookup] of fetched) entries.set(symbol, lookup);

    const good = successesOf(fetched.values());
    if (good.length > 0) await writeStoredPrices(good, "crypto");
  }

  if (staleStocks.length > 0) {
    const attempting = staleStocks.slice(0, cap);
    const skipped = staleStocks.slice(cap);

    const fetched = await fetchFinnhubPrices(attempting, { deadline });
    for (const [symbol, lookup] of fetched) entries.set(symbol, lookup);

    const good = successesOf(fetched.values());
    if (good.length > 0) await writeStoredPrices(good, "stock");

    for (const symbol of skipped) {
      entries.set(
        symbol,
        unavailable(
          symbol,
          "not-attempted",
          `${symbol}: over the ${cap}-symbol live fetch cap for one request`
        )
      );
    }

    if (skipped.length > 0) {
      console.error(
        `[pricing] ${staleStocks.length} stale symbols but only ${cap} may be fetched live — the refresh cron is likely behind`
      );
    }
  }

  const book = new PriceBook(entries, asked);

  const gaps = book.describeGaps();
  if (gaps) console.warn(`[pricing] ${gaps}`);

  return book;
}

/** Single-symbol convenience. Returns the lookup, never a bare number. */
export async function getPrice(
  symbol: string,
  options: GetPricesOptions
): Promise<PriceLookup> {
  const book = await getPrices([symbol], options);
  return book.lookup(symbol);
}

/**
 * Prices for a live trade. Sixty seconds or nothing.
 *
 * Day Trader executes buys and sells against this. A stale price here is not
 * merely inaccurate — a symbol that moved after the last refresh could be
 * traded at the old price until the store caught up, which in a contest with
 * prizes is an exploit rather than a rounding error. Refusing the trade is the
 * correct outcome when no current price exists.
 */
export function getLivePrice(symbol: string): Promise<PriceLookup> {
  return getPrice(symbol, { maxAge: Freshness.LIVE, maxLiveFetch: 1 });
}
