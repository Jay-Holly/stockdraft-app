/**
 * Quotes for every league — served entirely from the price log.
 *
 * This file used to call Finnhub and CoinGecko directly, and so did SDDFS,
 * SDWFS and the season leagues, each on its own. Three independent paths to
 * the same providers meant three chances to get a different number for the
 * same stock at the same moment, and no record anywhere of which number was
 * actually used — which is why a wrong score could never be traced afterward.
 *
 * Now there is one path. The logger sweeps the pool on a schedule and writes
 * every observation to `price_log`; everything downstream reads what it wrote.
 * No league pings a provider, ever. That is both the correctness fix (one
 * number, written down, with its source and timestamp attached) and the cost
 * fix (one sweep of 552 symbols, not a provider call per page view).
 *
 * ── About the zero ────────────────────────────────────────────────────────
 * These functions return `{ price: 0 }` when the log has no usable price.
 * That is deliberate and it is NOT the "$0 scored the week as -100%" bug
 * coming back:
 *
 *   - Zero is the sentinel every existing caller already checks for. They
 *     guard with `price <= 0` / `if (price > 0)`, never with a null check —
 *     verified across all ten call sites. Returning null instead would slip
 *     past those guards as `undefined` and land in arithmetic as NaN.
 *   - Zero can never be a real price here. The database rejects a price of
 *     zero outright (089's `price > 0` constraint), so a zero out of this
 *     module always means "absent" and never "the market said so."
 *   - Every zero is logged with the reason the log gave, so a missing price
 *     is visible in the server log instead of silently becoming a score.
 *
 * Scoring code that must distinguish "no price" from "a price" — anything
 * that settles a contest or pays out — should not use this file at all. It
 * should read `@/lib/pricing/read` directly, where a miss is a miss and
 * cannot be mistaken for a number.
 */

import { getLatestPrices, type PriceHit } from "@/lib/pricing/read";
import { fetchCryptoPool } from "@/lib/crypto-pool/server";
import { isCryptoSymbol } from "@/lib/draft/engine";

export type SimpleQuote = { price: number; changePercent: number };

/** The absent-price sentinel. See the note above — zero means "no data." */
const NO_QUOTE: SimpleQuote = { price: 0, changePercent: 0 };

function toQuote(hit: PriceHit | undefined): SimpleQuote {
  if (!hit) return NO_QUOTE;
  return { price: hit.price, changePercent: hit.changePercent ?? 0 };
}

function warnMissing(context: string, symbols: readonly string[], detail?: string) {
  if (symbols.length === 0) return;
  const shown = symbols.slice(0, 8).join(", ");
  const more = symbols.length > 8 ? ` (+${symbols.length - 8} more)` : "";
  console.warn(
    `[quotes] ${context}: no usable price in the log for ${shown}${more}` +
      (detail ? ` — ${detail}` : "")
  );
}

export function computeGainPercent(from: number, to: number): number {
  if (typeof from !== "number" || !(from > 0) || typeof to !== "number" || !Number.isFinite(to)) return 0;
  return ((to - from) / from) * 100;
}

export function computeSharesFromBudget(budget: number, price: number): number {
  if (typeof price !== "number" || !(price > 0) || typeof budget !== "number") return 0;
  return budget / price;
}

/**
 * Latest known price for a batch of stocks, keyed by uppercase symbol.
 *
 * Symbols with no usable price are OMITTED from the map rather than mapped to
 * zero. Callers iterate this map to build portfolios, and an absent key is the
 * shape they already handle; a zero-valued entry would be counted as a real
 * holding worth nothing.
 */
export async function fetchStockQuotes(
  symbols: readonly string[]
): Promise<Map<string, SimpleQuote>> {
  const list = [...new Set((symbols ?? []).map((s) => String(s).toUpperCase()))].filter(Boolean);
  if (list.length === 0) return new Map();

  const lookup = await getLatestPrices(list);
  const out = new Map<string, SimpleQuote>();
  for (const [symbol, hit] of lookup.hits) {
    out.set(symbol, { price: hit.price, changePercent: hit.changePercent ?? 0 });
  }
  warnMissing("fetchStockQuotes", [...lookup.misses.keys()]);
  return out;
}

