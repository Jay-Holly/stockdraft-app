"use client";

import { useMemo, useState } from "react";
import { useDraftPool } from "@/hooks/useDraftPool";
import { useCryptoPool } from "@/hooks/useCryptoPool";
import { usePoolQuotes } from "@/hooks/usePoolQuotes";
import { useCryptoQuotes } from "@/hooks/useCryptoQuotes";
import {
  filterDraftPoolStocks,
  type DraftPoolSector,
} from "@/lib/market/draft-pool";
import type { MarketQuote } from "@/lib/market/types";
import type { MyWfsEntry } from "@/lib/wfs/my-teams";

function formatPrice(price: number) {
  return price > 0 ? `$${price.toFixed(2)}` : "—";
}

function formatChange(changePercent: number) {
  const sign = changePercent > 0 ? "+" : "";
  return `${sign}${changePercent.toFixed(1)}%`;
}

export function WfsFreeAgentPanel({ entries }: { entries: MyWfsEntry[] }) {
  const [selectedEntryId, setSelectedEntryId] = useState(
    entries[0]?.entryId ?? ""
  );
  const [swapSector, setSwapSector] = useState<
    DraftPoolSector | "Crypto" | null
  >(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entryPicks, setEntryPicks] = useState(() => {
    const map: Record<string, { sector: string; symbol: string }[]> = {};
    for (const entry of entries) {
      map[entry.entryId] = entry.picks.map((p) => ({
        sector: p.sector,
        symbol: p.symbol,
      }));
    }
    return map;
  });

  const { stocks, loading: poolLoading } = useDraftPool();
  const { coins, loading: cryptoLoading } = useCryptoPool();
  const stockSymbols = useMemo(() => stocks.map((s) => s.symbol), [stocks]);
  const cryptoSymbols = useMemo(() => coins.map((c) => c.symbol), [coins]);
  const { quotes: stockQuotes } = usePoolQuotes(stockSymbols);
  const { quotes: cryptoQuotes } = useCryptoQuotes(cryptoSymbols);

  const selectedEntry = entries.find((e) => e.entryId === selectedEntryId);
  const picks = entryPicks[selectedEntryId] ?? [];

  const visibleStocks =
    swapSector && swapSector !== "Crypto"
      ? filterDraftPoolStocks(stocks, { filter: swapSector, query })
      : [];

  const visibleCoins = coins.filter((coin) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      coin.symbol.toLowerCase().includes(q) ||
      coin.name.toLowerCase().includes(q)
    );
  });

  async function makeMove(sector: string, quote: MarketQuote) {
    if (!selectedEntry || saving) return;
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/sdwfs/swap-pick", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: selectedEntry.entryId,
          sector,
          symbol: quote.symbol,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not save your move.");
        return;
      }

      setEntryPicks((prev) => ({
        ...prev,
        [selectedEntry.entryId]: prev[selectedEntry.entryId].map((p) =>
          p.sector === sector ? { ...p, symbol: quote.symbol } : p
        ),
      }));
      setSwapSector(null);
      setQuery("");
    } catch {
      setError("Could not save your move.");
    } finally {
      setSaving(false);
    }
  }

  if (entries.length === 0) {
    return (
      <div className="bg-dark-card border border-white/10 rounded-xl p-8 text-center text-muted">
        Enter a contest from the lobby to make roster moves here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {entries.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {entries.map((entry) => (
            <button
              key={entry.entryId}
              type="button"
              onClick={() => {
                setSelectedEntryId(entry.entryId);
                setSwapSector(null);
              }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                entry.entryId === selectedEntryId
                  ? "bg-gold text-black border-gold"
                  : "border-white/20 text-muted hover:border-white/40"
              }`}
            >
              {entry.contestName} — {entry.weekStartDate}
            </button>
          ))}
        </div>
      )}

      {selectedEntry && selectedEntry.contestStatus !== "open" && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center text-muted text-sm">
          This contest is {selectedEntry.contestStatus} — moves are no longer
          allowed.
        </div>
      )}

      <div className="bg-dark-card border border-white/10 rounded-xl divide-y divide-white/5">
        {picks.map((pick) => (
          <div key={pick.sector} className="flex items-center justify-between p-3">
            <div>
              <div className="text-xs text-muted">{pick.sector}</div>
              <div className="font-semibold">{pick.symbol}</div>
            </div>
            {selectedEntry?.contestStatus === "open" && (
              <button
                type="button"
                onClick={() => {
                  setSwapSector(pick.sector as DraftPoolSector | "Crypto");
                  setQuery("");
                }}
                className="text-sm text-gold hover:underline"
              >
                Make Move
              </button>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm text-center">{error}</p>}

      {swapSector && (
        <div className="bg-dark-card border border-gold/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Swap {swapSector}</h3>
            <button
              type="button"
              onClick={() => setSwapSector(null)}
              className="text-sm text-muted hover:underline"
            >
              Cancel
            </button>
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker or company name..."
            className="w-full rounded-lg bg-dark-card border border-white/10 px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:border-gold/60"
          />

          <div className="max-h-[50vh] overflow-y-auto divide-y divide-white/5">
            {swapSector === "Crypto"
              ? (cryptoLoading ? (
                  <p className="p-4 text-muted text-sm">Loading crypto...</p>
                ) : (
                  visibleCoins.map((coin) => {
                    const quote = cryptoQuotes[coin.symbol];
                    return (
                      <button
                        key={coin.symbol}
                        type="button"
                        disabled={!quote || saving}
                        onClick={() => quote && makeMove("Crypto", quote)}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5"
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
                ))
              : poolLoading ? (
                  <p className="p-4 text-muted text-sm">Loading stocks...</p>
                ) : (
                  visibleStocks.map((stock) => {
                    const quote = stockQuotes[stock.symbol];
                    return (
                      <button
                        key={stock.symbol}
                        type="button"
                        disabled={!quote || saving}
                        onClick={() => quote && makeMove(swapSector, quote)}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5"
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
      )}
    </div>
  );
}
