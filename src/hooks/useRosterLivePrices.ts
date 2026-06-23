"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFinnhubService } from "@/lib/finnhub/service";
import { getMarketSession } from "@/lib/market/hours";
import type { MarketQuote, MarketSession } from "@/lib/market/types";

type RosteredResponse = {
  symbols: string[];
  quotes?: Record<
    string,
    { price: number; prevClose: number; changePercent: number }
  >;
};

function buildStockQuote(
  symbol: string,
  price: number,
  prevClose: number
): MarketQuote {
  const changePercent =
    prevClose === 0 ? 0 : ((price - prevClose) / prevClose) * 100;

  return {
    symbol,
    price,
    changePercent,
    assetType: "stock",
    updatedAt: Date.now(),
  };
}

/** Live prices via WebSocket only for platform-rostered stocks. */
export function useRosterLivePrices() {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
  const [rosteredSymbols, setRosteredSymbols] = useState<string[]>([]);
  const [session, setSession] = useState<MarketSession>("static");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevCloseRef = useRef<Record<string, number>>({});

  const applyQuotes = useCallback(
    (
      symbols: string[],
      data: Record<
        string,
        { price: number; prevClose: number; changePercent: number }
      >
    ) => {
      const nextPrevClose = { ...prevCloseRef.current };
      const next: Record<string, MarketQuote> = {};

      for (const symbol of symbols) {
        const quote = data[symbol];
        if (!quote) continue;
        nextPrevClose[symbol] = quote.prevClose;
        next[symbol] = buildStockQuote(symbol, quote.price, quote.prevClose);
      }

      prevCloseRef.current = nextPrevClose;
      setQuotes(next);
    },
    []
  );

  const loadRostered = useCallback(async () => {
    const response = await fetch("/api/market/rostered");
    if (!response.ok) throw new Error("Failed to load rostered symbols");
    const data = (await response.json()) as RosteredResponse;
    const symbols = data.symbols ?? [];
    setRosteredSymbols(symbols);
    if (data.quotes) {
      applyQuotes(symbols, data.quotes);
    }
    return symbols;
  }, [applyQuotes]);

  const refreshQuotes = useCallback(
    async (symbols: string[]) => {
      if (symbols.length === 0) {
        setQuotes({});
        return;
      }

      const response = await fetch("/api/market/rostered");
      if (!response.ok) throw new Error("Failed to fetch roster quotes");

      const data = (await response.json()) as RosteredResponse;
      applyQuotes(symbols, data.quotes ?? {});
    },
    [applyQuotes]
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError(null);
      try {
        await loadRostered();
      } catch {
        if (!cancelled) setError("Unable to load roster live prices.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init();
    const interval = window.setInterval(() => {
      void loadRostered();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [loadRostered]);

  useEffect(() => {
    const updateSession = () => setSession(getMarketSession());
    updateSession();
    const interval = window.setInterval(updateSession, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const service = getFinnhubService();

    if (session !== "live" || rosteredSymbols.length === 0) {
      service.setSubscriptions([]);
      service.disconnect();
      return;
    }

    service.setSubscriptions(rosteredSymbols);
    service.connect();

    const unsubscribe = service.onTrade((symbol, price) => {
      const prevClose = prevCloseRef.current[symbol] ?? price;
      setQuotes((current) => ({
        ...current,
        [symbol]: buildStockQuote(symbol, price, prevClose),
      }));
    });

    return () => {
      unsubscribe();
      service.setSubscriptions([]);
      service.disconnect();
    };
  }, [session, rosteredSymbols]);

  useEffect(() => {
    if (session === "live") return;

    const interval = window.setInterval(() => {
      void refreshQuotes(rosteredSymbols);
    }, 5 * 60_000);

    return () => window.clearInterval(interval);
  }, [refreshQuotes, rosteredSymbols, session]);

  const orderedQuotes = useMemo(
    () =>
      rosteredSymbols
        .map((symbol) => quotes[symbol])
        .filter((quote): quote is MarketQuote => Boolean(quote)),
    [quotes, rosteredSymbols]
  );

  return {
    quotes,
    orderedQuotes,
    rosteredSymbols,
    session,
    loading,
    error,
  };
}
