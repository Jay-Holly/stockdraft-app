import fallbackData from "@/data/sp500-fallback-quotes.json";

export type FallbackQuote = {
  price: number;
  prevClose: number;
  changePercent: number;
};

const FALLBACK_QUOTES = (fallbackData.quotes ?? {}) as Record<
  string,
  FallbackQuote
>;

export function getFallbackStockQuote(symbol: string): FallbackQuote | null {
  return FALLBACK_QUOTES[symbol.toUpperCase()] ?? null;
}

/** Bundled S&P snapshot symbols — used when the draft_pool table is empty/unreachable. */
export function listFallbackPoolSymbols(): string[] {
  return Object.keys(FALLBACK_QUOTES);
}

export function mergeQuotesWithFallback<
  T extends { price: number; prevClose: number; changePercent: number },
>(symbols: string[], live: Record<string, T>): Record<string, T> {
  const merged = { ...live };

  for (const symbol of symbols) {
    const upper = symbol.toUpperCase();
    if (merged[upper]) continue;
    const fallback = getFallbackStockQuote(upper);
    if (fallback) {
      merged[upper] = fallback as T;
    }
  }

  return merged;
}
