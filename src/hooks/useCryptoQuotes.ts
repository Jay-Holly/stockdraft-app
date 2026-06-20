"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCryptoQuotes } from "@/lib/coingecko/service";
import { CRYPTO_SYMBOLS } from "@/lib/market/symbols";
import type { MarketQuote } from "@/lib/market/types";

export function useCryptoQuotes() {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/market/crypto");
      if (!response.ok) throw new Error("Failed to fetch crypto");

      const cryptoQuotes = (await response.json()) as Awaited<
        ReturnType<typeof fetchCryptoQuotes>
      >;

      setQuotes((current) => {
        const next = { ...current };
        for (const symbol of CRYPTO_SYMBOLS) {
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
    } catch {
      setError("Unable to refresh crypto prices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const orderedQuotes = useMemo(
    () =>
      CRYPTO_SYMBOLS.map((symbol) => quotes[symbol]).filter(
        (quote): quote is MarketQuote => Boolean(quote)
      ),
    [quotes]
  );

  return { quotes, orderedQuotes, loading, error };
}
