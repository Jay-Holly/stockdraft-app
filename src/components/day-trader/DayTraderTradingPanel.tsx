"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { DayTraderLeaderboardLinks } from "@/components/day-trader/DayTraderLeaderboardLinks";
import { formatPct, formatSignedMoney } from "@/lib/format";
import { DAY_TRADER_MAX_POSITIONS } from "@/lib/day-trader/constants";

type PositionView = {
  id: string;
  symbol: string;
  shares: number;
  slotOrder: number;
  price: number;
  marketValue: number;
  dailyGainPercent: number;
  dailyDollarGain: number;
  weekGainPercent: number;
  weekDollarGain: number;
};

type PortfolioView = {
  entryId: string;
  cashBalance: number;
  startingValue: number;
  totalValue: number;
  dollarGain: number;
  percentGain: number;
  positionCount: number;
  positions: PositionView[];
};

type SearchResult = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
};

type DayTraderTradingPanelProps = {
  initialPortfolio: PortfolioView;
  canTrade: boolean;
  tradingOpen: boolean;
  contestStatus: string | null;
};

function formatPortfolioMoney(value: number): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function gainTone(value: number): string {
  return value >= 0 ? "text-green-400" : "text-red-400";
}

function PositionGainStats({ position }: { position: PositionView }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1 text-xs">
      <div>
        <p className="text-muted">Daily</p>
        <p className={gainTone(position.dailyGainPercent)}>
          {formatPct(position.dailyGainPercent)}
          <span className="text-muted font-normal">
            {" "}
            · {formatSignedMoney(position.dailyDollarGain)}
          </span>
        </p>
      </div>
      <div>
        <p className="text-muted">Weekly</p>
        <p className={gainTone(position.weekGainPercent)}>
          {formatPct(position.weekGainPercent)}
          <span className="text-muted font-normal">
            {" "}
            · {formatSignedMoney(position.weekDollarGain)}
          </span>
        </p>
      </div>
    </div>
  );
}

