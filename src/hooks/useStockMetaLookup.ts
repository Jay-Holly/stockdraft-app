"use client";

import { useMemo } from "react";
import { useDraftPool } from "@/hooks/useDraftPool";
import { CRYPTO_DISPLAY_NAMES } from "@/lib/market/draft-pool";
import { isCryptoSymbol } from "@/lib/draft/engine";
import type { StockDetailMeta } from "@/components/market/StockDetailModal";

export function useStockMetaLookup() {
  const { stocks } = useDraftPool();

  const lookup = useMemo(() => {
    const map = new Map<string, StockDetailMeta>();
    for (const stock of stocks) {
      map.set(stock.symbol.toUpperCase(), {
        name: stock.name,
        sector: stock.sector,
      });
    }
    for (const [symbol, name] of Object.entries(CRYPTO_DISPLAY_NAMES)) {
      map.set(symbol, { name, sector: "Crypto" });
    }
    return map;
  }, [stocks]);

  function getMeta(symbol: string): StockDetailMeta {
    const upper = symbol.toUpperCase();
    return (
      lookup.get(upper) ?? {
        name: isCryptoSymbol(upper)
          ? CRYPTO_DISPLAY_NAMES[upper] ?? upper
          : upper,
        sector: isCryptoSymbol(upper) ? "Crypto" : undefined,
      }
    );
  }

  return { getMeta, lookup };
}
