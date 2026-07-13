"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney, formatPct } from "@/lib/format";
import type {
  FreeAgentCrypto,
  FreeAgentStock,
  FreeAgentsPageData,
} from "@/lib/roster/types";
import { DRAFT_POOL_SECTORS } from "@/lib/market/draft-pool";
import { Button } from "@/components/Button";
import { SeasonCalendarBanner } from "@/components/season/SeasonCalendarBanner";
import { StockDetailChartButton } from "@/components/market/StockDetailChartButton";

const CRYPTO_ALLOCATION_PRESETS = [10_000, 25_000, 50_000, 100_000];

type CategoryFilter =
  | "All"
  | "Top 50"
  | "Crypto"
  | Exclude<(typeof DRAFT_POOL_SECTORS)[number], "All">;

const FILTER_BUTTONS: CategoryFilter[] = [
  "All",
  "Top 50",
  "Crypto",
  ...DRAFT_POOL_SECTORS.filter(
    (s): s is Exclude<(typeof DRAFT_POOL_SECTORS)[number], "All"> => s !== "All"
  ),
];

function filterButtonLabel(filter: CategoryFilter): string {
  if (filter === "Consumer Discretionary") return "Cons. Disc.";
  if (filter === "Consumer Staples") return "Cons. Staples";
  if (filter === "Communication Services") return "Comm. Svcs.";
  return filter;
}

type SortMode = "default" | "name" | "price";
type PriceDirection = "asc" | "desc";

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function sortByNameThenSymbol<T extends { name: string; symbol: string }>(
  list: T[]
): T[] {
  return [...list].sort(
    (a, b) => compareStrings(a.name, b.name) || compareStrings(a.symbol, b.symbol)
  );
}

function sortByPrice<T extends { price: number; symbol: string }>(
  list: T[],
  direction: PriceDirection
): T[] {
  return [...list].sort((a, b) => {
    if (a.price !== b.price) {
      return direction === "asc" ? a.price - b.price : b.price - a.price;
    }
    return compareStrings(a.symbol, b.symbol);
  });
}

