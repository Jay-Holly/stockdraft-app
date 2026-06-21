"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getFallbackStockQuote } from "@/lib/market/fallback-quotes";
import type { MarketQuote } from "@/lib/market/types";

function buildStockQuote(
  symbol: string,
  price: number,
  prevClose: number,
  changePercent?: number
): MarketQuote {
  const change =
    changePercent ??
    (prevClose === 0 ? 0 : ((price - prevClose) / prevClose) * 100);

  return {
    symbol,
    price,
    changePercent: change,
    assetType: "stock",
    updatedAt: Date.now(),
  };
}

export function usePoolQuotes(symbols: string[]) {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const symbolKey = useMemo(
    () => [...new Set(symbols.map((s) => s.toUpperCase()))].sort().join(","),
    [symbols]
  );

  const refresh = useCallback(async () => {
    const list = symbolKey.split(",").filter(Boolean);
    if (list.length === 0) {
      setQuotes({});
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const merged: Record<string, MarketQuote> = {};
      const chunkSize = 25;

      for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);
        const response = await fetch(
          `/api/market/stocks?symbols=${encodeURIComponent(chunk.join(","))}`
        );
        if (!response.ok) throw new Error("Failed to fetch pool quotes");

        const data = (await response.json()) as Record<
          string,
          { price: number; prevClose: number; changePercent: number }
        >;

        for (const symbol of chunk) {
          const quote = data[symbol];
          if (!quote) continue;
          merged[symbol] = buildStockQuote(
            symbol,
            quote.price,
            quote.prevClose,
            quote.changePercent
          );
        }
      }

      for (const symbol of list) {
        if (merged[symbol]) continue;
        const fallback = getFallbackStockQuote(symbol);
        if (!fallback) continue;
        merged[symbol] = buildStockQuote(
          symbol,
          fallback.price,
          fallback.prevClose,
          fallback.changePercent
        );
      }

      setQuotes(merged);
    } catch {
      const merged: Record<string, MarketQuote> = {};
      for (const symbol of list) {
        const fallback = getFallbackStockQuote(symbol);
        if (!fallback) continue;
        merged[symbol] = buildStockQuote(
          symbol,
          fallback.price,
          fallback.prevClose,
          fallback.changePercent
        );
      }
      setQuotes(merged);
      if (Object.keys(merged).length === 0) {
        setError("Unable to load stock prices for this view.");
      }
    } finally {
      setLoading(false);
    }
  }, [symbolKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const orderedQuotes = useMemo(
    () =>
      symbolKey
        .split(",")
        .filter(Boolean)
        .map((symbol) => quotes[symbol])
        .filter((quote): quote is MarketQuote => Boolean(quote)),
    [quotes, symbolKey]
  );

  return { quotes, orderedQuotes, loading, error, refresh };
}
