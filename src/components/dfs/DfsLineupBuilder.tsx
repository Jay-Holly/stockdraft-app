"use client";

import { useMemo, useState } from "react";
import { useDraftPool } from "@/hooks/useDraftPool";
import { useCryptoPool } from "@/hooks/useCryptoPool";
import { usePoolQuotes } from "@/hooks/usePoolQuotes";
import { useCryptoQuotes } from "@/hooks/useCryptoQuotes";
import { DRAFT_POOL_SECTORS, filterDraftPoolStocks } from "@/lib/market/draft-pool";
import type { MarketQuote } from "@/lib/market/types";

/** The 12 DFS lineup slots: every GICS sector plus Crypto. */
const DFS_SECTORS = [
  ...DRAFT_POOL_SECTORS.filter((s) => s !== "All"),
  "Crypto",
] as const;

type DfsSector = (typeof DFS_SECTORS)[number];

type DfsPick = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
};

function formatPrice(price: number) {
  return price > 0 ? `$${price.toFixed(2)}` : "—";
}

function formatChange(changePercent: number) {
  const sign = changePercent > 0 ? "+" : "";
  return `${sign}${changePercent.toFixed(1)}%`;
}

export function DfsLineupBuilder({ contestId }: { contestId: string }) {
  const { stocks, loading: poolLoading } = useDraftPool();
  const { coins, loading: cryptoLoading } = useCryptoPool();
  const [activeSector, setActiveSector] = useState<DfsSector>(DFS_SECTORS[0]);
  const [picks, setPicks] = useState<Partial<Record<DfsSector, DfsPick>>>({});
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);

  const stockSymbols = useMemo(() => stocks.map((s) => s.symbol), [stocks]);
  const cryptoSymbols = useMemo(() => coins.map((c) => c.symbol), [coins]);

  const { quotes: stockQuotes } = usePoolQuotes(stockSymbols);
  const { quotes: cryptoQuotes } = useCryptoQuotes(cryptoSymbols);

  const pickedSymbols = useMemo(
    () => new Set(Object.values(picks).map((p) => p!.symbol)),
    [picks]
  );

  const visibleStocks =
    activeSector === "Crypto"
      ? []
      : filterDraftPoolStocks(stocks, { filter: activeSector, query });

  const visibleCoins = coins.filter((coin) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      coin.symbol.toLowerCase().includes(q) ||
      coin.name.toLowerCase().includes(q)
    );
  });

  function selectPick(sector: DfsSector, quote: MarketQuote, name: string) {
    setPicks((prev) => {
      const next = {
        ...prev,
        [sector]: {
          symbol: quote.symbol,
          name,
          price: quote.price,
          changePercent: quote.changePercent,
        },
      };
      const nextUnfilled = DFS_SECTORS.find((s) => !next[s]);
      if (nextUnfilled) setActiveSector(nextUnfilled);
      return next;
    });
  }

  const filledCount = Object.keys(picks).length;
  const lineupComplete = filledCount === DFS_SECTORS.length;

  async function submitLineup() {
    if (!lineupComplete || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/api/sddfs/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contestId,
          picks: DFS_SECTORS.map((sector) => ({
            sector,
            symbol: picks[sector]!.symbol,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setSubmitError(data.error ?? "Could not enter contest.");
        return;
      }
      setEntered(true);
    } catch {
      setSubmitError("Could not enter contest.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {DFS_SECTORS.map((sector) => {
            const isActive = sector === activeSector;
            const isFilled = Boolean(picks[sector]);
            return (
              <button
                key={sector}
                type="button"
                onClick={() => setActiveSector(sector)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  isActive
                    ? "bg-gold text-black border-gold"
                    : isFilled
                      ? "border-green-500/60 text-green-400"
                      : "border-white/20 text-muted hover:border-white/40"
                }`}
              >
                {sector}
                {isFilled ? " ✓" : ""}
              </button>
            );
          })}
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ticker or company name..."
          className="w-full rounded-lg bg-dark-card border border-white/10 px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:border-gold/60"
        />

        <div className="bg-dark-card border border-white/10 rounded-xl divide-y divide-white/5 max-h-[70vh] overflow-y-auto">
          {activeSector === "Crypto" ? (
            cryptoLoading ? (
              <p className="p-4 text-muted text-sm">Loading crypto...</p>
            ) : (
              visibleCoins.map((coin) => {
                const quote = cryptoQuotes[coin.symbol];
                const isPicked = pickedSymbols.has(coin.symbol);
                return (
                  <button
                    key={coin.symbol}
                    type="button"
                    disabled={!quote}
                    onClick={() =>
                      quote && selectPick("Crypto", quote, coin.name)
                    }
                    className={`w-full flex items-center justify-between p-3 text-left hover:bg-white/5 ${
                      isPicked ? "bg-green-500/10" : ""
                    }`}
                  >
                    <div>
                      <div className="font-semibold">{coin.symbol}</div>
                      <div className="text-xs text-muted">{coin.name}</div>
                    </div>
                    <div className="text-right">
                      <div>{quote ? formatPrice(quote.price) : "—"}</div>
                      <div
                        className={
                          quote && quote.changePercent >= 0
                            ? "text-green-400 text-xs"
                            : "text-red-400 text-xs"
                        }
                      >
                        {quote ? formatChange(quote.changePercent) : ""}
                      </div>
                    </div>
                  </button>
                );
              })
            )
          ) : poolLoading ? (
            <p className="p-4 text-muted text-sm">Loading stocks...</p>
          ) : (
            visibleStocks.map((stock) => {
              const quote = stockQuotes[stock.symbol];
              const isPicked = pickedSymbols.has(stock.symbol);
              return (
                <button
                  key={stock.symbol}
                  type="button"
                  disabled={!quote}
                  onClick={() =>
                    quote && selectPick(activeSector, quote, stock.name)
                  }
                  className={`w-full flex items-center justify-between p-3 text-left hover:bg-white/5 ${
                    isPicked ? "bg-green-500/10" : ""
                  }`}
                >
                  <div>
                    <div className="font-semibold">{stock.symbol}</div>
                    <div className="text-xs text-muted">{stock.name}</div>
                  </div>
                  <div className="text-right">
                    <div>{quote ? formatPrice(quote.price) : "—"}</div>
                    <div
                      className={
                        quote && quote.changePercent >= 0
                          ? "text-green-400 text-xs"
                          : "text-red-400 text-xs"
                      }
                    >
                      {quote ? formatChange(quote.changePercent) : ""}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="bg-dark-card border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Live Draft Feed</h3>
            <span className="text-xs text-muted">{filledCount} / 12</span>
          </div>
          <div className="space-y-2">
            {DFS_SECTORS.map((sector) => {
              const pick = picks[sector];
              return (
                <div
                  key={sector}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                    pick
                      ? "bg-green-500/10 border border-green-500/30"
                      : "bg-white/5 border border-white/10 text-muted"
                  }`}
                >
                  <span>{sector}</span>
                  <span className="font-semibold">
                    {pick ? pick.symbol : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {entered ? (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-center text-green-400 font-semibold">
            You&apos;re entered!
          </div>
        ) : (
          <button
            type="button"
            disabled={!lineupComplete || submitting}
            onClick={submitLineup}
            className="w-full rounded-xl bg-gold text-black font-semibold py-3 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-95"
          >
            {submitting ? "Entering..." : "Enter Team"}
          </button>
        )}
        {submitError && (
          <p className="text-red-400 text-sm text-center">{submitError}</p>
        )}
      </div>
    </div>
  );
}
