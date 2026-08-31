"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDraftPool } from "@/hooks/useDraftPool";
import { useCryptoPool } from "@/hooks/useCryptoPool";
import { usePoolQuotes } from "@/hooks/usePoolQuotes";
import { useCryptoQuotes } from "@/hooks/useCryptoQuotes";
import { DRAFT_POOL_SECTORS, filterDraftPoolStocks } from "@/lib/market/draft-pool";
import type { MarketQuote } from "@/lib/market/types";
import { EntryErrorNotice } from "@/components/identity/EntryErrorNotice";

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

const REUSE_LINEUP_KEY = "sddfs-reuse-picks";

export function DfsLineupBuilder({ contestId }: { contestId: string }) {
  const router = useRouter();
  const { stocks, loading: poolLoading } = useDraftPool();
  const { coins, loading: cryptoLoading } = useCryptoPool();
  const [activeSector, setActiveSector] = useState<DfsSector>(DFS_SECTORS[0]);
  const [picks, setPicks] = useState<Partial<Record<DfsSector, DfsPick>>>({});
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [lastEntryPicks, setLastEntryPicks] = useState<
    { sector: string; symbol: string }[] | null
  >(null);
  const [pickListWarning, setPickListWarning] = useState<string | null>(null);

  const validStockSymbols = useMemo(
    () => new Set(stocks.map((s) => s.symbol.toUpperCase())),
    [stocks]
  );
  const validCryptoSymbols = useMemo(
    () => new Set(coins.map((c) => c.symbol.toUpperCase())),
    [coins]
  );

  /**
   * Applies a saved sector/symbol list from "Bet Lineup Again" or "Use
   * Yesterday's Lineup" — the two paths that replay a prior entry's picks.
   *
   * A symbol on that list is only as good as it was on the day it was drafted.
   * On 2026-08-17, EA — pulled from the draft pool three days earlier as a
   * dead ticker — was replayed straight back into a lineup and submitted,
   * because this function checked that the *sector* was still valid and never
   * checked the *symbol*. The lock's dead-ticker guard caught it at pricing
   * time and left the pick scoreless, which is the right outcome for a price
   * that can't be trusted — but the entry should never have accepted a symbol
   * that no longer exists in the pool in the first place.
   *
   * Requires the live pool to have already loaded. Called before that finishes,
   * every symbol would fail validation and the whole lineup would be silently
   * dropped — which is a different, worse silent failure than the one being
   * fixed. Both call sites below wait for `poolLoading`/`cryptoLoading` to
   * clear before calling this.
   */
  function applyPickList(list: { sector: string; symbol: string }[]) {
    const dropped: string[] = [];

    setPicks((prev) => {
      const next = { ...prev };
      for (const { sector, symbol } of list) {
        if (!DFS_SECTORS.includes(sector as DfsSector)) continue;

        const upperSymbol = symbol.toUpperCase();
        const isValid =
          sector === "Crypto"
            ? validCryptoSymbols.has(upperSymbol)
            : validStockSymbols.has(upperSymbol);

        if (!isValid) {
          dropped.push(symbol);
          continue;
        }

        next[sector as DfsSector] = {
          symbol,
          name: "",
          price: 0,
          changePercent: 0,
        };
      }
      return next;
    });

    setPickListWarning(
      dropped.length > 0
        ? `${dropped.join(", ")} ${dropped.length === 1 ? "is" : "are"} no longer available and ${dropped.length === 1 ? "wasn't" : "weren't"} carried over. Pick a replacement below.`
        : null
    );

    const filledSectors = new Set(
      list
        .filter((p) => {
          const upperSymbol = p.symbol.toUpperCase();
          return p.sector === "Crypto"
            ? validCryptoSymbols.has(upperSymbol)
            : validStockSymbols.has(upperSymbol);
        })
        .map((p) => p.sector)
    );
    const nextUnfilled = DFS_SECTORS.find((s) => !filledSectors.has(s));
    if (nextUnfilled) setActiveSector(nextUnfilled);
  }

  // Pick up a lineup carried over from "Bet Lineup Again" on another contest.
  // Waits for the pool to load — applying against an empty pool would reject
  // every symbol and silently wipe the carried-over lineup.
  useEffect(() => {
    if (poolLoading || cryptoLoading) return;
    const raw = sessionStorage.getItem(REUSE_LINEUP_KEY);
    if (!raw) return;
    sessionStorage.removeItem(REUSE_LINEUP_KEY);
    try {
      const list = JSON.parse(raw) as { sector: string; symbol: string }[];
      applyPickList(list);
    } catch {
      // ignore malformed storage value
    }
  }, [poolLoading, cryptoLoading]);

  // Look up the most recent past entry so "Use Yesterday's Lineup" can offer it.
  useEffect(() => {
    fetch(`/api/sddfs/last-entry?excludeContestId=${contestId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.picks?.length) setLastEntryPicks(data.picks);
      })
      .catch(() => {});
  }, [contestId]);

  const stockSymbols = useMemo(() => stocks.map((s) => s.symbol), [stocks]);
  const cryptoSymbols = useMemo(() => coins.map((c) => c.symbol), [coins]);

  const { quotes: stockQuotes } = usePoolQuotes(stockSymbols);
  const { quotes: cryptoQuotes } = useCryptoQuotes(cryptoSymbols);

  // Fill in live price/change for picks carried over without quote data.
  useEffect(() => {
    setPicks((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const sector of DFS_SECTORS) {
        const pick = next[sector];
        if (pick && pick.price === 0) {
          const quote =
            sector === "Crypto"
              ? cryptoQuotes[pick.symbol]
              : stockQuotes[pick.symbol];
          if (quote) {
            next[sector] = { ...pick, price: quote.price, changePercent: quote.changePercent };
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [stockQuotes, cryptoQuotes]);

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
    setPickListWarning(null);
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

  function betLineupAgain() {
    sessionStorage.setItem(
      REUSE_LINEUP_KEY,
      JSON.stringify(
        DFS_SECTORS.map((sector) => ({ sector, symbol: picks[sector]!.symbol }))
      )
    );
    router.push("/stockduel-dfs");
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
          <div className="space-y-2">
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-center text-green-400 font-semibold">
              You&apos;re entered!
            </div>
            <button
              type="button"
              onClick={betLineupAgain}
              className="w-full rounded-xl border border-gold text-gold font-semibold py-3 hover:bg-gold/10"
            >
              Bet Lineup Again
            </button>
          </div>
        ) : (
          <>
            {filledCount === 0 && lastEntryPicks && (
              <button
                type="button"
                disabled={poolLoading || cryptoLoading}
                onClick={() => applyPickList(lastEntryPicks)}
                className="w-full rounded-xl border border-white/20 text-sm font-medium py-2.5 hover:border-white/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Use Yesterday&apos;s Lineup
              </button>
            )}
            {pickListWarning && (
              <p className="text-sm text-amber-400" role="alert">
                {pickListWarning}
              </p>
            )}
            <button
              type="button"
              disabled={!lineupComplete || submitting}
              onClick={submitLineup}
              className="w-full rounded-xl bg-gold text-black font-semibold py-3 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-95"
            >
              {submitting ? "Entering..." : "Enter Team"}
            </button>
          </>
        )}
        {submitError && <EntryErrorNotice error={submitError} />}
      </div>
    </div>
  );
}