export function DayTraderTradingPanel({
  initialPortfolio,
  canTrade,
  tradingOpen,
  contestStatus,
}: DayTraderTradingPanelProps) {
  const router = useRouter();
  const [portfolio, setPortfolio] = useState(initialPortfolio);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [buyAmount, setBuyAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPortfolio(initialPortfolio);
  }, [initialPortfolio]);

  const heldSymbols = useMemo(
    () => new Set(portfolio.positions.map((position) => position.symbol)),
    [portfolio.positions]
  );

  const selectedQuote = useMemo(
    () => searchResults.find((result) => result.symbol === selectedSymbol),
    [searchResults, selectedSymbol]
  );

  const atSymbolCap =
    portfolio.positionCount >= DAY_TRADER_MAX_POSITIONS &&
    (!selectedSymbol || !heldSymbols.has(selectedSymbol));

  const tradingDisabled = !canTrade;

  function tradingBlockedMessage(): string {
    if (contestStatus === "upcoming") {
      return "Portfolio locked until trading opens Monday 9:30 AM ET.";
    }
    if (!tradingOpen) {
      return "Trading is closed outside Mon–Fri, 9:30 AM – 4:00 PM ET.";
    }
    return "Trading is unavailable right now.";
  }

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < 1) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const response = await fetch(
        `/api/market/search?q=${encodeURIComponent(q)}`
      );
      const payload = (await response.json()) as {
        results?: SearchResult[];
      };
      setSearchResults(payload.results ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runSearch(searchQuery);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery, runSearch]);

  async function submitTrade(body: {
    side: "buy" | "sell";
    symbol: string;
    notional?: number;
    shares?: number | null;
  }) {
    setBusy(`${body.side}:${body.symbol}`);
    setError(null);

    try {
      const response = await fetch("/api/day-trader/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        error?: string;
        portfolio?: PortfolioView;
      };

      if (!response.ok || !payload.portfolio) {
        setError(payload.error ?? "Trade failed.");
        return;
      }

      setPortfolio(payload.portfolio);
      if (body.side === "buy") {
        setBuyAmount("");
        setSelectedSymbol(null);
        setSearchQuery("");
        setSearchResults([]);
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleBuy(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSymbol) {
      setError("Pick a stock to buy.");
      return;
    }

    const notional = Number(buyAmount);
    if (!Number.isFinite(notional) || notional <= 0) {
      setError("Enter a valid dollar amount.");
      return;
    }

    await submitTrade({
      side: "buy",
      symbol: selectedSymbol,
      notional,
    });
  }

  async function handleSellAll(symbol: string) {
    await submitTrade({ side: "sell", symbol, shares: null });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gold/30 bg-gold/5 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted">Portfolio value</p>
            <p className="font-semibold">
              ${portfolio.totalValue.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Cash</p>
            <p className="font-semibold">
              ${portfolio.cashBalance.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">$ Gain</p>
            <p
              className={
                portfolio.dollarGain >= 0 ? "text-emerald-400" : "text-red-400"
              }
            >
              {formatPortfolioMoney(portfolio.dollarGain)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">% Gain</p>
            <p
              className={
                portfolio.percentGain >= 0 ? "text-emerald-400" : "text-red-400"
              }
            >
              {formatPct(portfolio.percentGain)}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted">
          {portfolio.positionCount}/{DAY_TRADER_MAX_POSITIONS} stock positions
        </p>
      </div>

      <DayTraderLeaderboardLinks />

      {tradingDisabled ? (
        <div className="rounded-xl border border-dark-border p-4 text-sm text-muted">
          {tradingBlockedMessage()}
        </div>
      ) : null}

      <div className="rounded-xl border border-dark-border bg-dark/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold">Your positions</h2>
        {portfolio.positions.length === 0 ? (
          <p className="text-sm text-muted">No open stock positions.</p>
        ) : (
          <div className="space-y-3">
            {portfolio.positions.map((position) => (
              <div
                key={position.id}
                className="rounded-lg border border-dark-border bg-dark/60 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <p className="font-semibold">{position.symbol}</p>
                      <p className="text-xs text-muted">
                        {position.shares.toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}{" "}
                        sh @ $
                        {position.price.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <PositionGainStats position={position} />
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <p className="text-sm font-semibold whitespace-nowrap">
                      $
                      {position.marketValue.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-w-[4.5rem] px-3"
                      disabled={tradingDisabled || busy !== null}
                      onClick={() => void handleSellAll(position.symbol)}
                    >
                      {busy === `sell:${position.symbol}` ? "Selling…" : "Sell"}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-dark-border bg-dark/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold">Buy stock</h2>
        <p className="text-xs text-muted">
          Sells credit cash at the current market price. Buys spend available
          cash. Max {DAY_TRADER_MAX_POSITIONS} symbols at once.
        </p>

        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value.toUpperCase())}
          placeholder="Search ticker (e.g. AAPL)"
          disabled={tradingDisabled || busy !== null}
          className="w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-sm"
        />

        {searchLoading ? (
          <p className="text-xs text-muted">Searching…</p>
        ) : null}

        {searchResults.length > 0 ? (
          <div className="space-y-2">
            {searchResults.map((result) => {
              const disabled =
                tradingDisabled ||
                busy !== null ||
                (atSymbolCap && !heldSymbols.has(result.symbol));

              return (
                <button
                  key={result.symbol}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedSymbol(result.symbol)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedSymbol === result.symbol
                      ? "border-gold bg-gold/10"
                      : "border-dark-border bg-dark/60 hover:border-gold/40"
                  } disabled:opacity-50`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{result.symbol}</span>
                    <span>
                      $
                      {result.price.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-muted truncate">{result.name}</p>
                </button>
              );
            })}
          </div>
        ) : null}

        {selectedQuote ? (
          <p className="text-xs text-muted">
            Selected {selectedQuote.symbol} @ $
            {selectedQuote.price.toFixed(2)}
          </p>
        ) : null}

        {atSymbolCap ? (
          <p className="text-xs text-amber-400">
            You hold {DAY_TRADER_MAX_POSITIONS} symbols. Sell one before buying
            a new ticker (you can still add to existing holdings).
          </p>
        ) : null}

        <form onSubmit={handleBuy} className="space-y-3">
          <input
            type="number"
            min="0"
            step="0.01"
            value={buyAmount}
            onChange={(event) => setBuyAmount(event.target.value)}
            placeholder="Dollar amount to spend"
            disabled={
              tradingDisabled ||
              busy !== null ||
              !selectedSymbol ||
              (atSymbolCap && !!selectedSymbol && !heldSymbols.has(selectedSymbol))
            }
            className="w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-sm"
          />
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={
              tradingDisabled ||
              busy !== null ||
              !selectedSymbol ||
              (atSymbolCap && !!selectedSymbol && !heldSymbols.has(selectedSymbol))
            }
          >
            {busy?.startsWith("buy:") ? "Buying…" : "Buy"}
          </Button>
        </form>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
