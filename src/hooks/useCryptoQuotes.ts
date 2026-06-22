"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CRYPTO_LIVE_CACHE_TTL_MS } from "@/lib/coingecko/constants";
import type { MarketQuote } from "@/lib/market/types";

/** Match server-side CoinGecko throttle — avoid redundant /api/market/crypto polls. */
const CLIENT_REFRESH_MS = CRYPTO_LIVE_CACHE_TTL_MS;

export function useCryptoQuotes(symbols: string[]) {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const symbolKey = useMemo(
    () => [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].sort().join(","),
    [symbols]
  );

  const refresh = useCallback(async () => {
    if (!symbolKey) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/market/crypto");
      if (!response.ok) throw new Error("Failed to fetch crypto");

      const cryptoQuotes = (await response.json()) as Record<
        string,
        { price: number; changePercent: number }
      >;

      setQuotes((current) => {
        const next = { ...current };
        for (const symbol of symbolKey.split(",").filter(Boolean)) {
          const quote = cryptoQuotes[symbol];
          if (!quote) continue;
          next[symbol] = {
            symbol,
            price: quote.price,
            changePercent: quote.changePercent,
            assetType: "crypto",
            updatedAt: Date.now(),
          };
        }
        return next;
      });
      setError(null);
    } catch {
      setError("Unable to refresh crypto prices.");
    } finally {
      setLoading(false);
    }
  }, [symbolKey]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), CLIENT_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const orderedQuotes = useMemo(
    () =>
      symbols
        .map((symbol) => quotes[symbol.toUpperCase()])
        .filter((quote): quote is MarketQuote => Boolean(quote)),
    [quotes, symbols]
  );

  return { quotes, orderedQuotes, loading, error };
}
