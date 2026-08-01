import type { DraftPick } from "@/lib/draft/types";
import { isCryptoSymbol } from "@/lib/draft/engine";
import {
  fetchStockQuotes,
  getCryptoQuotesMap,
} from "@/lib/roster/quotes";
import type { CryptoQuote } from "@/lib/coingecko/service";
import { pickMarketValue } from "@/lib/roster/weekly";

export type WeekBaselineRow = {
  valueAtOpen: number;
  valueAtClose: number | null;
  stockValueAtFridayClose: number | null;
};

export async function fetchLivePricesForPicks(
  picks: DraftPick[]
): Promise<Map<string, number>> {
  const stockSymbols = picks
    .filter((p) => !isCryptoSymbol(p.symbol))
    .map((p) => p.symbol);
  const needsCrypto = picks.some((p) => isCryptoSymbol(p.symbol));

  const [stockQuotes, cryptoQuotes] = await Promise.all([
    fetchStockQuotes(stockSymbols),
    needsCrypto
      ? getCryptoQuotesMap()
      : Promise.resolve({} as Record<string, CryptoQuote>),
  ]);

  // A failed quote leaves the symbol absent rather than substituting the
  // draft-day price — see fetchPricesForPicks in lib/roster/weekly.ts.
  const prices = new Map<string, number>();
  for (const pick of picks) {
    const symbol = pick.symbol.toUpperCase();
    if (prices.has(symbol)) continue;

    const livePrice = isCryptoSymbol(symbol)
      ? (cryptoQuotes[symbol]?.price ?? 0)
      : (stockQuotes.get(symbol)?.price ?? 0);

    if (livePrice > 0) prices.set(symbol, livePrice);
  }

  return prices;
}

/** Stocks use Friday close value; crypto uses live prices. */
export function resolveHybridScoringValue(
  pick: DraftPick,
  livePrices: Map<string, number>,
  baseline: WeekBaselineRow | undefined,
  useHybrid: boolean
): number {
  const symbol = pick.symbol.toUpperCase();

  if (
    useHybrid &&
    pick.pick_type === "stock" &&
    baseline?.stockValueAtFridayClose != null &&
    baseline.stockValueAtFridayClose > 0
  ) {
    return baseline.stockValueAtFridayClose;
  }

  const price = livePrices.get(symbol);
  if (price == null) {
    // Quote unavailable: score the pick flat against its own open rather than
    // against the draft-day price, which would report a months-old move as
    // this week's. Neutral is the honest answer until a quote comes back.
    return baseline?.valueAtOpen ?? 0;
  }
  return pickMarketValue(pick, price);
}

export function baselinesHaveFridayClose(
  baselineMap: Map<string, WeekBaselineRow>
): boolean {
  for (const row of baselineMap.values()) {
    if (row.stockValueAtFridayClose != null) return true;
  }
  return false;
}
