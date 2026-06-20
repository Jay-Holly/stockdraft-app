"use client";

import { useMemo } from "react";
import { useCryptoQuotes } from "@/hooks/useCryptoQuotes";
import { useRosterLivePrices } from "@/hooks/useRosterLivePrices";
import type { MarketQuote, MarketSession } from "@/lib/market/types";

/**
 * Dashboard ticker: crypto + platform-rostered stocks only.
 * WebSocket streams apply only to rostered stocks during market hours.
 */
export function useLiveMarketData() {
  const roster = useRosterLivePrices();
  const crypto = useCryptoQuotes();

  const orderedQuotes = useMemo(() => {
    const merged: Record<string, MarketQuote> = { ...roster.quotes };
    for (const [symbol, quote] of Object.entries(crypto.quotes)) {
      merged[symbol] = quote;
    }
    return Object.values(merged);
  }, [crypto.quotes, roster.quotes]);

  return {
    quotes: orderedQuotes,
    session: roster.session as MarketSession,
    loading: roster.loading || crypto.loading,
    error: roster.error ?? crypto.error,
  };
}
