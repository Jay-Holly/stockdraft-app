import {
  fetchCachedCryptoQuotes,
  fetchCachedStockQuotes,
} from "@/lib/market/cached-prices";
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
 * What replaced them is a fallback that returns a *real* price rather than a
 * remembered one: anything the table cannot answer for is fetched live from
 * Finnhub and written straight back into the table. So the gap closes for
 * everyone who asks next, and the cost is one call the first time a symbol is
 * missing rather than one call per reader.
 *
 * That distinction is the whole point. A fallback is not the problem — going
 * without a price is its own kind of failure, and no league should break
 * because one symbol is late. The problem was only ever *what* the fallback
 * returned: a frozen snapshot is indistinguishable from a live quote
 * downstream, so it turned an outage into a wrong number that nothing could
 * detect. A live fetch has no such flaw, and if it fails too then the symbol
 * really is unavailable and saying so is the only honest option left.
 *
 * This is the same table the DFS contests read, so ordinary traffic costs no
 * API calls at all. With the refresh cron covering the pool plus everything
 * held, the live path should almost never fire — which is exactly why it is
 * affordable to have it there for when it does.
 */
export async function fetchStockQuotes(
  symbols: string[]
): Promise<Map<string, { price: number; changePercent: number }>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  const map = new Map<string, { price: number; changePercent: number }>();

  if (unique.length === 0) return map;

  const cached = await fetchCachedStockQuotes(unique);
  const missing: string[] = [];

  for (const symbol of unique) {
    const quote = cached[symbol];
    if (quote?.price) {
      map.set(symbol, {
        price: quote.price,
        changePercent: quote.changePercent,
      });
      continue;
    }
    missing.push(symbol);
  }

  if (missing.length === 0) return map;

  const recovered = await backfillMissingStockQuotes(missing);
  for (const [symbol, quote] of Object.entries(recovered)) {
    map.set(symbol, quote);
  }

  const unresolved = missing.filter((symbol) => !map.has(symbol));
  if (unresolved.length > 0) {
    console.error(
      `[stock-quotes] ${unresolved.join(", ")} missing from the price table and unquotable live — genuinely unavailable`
    );
  }

  return map;
}

/**
 * Fetches symbols the shared table is missing and puts them back into it.
 *
 * Writing back is what keeps this cheap: the first reader to notice a gap
 * repairs it, so the second reader is served from the table like any other
 * symbol. Without it, a symbol the refresh cron has lost would cost a Finnhub
 * call on every roster view for as long as it stayed lost.
 *
 * Capped per call. If a large number of symbols are missing at once the cause
 * is the refresh cron, not these symbols, and firing hundreds of quote
 * requests from a page render would turn one broken cron into a rate-limit
 * outage across every product sharing the key.
 */
const MAX_LIVE_BACKFILL_SYMBOLS = 12;

async function backfillMissingStockQuotes(
  symbols: string[]
): Promise<Record<string, { price: number; changePercent: number }>> {
  const batch = symbols.slice(0, MAX_LIVE_BACKFILL_SYMBOLS);
  const out: Record<string, { price: number; changePercent: number }> = {};

  try {
    const { fetchFinnhubQuotes } = await import("@/lib/finnhub/service");
    const quotes = await fetchFinnhubQuotes(batch, { cache: "no-store" });

    const rows: Array<{
      symbol: string;
      price: number;
      change_percent: number;
      updated_at: string;
    }> = [];
    const now = new Date().toISOString();

    for (const symbol of batch) {
      const quote = quotes[symbol];
      const price = Number(quote?.price ?? 0);
      if (!(price > 0)) continue;

      const changePercent = Number(quote?.changePercent ?? 0);
      out[symbol] = { price, changePercent };
      rows.push({
        symbol,
        price,
        change_percent: changePercent,
        updated_at: now,
      });
    }

    if (rows.length > 0) {
      const { createServiceClient } = await import("@/lib/supabase/service");
      const { error } = await createServiceClient()
        .from("stock_prices")
        .upsert(rows, { onConflict: "symbol" });

      if (error) {
        // The price is still good even if we could not cache it; the next
        // reader just pays for another fetch.
        console.warn(
          `[stock-quotes] recovered ${rows.length} price(s) but could not write them back: ${error.message}`
        );
      } else {
        console.warn(
          `[stock-quotes] filled ${rows.map((r) => r.symbol).join(", ")} from Finnhub and repaired the shared table`
        );
      }
    }

    if (symbols.length > batch.length) {
      console.error(
        `[stock-quotes] ${symbols.length} symbols missing from the price table — only recovered ${batch.length}; the refresh cron is likely not running`
      );
    }
  } catch (err) {
    console.error(
      "[stock-quotes] live recovery failed:",
      err instanceof Error ? err.message : err
    );
  }

  return out;
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
 * A coin the table is missing is fetched live from CoinGecko instead — a real
 * current price rather than a remembered one. The reference price stays as the
 * very last resort, used only when the live read fails too, and it says so in
 * the log so a stale figure on screen can be recognised for what it is. That
 * ordering is the point: a fallback that returns a real number costs nothing
 * in trust, while one that returns a remembered number is indistinguishable
 * from a live quote and quietly becomes a baseline.
 */
export async function getCryptoQuotesMap(): Promise<
  Record<string, { price: number; changePercent: number }>
> {
  await fetchCryptoPool();
  const symbols = getCachedCryptoPool().map((coin) => coin.symbol);
  const cached = await fetchCachedCryptoQuotes(symbols);
  const quotes: Record<string, { price: number; changePercent: number }> = {};
  const missing: string[] = [];

  for (const symbol of symbols) {
    const quote = cached[symbol];
    if (quote?.price) {
      quotes[symbol] = {
        price: quote.price,
        changePercent: quote.changePercent,
      };
      continue;
    }
    missing.push(symbol);
  }

  if (missing.length === 0) return quotes;

  try {
    const { fetchCryptoQuotes } = await import("@/lib/coingecko/service");
    const live = await fetchCryptoQuotes();
    for (const symbol of missing) {
      const price = Number(live[symbol]?.price ?? 0);
      if (price > 0) {
        quotes[symbol] = {
          price,
          changePercent: Number(live[symbol]?.changePercent ?? 0),
        };
      }
    }
  } catch (err) {
    console.error(
      "[crypto-quotes] live recovery failed:",
      err instanceof Error ? err.message : err
    );
  }

  const stillMissing = missing.filter((symbol) => !quotes[symbol]);
  if (stillMissing.length === 0) return quotes;

  // Last resort. A pool reference price is months old by definition, so it is
  // only ever better than nothing — never better than a real quote.
  const references = referenceCryptoQuotes();
  const usedReference: string[] = [];
  const unavailable: string[] = [];

  for (const symbol of stillMissing) {
    const ref = references[symbol];
    if (ref) {
      quotes[symbol] = ref;
      usedReference.push(symbol);
    } else {
      unavailable.push(symbol);
    }
  }

  if (usedReference.length > 0) {
    console.error(
      `[crypto-quotes] ${usedReference.join(", ")} fell back to the pool reference price — STALE, both the table and CoinGecko failed`
    );
  }
  if (unavailable.length > 0) {
    console.error(
      `[crypto-quotes] ${unavailable.join(", ")} genuinely unavailable — no table row, no live quote, no reference`
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
