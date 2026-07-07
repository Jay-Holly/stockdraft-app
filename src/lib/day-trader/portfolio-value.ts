import { fetchCachedStockQuotes } from "@/lib/market/cached-prices";
import { getFallbackStockQuote } from "@/lib/market/fallback-quotes";

export type DayTraderStockQuote = {
  price: number;
  changePercent: number;
  prevClose: number;
};

export function computeDayTraderEntryValue(
  cashBalance: number,
  positions: readonly { symbol: string; shares: number }[],
  quotes: Record<string, Pick<DayTraderStockQuote, "price">>
): number {
  let equity = 0;
  for (const position of positions) {
    const quote = quotes[position.symbol.toUpperCase()];
    equity += position.shares * (quote?.price ?? 0);
  }
  return cashBalance + equity;
}

export async function fetchDayTraderPositionQuotes(
  positions: readonly { symbol: string }[]
): Promise<Record<string, DayTraderStockQuote>> {
  const symbols = positions.map((position) => position.symbol);
  const cached = await fetchCachedStockQuotes(symbols);
  const quotes: Record<string, DayTraderStockQuote> = {};

  for (const symbol of symbols.map((value) => value.toUpperCase())) {
    const quote = cached[symbol];
    if (quote?.price) {
      quotes[symbol] = {
        price: quote.price,
        changePercent: quote.changePercent,
        prevClose: quote.prevClose,
      };
      continue;
    }

    const fallback = getFallbackStockQuote(symbol);
    quotes[symbol] = {
      price: fallback?.price ?? 0,
      changePercent: fallback?.changePercent ?? 0,
      prevClose: fallback?.prevClose ?? fallback?.price ?? 0,
    };
  }

  return quotes;
}

export function computeDayTraderFinalMetrics(
  startingValue: number,
  finalValue: number
): { finalDollarGain: number; finalPctGain: number } {
  const finalDollarGain = finalValue - startingValue;
  const finalPctGain =
    startingValue > 0 ? (finalDollarGain / startingValue) * 100 : 0;
  return { finalDollarGain, finalPctGain };
}
