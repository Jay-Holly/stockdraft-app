import {
  fetchCachedCryptoQuotes,
  fetchCachedStockQuotes,
} from "@/lib/market/cached-prices";
import { getFallbackStockQuote } from "@/lib/market/fallback-quotes";
import { fetchCryptoPool, getCachedCryptoPool } from "@/lib/crypto-pool/server";
import { isCryptoSymbol } from "@/lib/draft/engine";

export async function getStockQuote(symbol: string): Promise<{
  price: number;
  changePercent: number;
}> {
  const quotes = await fetchStockQuotes([symbol]);
  return quotes.get(symbol.toUpperCase()) ?? { price: 0, changePercent: 0 };
}

export async function fetchStockQuotes(
  symbols: string[]
): Promise<Map<string, { price: number; changePercent: number }>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  const map = new Map<string, { price: number; changePercent: number }>();

  if (unique.length === 0) return map;

  const cached = await fetchCachedStockQuotes(unique);
  for (const symbol of unique) {
    const quote = cached[symbol];
    if (quote?.price) {
      map.set(symbol, {
        price: quote.price,
        changePercent: quote.changePercent,
      });
      continue;
    }
    const fallback = getFallbackStockQuote(symbol);
    map.set(symbol, {
      price: fallback?.price ?? 0,
      changePercent: fallback?.changePercent ?? 0,
    });
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

export async function getCryptoQuotesMap(): Promise<
  Record<string, { price: number; changePercent: number }>
> {
  await fetchCryptoPool();
  const symbols = getCachedCryptoPool().map((coin) => coin.symbol);
  const cached = await fetchCachedCryptoQuotes(symbols);
  const quotes: Record<string, { price: number; changePercent: number }> = {};

  for (const symbol of symbols) {
    const quote = cached[symbol];
    if (quote?.price) {
      quotes[symbol] = {
        price: quote.price,
        changePercent: quote.changePercent,
      };
      continue;
    }
    const ref = referenceCryptoQuotes()[symbol];
    quotes[symbol] = ref ?? { price: 0, changePercent: 0 };
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
