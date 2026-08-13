import {
  fetchCachedCryptoQuotes,
  fetchCachedStockQuotes,
} from "@/lib/market/cached-prices";
import { getFallbackStockQuote } from "@/lib/market/fallback-quotes";
import { fetchCryptoPool, getCachedCryptoPool } from "@/lib/crypto-pool/server";
import { isCryptoSymbol } from "@/lib/draft/engine";

export { getLastCryptoQuoteSource } from "@/lib/coingecko/service";
export type { CryptoQuoteSource } from "@/lib/coingecko/types";

export async function getStockQuote(symbol: string): Promise<{
  price: number;
  changePercent: number;
}> {
  const quotes = await fetchStockQuotes([symbol]);
  return quotes.get(symbol.toUpperCase()) ?? { price: 0, changePercent: 0 };
}

/**
 * Live stock quotes, strict by default.
 *
 * A symbol the warm table cannot answer for comes back **absent**. It used to
 * come back carrying one of two stand-ins, and both were the same mistake in
 * different clothing:
 *
 *   1. a bundled JSON snapshot of ~400 S&P quotes committed to the repo with
 *      no capture date — measured 2026-08-13 it drifts 11% on average, with
 *      MSFT off by 23.6% and TSLA by 17.8%;
 *   2. failing that, price_at_pick — the literal price on the day the stock
 *      was drafted, months back.
 *
 * fetchPricesForPicks sits directly above this and its comment forbids exactly
 * that: "never substitute the draft-day price… gets persisted as a baseline,
 * silently scoring the week against a months-old price." Its `livePrice > 0`
 * guard could never enforce it, because the substitution happened in here,
 * below the guard, and produced a plausible non-zero number.
 *
 * This is what made scores jump between two reads of the same roster seconds
 * apart, and what let two people looking at one contest at one moment see
 * different totals: whether the warm table holds a symbol varies request to
 * request, so one read got $496.88 for MSFT and the next got $379.40 from the
 * bundle. Nothing logged it, because as far as every layer above was concerned
 * the fetch had succeeded.
 *
 * Persisting callers must take the strict default — day-trader entry already
 * refuses to open a position on a missing price, and now that refusal can
 * actually fire. Display callers may pass `allowStaleFallback` to keep a
 * figure on screen, and should expect it to be stale.
 */
export async function fetchStockQuotes(
  symbols: string[],
  options?: { allowStaleFallback?: boolean }
): Promise<Map<string, { price: number; changePercent: number }>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  const map = new Map<string, { price: number; changePercent: number }>();

  if (unique.length === 0) return map;

  const cached = await fetchCachedStockQuotes(unique);
  const stillMissing: string[] = [];

  for (const symbol of unique) {
    const quote = cached[symbol];
    if (quote?.price) {
      map.set(symbol, {
        price: quote.price,
        changePercent: quote.changePercent,
      });
      continue;
    }

    if (options?.allowStaleFallback) {
      const fallback = getFallbackStockQuote(symbol);
      if (fallback?.price) {
        map.set(symbol, {
          price: fallback.price,
          changePercent: fallback.changePercent,
        });
        continue;
      }
    }

    stillMissing.push(symbol);
  }

  if (stillMissing.length === 0) return map;

  if (!options?.allowStaleFallback) {
    console.warn(
      `[stock-quotes] no live quote for ${stillMissing.join(", ")} — left unpriced rather than substituted`
    );
    return map;
  }

  // Display-only last resort: the price on the day the stock was drafted.
  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("draft_picks")
    .select("symbol, price_at_pick")
    .in("symbol", stillMissing)
    .order("created_at", { ascending: false })
    .limit(stillMissing.length);

  const dbPrices = new Map<string, number>();
  for (const row of data ?? []) {
    if (!dbPrices.has(row.symbol.toUpperCase()) && row.price_at_pick) {
      dbPrices.set(row.symbol.toUpperCase(), row.price_at_pick);
    }
  }

  for (const symbol of stillMissing) {
    const dbPrice = dbPrices.get(symbol);
    if (dbPrice) map.set(symbol, { price: dbPrice, changePercent: 0 });
  }

  return map;
}

function referenceCryptoQuotes(): Record<
  string,
  { price: number; changePercent: number }
> {
  const quotes: Record<string, { price: number; changePercent: number }> = {};
  for (const coin of getCachedCryptoPool()) {
    if (coin.referencePriceUsd != null && coin.referencePriceUsd > 0) {
      quotes[coin.symbol] = {
        price: coin.referencePriceUsd,
        changePercent: 0,
      };
    }
  }
  return quotes;
}

/**
 * Live crypto quotes, strict by default.
 *
 * A coin with no usable quote comes back **absent**, not filled in from the
 * pool's reference price. That substitution is the dangerous kind: the pool's
 * reference_price_usd is a snapshot from the day the pool was built, and as of
 * 2026-08-13 more than half the pool sits over 10% away from it (LAB is off by
 * 99%). Because a reference price is a plausible non-zero number, it sails
 * through every `price > 0` guard downstream — including the one in
 * fetchPricesForPicks, whose comment forbids exactly this substitution — and
 * gets persisted as a weekly baseline. The week then scores against a
 * months-old price with nothing anywhere to show it happened.
 *
 * Callers that merely display a number may pass `allowReferenceFallback` to
 * get the old behaviour, because a stale figure on screen is recoverable and
 * an empty slot looks broken. Anything that persists must not: leaving the
 * symbol absent is what lets the caller skip it.
 */
export async function getCryptoQuotesMap(
  options?: { allowReferenceFallback?: boolean }
): Promise<Record<string, { price: number; changePercent: number }>> {
  await fetchCryptoPool();
  const symbols = getCachedCryptoPool().map((coin) => coin.symbol);
  const cached = await fetchCachedCryptoQuotes(symbols);
  const quotes: Record<string, { price: number; changePercent: number }> = {};
  const unpriced: string[] = [];

  const references = options?.allowReferenceFallback
    ? referenceCryptoQuotes()
    : null;

  for (const symbol of symbols) {
    const quote = cached[symbol];
    if (quote?.price) {
      quotes[symbol] = {
        price: quote.price,
        changePercent: quote.changePercent,
      };
      continue;
    }

    const ref = references?.[symbol];
    if (ref) {
      quotes[symbol] = ref;
      continue;
    }
    unpriced.push(symbol);
  }

  if (unpriced.length > 0) {
    console.warn(
      `[crypto-quotes] no live quote for ${unpriced.join(", ")} — left unpriced${
        options?.allowReferenceFallback ? " (no reference price either)" : ""
      }`
    );
  }

  return quotes;
}

export async function getCryptoQuote(symbol: string): Promise<{
  price: number;
  changePercent: number;
}> {
  const quotes = await getCryptoQuotesMap();
  const key = symbol.toUpperCase();
  const q = quotes[key];
  return {
    price: q?.price ?? 0,
    changePercent: q?.changePercent ?? 0,
  };
}

export async function getSymbolQuote(symbol: string): Promise<{
  price: number;
  changePercent: number;
}> {
  if (isCryptoSymbol(symbol)) return getCryptoQuote(symbol);
  return getStockQuote(symbol);
}

export function computeSharesFromBudget(budget: number, price: number): number {
  if (price <= 0 || budget <= 0) return 0;
  return budget / price;
}

export function computeGainPercent(
  budgetSpent: number,
  currentValue: number
): number {
  if (budgetSpent <= 0) return 0;
  return ((currentValue - budgetSpent) / budgetSpent) * 100;
}
