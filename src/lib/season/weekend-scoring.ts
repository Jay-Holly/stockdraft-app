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

  const draftPriceBySymbol = new Map<string, number>();
  for (const pick of picks) {
    const symbol = pick.symbol.toUpperCase();
    if (pick.price_at_pick > 0 && !draftPriceBySymbol.has(symbol)) {
      draftPriceBySymbol.set(symbol, pick.price_at_pick);
    }
  }

  const prices = new Map<string, number>();
  for (const pick of picks) {
    const symbol = pick.symbol.toUpperCase();
    if (prices.has(symbol)) continue;

    if (isCryptoSymbol(symbol)) {
      const livePrice = cryptoQuotes[symbol]?.price ?? 0;
      prices.set(
        symbol,
        livePrice > 0 ? livePrice : (draftPriceBySymbol.get(symbol) ?? 0)
      );
    } else {
      prices.set(symbol, stockQuotes.get(symbol)?.price ?? 0);
    }
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
    baseline?.stockValueAtFridayClose != null
  ) {
    return baseline.stockValueAtFridayClose;
  }

  const price = livePrices.get(symbol) ?? pick.price_at_pick;
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