async function oneQuote(symbol: string, context: string): Promise<SimpleQuote> {
  const upper = String(symbol ?? "").toUpperCase();
  if (!upper) return NO_QUOTE;

  const lookup = await getLatestPrices([upper]);
  const hit = lookup.hits.get(upper);
  if (!hit) {
    warnMissing(context, [upper], lookup.misses.get(upper)?.reason);
    return NO_QUOTE;
  }
  return toQuote(hit);
}

export async function getStockQuote(symbol: string): Promise<SimpleQuote> {
  return oneQuote(symbol, "getStockQuote");
}

export async function getCryptoQuote(symbol: string): Promise<SimpleQuote> {
  return oneQuote(symbol, "getCryptoQuote");
}

/** Works for either asset class — the log does not care which it is. */
export async function getSymbolQuote(symbol: string): Promise<SimpleQuote> {
  return oneQuote(symbol, "getSymbolQuote");
}

/**
 * Last recorded source for crypto prices, for the admin/audit display.
 * Set by `getCryptoQuotesMap`, read synchronously afterward by
 * `matchup/scoring.ts` — which is why it is module state and not a return
 * value: the caller's signature is synchronous and predates this rebuild.
 */
let lastCryptoSource: string | null = null;

export function getLastCryptoQuoteSource(): string | null {
  return lastCryptoSource;
}

/**
 * Every crypto price the log currently holds, keyed by uppercase symbol.
 *
 * The pool is loaded with the real async loader, never the synchronous cache
 * accessor. That distinction is not style: the sync accessor is only populated
 * as a side effect of some other route having run earlier in the same server
 * process, so on a cold serverless instance it is empty and every crypto
 * symbol silently disappears. That exact bug was found and fixed in the logger
 * on 2026-08-29; it is not being reintroduced here.
 */
export async function getCryptoQuotesMap(): Promise<Record<string, SimpleQuote>> {
  const pool = await fetchCryptoPool();
  const symbols = pool.map((coin) => coin.symbol.toUpperCase()).filter(Boolean);

  if (symbols.length === 0) {
    // An empty pool is a real failure, not an empty market. Say so loudly
    // rather than returning {} and letting every crypto holding vanish.
    console.error("[quotes] crypto pool came back empty — returning no quotes");
    lastCryptoSource = null;
    return {};
  }

  const lookup = await getLatestPrices(symbols);
  const out: Record<string, SimpleQuote> = {};
  const sources = new Set<string>();

  for (const [symbol, hit] of lookup.hits) {
    out[symbol] = { price: hit.price, changePercent: hit.changePercent ?? 0 };
    sources.add(hit.source);
  }

  lastCryptoSource = sources.size === 0 ? null : [...sources].sort().join("+");
  warnMissing("getCryptoQuotesMap", [...lookup.misses.keys()]);
  return out;
}

/**
 * Convenience for callers holding a mixed roster: one round trip for both
 * asset classes instead of one call per symbol. Same omission rule as
 * `fetchStockQuotes` — a symbol with no usable price is simply not present.
 */
export async function getQuotesForSymbols(
  symbols: readonly string[]
): Promise<Map<string, SimpleQuote>> {
  const list = [...new Set((symbols ?? []).map((s) => String(s).toUpperCase()))].filter(Boolean);
  if (list.length === 0) return new Map();

  const lookup = await getLatestPrices(list);
  const out = new Map<string, SimpleQuote>();
  for (const [symbol, hit] of lookup.hits) {
    out.set(symbol, { price: hit.price, changePercent: hit.changePercent ?? 0 });
  }

  const missing = [...lookup.misses.keys()];
  warnMissing("getQuotesForSymbols", missing);
  if (missing.some((s) => isCryptoSymbol(s))) {
    lastCryptoSource = lastCryptoSource ?? null;
  }
  return out;
}