export function FreeAgentsPageContent() {
  const [data, setData] = useState<FreeAgentsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [category, setCategory] = useState<CategoryFilter>("All");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [priceDirection, setPriceDirection] = useState<PriceDirection>("asc");

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [dropPickId, setDropPickId] = useState<string | null>(null);
  const [cryptoAllocation, setCryptoAllocation] = useState(10_000);

  const load = useCallback(async () => {
    const res = await fetch("/api/free-agents", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Could not load free agents");
      setLoading(false);
      return;
    }
    setData(json as FreeAgentsPageData);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const claimSlots = useMemo(() => {
    if (!data) return [];
    return [...data.benchSlots, ...(data.openActiveSlots ?? [])];
  }, [data]);

  const isCryptoView = category === "Crypto";

  const selectedIsCrypto = useMemo(() => {
    if (!selectedSymbol || !data) return false;
    return data.cryptoFreeAgents.some((c) => c.symbol === selectedSymbol);
  }, [selectedSymbol, data]);

  const filteredStocks = useMemo(() => {
    if (!data || isCryptoView) return [];
    const q = query.trim().toUpperCase();
    let list = data.freeAgents;

    if (category === "Top 50") {
      list = list
        .filter((s) => s.marketCapRank != null)
        .sort((a, b) => (a.marketCapRank ?? 0) - (b.marketCapRank ?? 0))
        .slice(0, 50);
    } else if (category !== "All") {
      list = list.filter((s) => s.sector === category);
    }

    if (q) {
      list = list.filter(
        (s) =>
          s.symbol.includes(q) ||
          s.name.toUpperCase().includes(q) ||
          s.sector.toUpperCase().includes(q)
      );
    }

    if (sortMode === "name") return sortByNameThenSymbol(list);
    if (sortMode === "price") return sortByPrice(list, priceDirection);
    return list;
  }, [data, isCryptoView, category, query, sortMode, priceDirection]);

  const filteredCrypto = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toUpperCase();
    let list = data.cryptoFreeAgents;

    if (q) {
      list = list.filter(
        (c) => c.symbol.includes(q) || c.name.toUpperCase().includes(q)
      );
    }

    if (sortMode === "name") return sortByNameThenSymbol(list);
    if (sortMode === "price") return sortByPrice(list, priceDirection);
    return list;
  }, [data, query, sortMode, priceDirection]);

  const faClosed = data?.calendar?.freeAgencyOpen === false;

  function selectSymbol(symbol: string, crypto: boolean) {
    setSelectedSymbol((prev) => (prev === symbol ? null : symbol));
    if (crypto && data) {
      setCryptoAllocation(Math.min(10_000, Math.max(data.cryptoRemaining, 1000)));
    }
  }

  async function handleClaim() {
    if (!selectedSymbol || !dropPickId) return;
    setBusy(true);
    setError(null);

    const endpoint = selectedIsCrypto
      ? "/api/free-agents/claim-crypto"
      : "/api/free-agents/claim";
    const body = selectedIsCrypto
      ? {
          droppedPickId: dropPickId,
          symbol: selectedSymbol,
          allocation: cryptoAllocation,
        }
      : { droppedPickId: dropPickId, symbol: selectedSymbol };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Claim failed");
      return;
    }
    setData(json as FreeAgentsPageData);
    setSelectedSymbol(null);
    setDropPickId(null);
  }

  async function handleDropOnly() {
    if (!dropPickId || !data) return;
    const slot = claimSlots.find((s) => s.pickId === dropPickId);
    if (!slot || slot.isOpen || slot.symbol.toUpperCase() === "__OPEN__") {
      return;
    }

    setBusy(true);
    setError(null);
    const res = await fetch("/api/free-agents/drop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ benchPickId: dropPickId }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Drop failed");
      return;
    }
    setData(json as FreeAgentsPageData);
    setSelectedSymbol(null);
  }

  if (loading) {
    return (
      <p className="text-muted text-sm py-12 text-center">Loading free agents…</p>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!data) return null;

  function renderStockRow(stock: FreeAgentStock) {
    const selected = selectedSymbol === stock.symbol;
    return (
      <div
        key={stock.symbol}
        role="button"
        tabIndex={faClosed || busy ? -1 : 0}
        aria-pressed={selected}
        aria-disabled={faClosed || busy}
        className={`draft-pool-row ${selected ? "season-fa-row--selected" : ""}`}
        onClick={() => {
          if (faClosed || busy) return;
          selectSymbol(stock.symbol, false);
        }}
        onKeyDown={(e) => {
          if (faClosed || busy) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectSymbol(stock.symbol, false);
          }
        }}
      >
        <span className="draft-ticker-badge">{stock.symbol}</span>
        <div className="draft-pool-info">
          <p className="draft-pool-name">{stock.name}</p>
          <p className="draft-pool-meta">
            {stock.marketCapRank != null
              ? `#${stock.marketCapRank} · ${stock.sector}`
              : stock.sector}
          </p>
        </div>
        <div className="draft-pool-price-col">
          <p className="draft-pool-price">{formatMoney(stock.price)}</p>
        </div>
        <p
          className={`draft-pool-chg ${stock.changePercent >= 0 ? "text-green-400" : "text-red-400"}`}
        >
          {formatPct(stock.changePercent)}
        </p>
        <div className="draft-pool-actions">
          <span onClick={(e) => e.stopPropagation()}>
            <StockDetailChartButton symbol={stock.symbol} />
          </span>
          <button
            type="button"
            className="draft-pick-btn"
            disabled={faClosed || busy}
            onClick={(e) => {
              e.stopPropagation();
              selectSymbol(stock.symbol, false);
            }}
          >
            {selected ? "Selected" : "Add"}
          </button>
        </div>
      </div>
    );
  }

  function renderCryptoRow(coin: FreeAgentCrypto) {
    const selected = selectedSymbol === coin.symbol;
    return (
      <div
        key={coin.symbol}
        role="button"
        tabIndex={faClosed || busy ? -1 : 0}
        aria-pressed={selected}
        aria-disabled={faClosed || busy}
        className={`draft-pool-row ${selected ? "season-fa-row--selected" : ""}`}
        onClick={() => {
          if (faClosed || busy) return;
          selectSymbol(coin.symbol, true);
        }}
        onKeyDown={(e) => {
          if (faClosed || busy) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectSymbol(coin.symbol, true);
          }
        }}
      >
        <span className="draft-ticker-badge draft-ticker-badge--crypto">
          {coin.symbol}
        </span>
        <div className="draft-pool-info">
          <p className="draft-pool-name">{coin.name}</p>
          <p className="draft-pool-meta">Crypto</p>
        </div>
        <div className="draft-pool-price-col">
          <p className="draft-pool-price">
            {coin.price > 0 ? formatMoney(coin.price) : "—"}
          </p>
        </div>
        <p
          className={`draft-pool-chg ${coin.changePercent >= 0 ? "text-green-400" : "text-red-400"}`}
        >
          {coin.price > 0 ? formatPct(coin.changePercent) : "—"}
        </p>
        <div className="draft-pool-actions">
          <span onClick={(e) => e.stopPropagation()}>
            <StockDetailChartButton symbol={coin.symbol} />
          </span>
          <button
            type="button"
            className="draft-pick-btn draft-pick-btn--crypto"
            disabled={faClosed || busy || (data?.cryptoRemaining ?? 0) <= 0}
            onClick={(e) => {
              e.stopPropagation();
              selectSymbol(coin.symbol, true);
            }}
          >
            {selected ? "Selected" : "Add"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="season-card">
        <h1 className="text-xl font-bold">Free Agents</h1>
        <p className="text-muted text-sm mt-1">
          Every unrostered S&P 500 stock, plus crypto. Drop a bench player (or use
          an open slot) and add a pickup — promote via IR swap on My Team.
        </p>
      </section>

      <SeasonCalendarBanner calendar={data.calendar} variant="freeAgency" />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="season-card">
        <h2 className="season-card-title">Drop slot</h2>
        <p className="text-xs text-muted mt-1 mb-2">
          Pick a bench player to drop, an empty bench slot, or an open active slot
          opened by an IR move.
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          {claimSlots.map((slot) => (
            <button
              key={slot.pickId}
              type="button"
              className={`season-chip ${dropPickId === slot.pickId ? "season-chip--active" : ""}`}
              disabled={faClosed || busy}
              onClick={() =>
                setDropPickId((prev) =>
                  prev === slot.pickId ? null : slot.pickId
                )
              }
            >
              {slot.isOpen || slot.symbol.toUpperCase() === "__OPEN__"
                ? data.openActiveSlots?.some((s) => s.pickId === slot.pickId)
                  ? "Use open active slot"
                  : "Use open bench slot"
                : `Drop ${slot.symbol}`}
            </button>
          ))}
        </div>
      </section>

      <section className="draft-pool">
        <div className="draft-pool-header">
          <div>
            <h2 className="draft-pool-title">Free Agent Pool</h2>
            <p className="draft-pool-subtitle">
              S&P 500 ({data.freeAgents.length} unrostered) + crypto
            </p>
          </div>
        </div>

        <div className="draft-pool-finnhub">
          <label className="draft-pool-field-label" htmlFor="fa-search">
            Search
          </label>
          <div className="draft-pool-search-row">
            <input
              id="fa-search"
              type="search"
              placeholder="Ticker or company name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="draft-input"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="draft-pool-filters">
          {FILTER_BUTTONS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`draft-filter-btn ${category === filter ? "draft-filter-btn--active" : ""} ${filter === "Top 50" ? "draft-filter-btn--top100" : ""} ${filter === "Crypto" ? "draft-filter-btn--crypto-tab" : ""}`}
              onClick={() => setCategory(filter)}
            >
              {filterButtonLabel(filter)}
            </button>
          ))}
        </div>

        <div className="draft-pool-sorts">
          <span className="draft-pool-sorts-label">Sort</span>
          <div className="draft-pool-sorts-group">
            <button
              type="button"
              className={`draft-filter-btn ${sortMode === "name" ? "draft-filter-btn--active" : ""}`}
              onClick={() =>
                setSortMode((m) => (m === "name" ? "default" : "name"))
              }
            >
              Name A–Z
            </button>
            <button
              type="button"
              className={`draft-filter-btn ${sortMode === "price" ? "draft-filter-btn--active" : ""}`}
              onClick={() => {
                if (sortMode !== "price") {
                  setSortMode("price");
                  setPriceDirection("asc");
                } else {
                  setPriceDirection((d) => (d === "asc" ? "desc" : "asc"));
                }
              }}
            >
              Price{" "}
              {sortMode === "price" && priceDirection === "desc"
                ? "↓ High"
                : "↑ Low"}
            </button>
          </div>
        </div>

        <p className="draft-pool-meta-line">
          {isCryptoView
            ? `${filteredCrypto.length} coins · ${formatMoney(data.cryptoRemaining)} crypto budget left`
            : category === "Top 50"
              ? `Top ${filteredStocks.length} available by market cap`
              : `${filteredStocks.length} available`}
        </p>

        <div className="draft-pool-list">
          {!isCryptoView && filteredStocks.length === 0 && (
            <p className="draft-pool-empty-msg">No stocks match this filter.</p>
          )}
          {!isCryptoView && filteredStocks.map(renderStockRow)}

          {isCryptoView && (
            <>
              <div className="draft-pool-divider">
                Crypto — top {filteredCrypto.length} by market cap
              </div>
              {filteredCrypto.length === 0 && (
                <p className="draft-pool-empty-msg">Crypto pool is empty.</p>
              )}
              {filteredCrypto.map(renderCryptoRow)}
            </>
          )}
        </div>
      </section>

      {selectedIsCrypto && selectedSymbol && (
        <section className="season-card">
          <h2 className="season-card-title">Allocation for {selectedSymbol}</h2>
          <p className="text-xs text-muted mt-1 mb-2">
            {formatMoney(data.cryptoRemaining)} crypto budget remaining
          </p>
          <input
            type="range"
            min={1000}
            max={Math.max(data.cryptoRemaining, 1000)}
            step={1000}
            value={Math.min(cryptoAllocation, Math.max(data.cryptoRemaining, 1000))}
            onChange={(e) => setCryptoAllocation(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex flex-wrap gap-2 mt-2">
            {CRYPTO_ALLOCATION_PRESETS.filter(
              (p) => p <= data.cryptoRemaining
            ).map((preset) => (
              <button
                key={preset}
                type="button"
                className="draft-filter-btn"
                onClick={() => setCryptoAllocation(preset)}
              >
                {formatMoney(preset)}
              </button>
            ))}
            <button
              type="button"
              className="draft-filter-btn draft-filter-btn--active"
              onClick={() => setCryptoAllocation(data.cryptoRemaining)}
            >
              Max
            </button>
          </div>
        </section>
      )}

      {dropPickId &&
        claimSlots.some(
          (s) =>
            s.pickId === dropPickId &&
            !s.isOpen &&
            s.symbol.toUpperCase() !== "__OPEN__"
        ) && (
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy || faClosed}
            onClick={handleDropOnly}
          >
            {busy
              ? "Releasing…"
              : `Release ${
                  claimSlots.find((s) => s.pickId === dropPickId)?.symbol
                } to free agency only`}
          </Button>
        )}

      <Button
        variant="primary"
        className="w-full"
        disabled={
          busy ||
          faClosed ||
          !selectedSymbol ||
          !dropPickId ||
          (selectedIsCrypto && cryptoAllocation <= 0)
        }
        onClick={handleClaim}
      >
        {busy
          ? "Claiming…"
          : faClosed
            ? "Free agency closed"
            : selectedSymbol && dropPickId
              ? `Drop bench · add ${selectedSymbol}`
              : "Select a bench drop and free agent"}
      </Button>
    </div>
  );
}
