"use client";

import { useEffect, useMemo, useState } from "react";
import type { CryptoPoolCoin } from "@/lib/crypto-pool/types";
import type { DraftPoolFilter, DraftPoolStock } from "@/lib/market/draft-pool";
import {
  DRAFT_POOL_FILTER_BUTTONS,
  enrichDraftPoolStocks,
  filterDraftPoolStocks,
  getMarketCapRank,
} from "@/lib/market/draft-pool";
import {
  formatMoney,
  formatShares,
  getSurchargePercent,
  isCryptoSymbol,
  STOCK_BUDGET,
} from "@/lib/draft/engine";
import type { CryptoBuyerCounts, DraftTurn } from "@/lib/draft/types";
import type { MarketQuote } from "@/lib/market/types";
import {
  StockDetailChartButton,
  StockDetailModal,
} from "@/components/market/StockDetailModal";
import {
  getSafetyPickQueuePriority,
  SAFETY_PICK_QUEUE_MAX,
} from "@/lib/draft/safety-queue";

type SearchResult = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
};

type PoolSortMode = "default" | "name" | "price";
type PriceSortDirection = "asc" | "desc";

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function sortPoolStocks(
  stocks: DraftPoolStock[],
  sortMode: PoolSortMode,
  priceDirection: PriceSortDirection,
  getPrice: (symbol: string) => number
): DraftPoolStock[] {
  if (sortMode === "default") return stocks;

  const sorted = [...stocks];
  if (sortMode === "name") {
    sorted.sort((a, b) => {
      const byName = compareStrings(a.name, b.name);
      if (byName !== 0) return byName;
      return compareStrings(a.symbol, b.symbol);
    });
    return sorted;
  }

  sorted.sort((a, b) => {
    const priceA = getPrice(a.symbol);
    const priceB = getPrice(b.symbol);
    const aMissing = priceA <= 0;
    const bMissing = priceB <= 0;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (priceA !== priceB) {
      return priceDirection === "asc" ? priceA - priceB : priceB - priceA;
    }
    return compareStrings(a.symbol, b.symbol);
  });
  return sorted;
}

function sortSearchResults(
  results: SearchResult[],
  sortMode: PoolSortMode,
  priceDirection: PriceSortDirection
): SearchResult[] {
  if (sortMode === "default") return results;

  const sorted = [...results];
  if (sortMode === "name") {
    sorted.sort((a, b) => {
      const byName = compareStrings(a.name, b.name);
      if (byName !== 0) return byName;
      return compareStrings(a.symbol, b.symbol);
    });
    return sorted;
  }

  sorted.sort((a, b) => {
    const priceA = a.price;
    const priceB = b.price;
    const aMissing = priceA <= 0;
    const bMissing = priceB <= 0;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (priceA !== priceB) {
      return priceDirection === "asc" ? priceA - priceB : priceB - priceA;
    }
    return compareStrings(a.symbol, b.symbol);
  });
  return sorted;
}

function sortCryptoSymbols(
  symbols: readonly string[],
  nameBySymbol: Record<string, string>,
  sortMode: PoolSortMode,
  priceDirection: PriceSortDirection,
  getPrice: (symbol: string) => number
): string[] {
  if (sortMode === "default") return [...symbols];

  const sorted = [...symbols];
  if (sortMode === "name") {
    sorted.sort((a, b) => {
      const nameA = nameBySymbol[a] ?? a;
      const nameB = nameBySymbol[b] ?? b;
      const byName = compareStrings(nameA, nameB);
      if (byName !== 0) return byName;
      return compareStrings(a, b);
    });
    return sorted;
  }

  sorted.sort((a, b) => {
    const priceA = getPrice(a);
    const priceB = getPrice(b);
    const aMissing = priceA <= 0;
    const bMissing = priceB <= 0;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (priceA !== priceB) {
      return priceDirection === "asc" ? priceA - priceB : priceB - priceA;
    }
    return compareStrings(a, b);
  });
  return sorted;
}

function isDraftedPoolSymbol(
  symbol: string,
  myDrafted: Set<string>,
  leagueOffBoard: Set<string>
): boolean {
  // Crypto never leaves the board — multiple managers can own the same coin (surcharge applies).
  if (isCryptoSymbol(symbol)) return false;
  if (myDrafted.has(symbol)) return true;
  if (leagueOffBoard.has(symbol)) return true;
  return false;
}

function filterUndraftedPoolStocks(
  stocks: DraftPoolStock[],
  showDraftedStocks: boolean,
  myDrafted: Set<string>,
  leagueOffBoard: Set<string>
): DraftPoolStock[] {
  if (showDraftedStocks) return stocks;
  return stocks.filter(
    (stock) => !isDraftedPoolSymbol(stock.symbol, myDrafted, leagueOffBoard)
  );
}

function filterUndraftedSearchResults(
  results: SearchResult[],
  showDraftedStocks: boolean,
  myDrafted: Set<string>,
  leagueOffBoard: Set<string>
): SearchResult[] {
  if (showDraftedStocks) return results;
  return results.filter(
    (item) => !isDraftedPoolSymbol(item.symbol, myDrafted, leagueOffBoard)
  );
}

const POOL_PAGE_SIZE = 80;
const TOP_100_PAGE_SIZE = 100;

function filterButtonLabel(filter: DraftPoolFilter): string {
  if (filter === "Consumer Discretionary") return "Cons. Disc.";
  if (filter === "Consumer Staples") return "Cons. Staples";
  if (filter === "Communication Services") return "Comm. Svcs.";
  return filter;
}

export function StockPool({
  poolStocks,
  poolLoading = false,
  cryptoPool = [],
  cryptoPoolLoading = false,
  quotes,
  turn,
  buyerCounts,
  leagueOffBoard,
  myDrafted,
  onDraft,
  draftingSymbol = null,
  quotesLoading = false,
  busy = false,
  pushbackSkipsRemaining = 0,
  canPick = true,
  safetyPickQueue = [],
  onToggleSafetyPick,
}: {
  poolStocks: DraftPoolStock[];
  poolLoading?: boolean;
  cryptoPool?: CryptoPoolCoin[];
  cryptoPoolLoading?: boolean;
  quotes: MarketQuote[];
  turn: DraftTurn;
  buyerCounts: CryptoBuyerCounts;
  leagueOffBoard: Set<string>;
  myDrafted: Set<string>;
  onDraft: (symbol: string, quote: MarketQuote, isSearchPick?: boolean) => void;
  draftingSymbol?: string | null;
  quotesLoading?: boolean;
  busy?: boolean;
  pushbackSkipsRemaining?: number;
  canPick?: boolean;
  safetyPickQueue?: string[];
  onToggleSafetyPick?: (symbol: string) => void;
}) {
  const [poolFilter, setPoolFilter] = useState<DraftPoolFilter>("All");
  const [poolSort, setPoolSort] = useState<PoolSortMode>("default");
  const [priceSortDirection, setPriceSortDirection] =
    useState<PriceSortDirection>("asc");
  const [showDraftedStocks, setShowDraftedStocks] = useState(false);
  const [localFilter, setLocalFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const [detailMeta, setDetailMeta] = useState<{
    name: string;
    sector: string;
  } | null>(null);
  const [detailQuote, setDetailQuote] = useState<MarketQuote | null>(null);

  const enrichedPool = useMemo(
    () => enrichDraftPoolStocks(poolStocks),
    [poolStocks]
  );

  const poolSymbolSet = useMemo(
    () => new Set(enrichedPool.map((s) => s.symbol)),
    [enrichedPool]
  );

  const quoteMap = useMemo(() => {
    const map = new Map<string, MarketQuote>();
    for (const q of quotes) map.set(q.symbol, q);
    return map;
  }, [quotes]);

  const getQuotePrice = (symbol: string) => quoteMap.get(symbol)?.price ?? 0;

  const filteredPool = useMemo(
    () =>
      filterDraftPoolStocks(enrichedPool, { filter: poolFilter, query: localFilter }),
    [enrichedPool, poolFilter, localFilter]
  );

  const sortedPool = useMemo(
    () =>
      sortPoolStocks(filteredPool, poolSort, priceSortDirection, getQuotePrice),
    [filteredPool, poolSort, priceSortDirection, quoteMap]
  );

  const sortedSearchResults = useMemo(
    () => sortSearchResults(searchResults, poolSort, priceSortDirection),
    [searchResults, poolSort, priceSortDirection]
  );

  const displayedPool = useMemo(
    () =>
      filterUndraftedPoolStocks(
        sortedPool,
        showDraftedStocks,
        myDrafted,
        leagueOffBoard
      ),
    [sortedPool, showDraftedStocks, myDrafted, leagueOffBoard]
  );

  const displayedSearchResults = useMemo(
    () =>
      filterUndraftedSearchResults(
        sortedSearchResults,
        showDraftedStocks,
        myDrafted,
        leagueOffBoard
      ),
    [sortedSearchResults, showDraftedStocks, myDrafted, leagueOffBoard]
  );

  const cryptoNameBySymbol = useMemo(
    () =>
      Object.fromEntries(
        cryptoPool.map((coin) => [coin.symbol, coin.name] as const)
      ),
    [cryptoPool]
  );

  const cryptoSymbols = useMemo(
    () => cryptoPool.map((coin) => coin.symbol),
    [cryptoPool]
  );

  const sortedCryptoSymbols = useMemo(
    () =>
      sortCryptoSymbols(
        cryptoSymbols,
        cryptoNameBySymbol,
        poolSort,
        priceSortDirection,
        getQuotePrice
      ),
    [
      cryptoSymbols,
      cryptoNameBySymbol,
      poolSort,
      priceSortDirection,
      quoteMap,
    ]
  );

  const displayedCryptoSymbols = sortedCryptoSymbols;

  const isTop100View = poolFilter === "Top 100";
  const isCryptoView = poolFilter === "Crypto";
  const isPushbackSkip = turn.type === "pushback_skip";

  const poolVisibleLimit =
    poolFilter === "Top 100" ? TOP_100_PAGE_SIZE : POOL_PAGE_SIZE;

  const poolVisible = useMemo(
    () => displayedPool.slice(0, poolVisibleLimit),
    [displayedPool, poolVisibleLimit]
  );

  const isReferenceMode = turn.type === "complete";

  function handlePriceSortClick() {
    if (poolSort === "price") {
      setPriceSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setPoolSort("price");
    setPriceSortDirection("asc");
  }

  function handleNameSortClick() {
    setPoolSort("name");
  }

  function clearSearch() {
    setSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
    setSearchLoading(false);
  }

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    let requestId = 0;

    const timer = window.setTimeout(() => {
      const currentRequest = ++requestId;
      setSearchLoading(true);
      setSearchError(null);

      const timeoutId = window.setTimeout(() => controller.abort(), 10000);

      void (async () => {
        try {
          const res = await fetch(
            `/api/market/search?q=${encodeURIComponent(q)}`,
            { signal: controller.signal, cache: "no-store" }
          );
          const data = (await res.json()) as {
            results?: SearchResult[];
            error?: string;
          };

          if (currentRequest !== requestId || controller.signal.aborted) {
            return;
          }

          if (!res.ok) {
            setSearchResults([]);
            setSearchError(
              data.error ?? `Search failed (${res.status}). Try again.`
            );
            return;
          }

          const outsidePool = (data.results ?? []).filter(
            (item) => !poolSymbolSet.has(item.symbol)
          );
          setSearchResults(outsidePool);
          if (outsidePool.length === 0) {
            setSearchError(`No eligible NYSE/NASDAQ matches for “${q}”.`);
          }
        } catch (err) {
          if (controller.signal.aborted || currentRequest !== requestId) {
            return;
          }
          setSearchResults([]);
          setSearchError(
            err instanceof Error && err.name === "AbortError"
              ? "Search timed out — try an exact ticker."
              : "Search failed — try again."
          );
        } finally {
          window.clearTimeout(timeoutId);
          if (currentRequest === requestId) {
            setSearchLoading(false);
          }
        }
      })();
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, poolSymbolSet]);

  function getEligibility(
    symbol: string,
    quote?: MarketQuote
  ): { eligible: boolean; label: string; skipped?: boolean } {
    const crypto = isCryptoSymbol(symbol);

    if (draftingSymbol === symbol) {
      return { eligible: false, label: "Drafting…" };
    }
    if (!canPick) {
      return { eligible: false, label: "—" };
    }
    if (busy && !crypto) {
      return { eligible: false, label: "Wait…" };
    }
    if (!crypto && myDrafted.has(symbol)) {
      return { eligible: false, label: "Yours" };
    }
    if (!crypto && leagueOffBoard.has(symbol)) {
      return { eligible: false, label: "Off board" };
    }
    if (turn.type === "complete") return { eligible: false, label: "Done" };
    if (isPushbackSkip) {
      return { eligible: false, label: "Round skipped", skipped: true };
    }
    if (!quote && !crypto) {
      return { eligible: false, label: quotesLoading ? "Loading…" : "No price" };
    }

    if (crypto) {
      if (!turn.canPickCrypto) return { eligible: false, label: "Crypto done" };
      if (!quote || quote.price <= 0) {
        return { eligible: false, label: "No price" };
      }
      return { eligible: true, label: "Draft" };
    }

    if (turn.type === "bench") {
      return { eligible: Boolean(quote), label: "Draft" };
    }

    if (turn.type === "open") {
      if (!turn.canPickStock) {
        return { eligible: false, label: "Stock limit" };
      }
      return { eligible: Boolean(quote), label: "Draft" };
    }

    return { eligible: false, label: "Wait" };
  }

  function openDetail(
    symbol: string,
    name: string,
    sectorLabel: string,
    quote: MarketQuote | undefined
  ) {
    setDetailSymbol(symbol);
    setDetailMeta({ name, sector: sectorLabel });
    setDetailQuote(quote ?? null);
  }

  function renderRow(
    symbol: string,
    name: string,
    sectorLabel: string,
    quote: MarketQuote | undefined,
    isSearchPick: boolean,
    rank?: number | null
  ) {
    const crypto = isCryptoSymbol(symbol);
    const { eligible, label, skipped } = getEligibility(symbol, quote);
    const price = quote?.price ?? 0;
    const change = quote?.changePercent ?? 0;
    const surcharge = crypto ? getSurchargePercent(buyerCounts[symbol] ?? 0) : 0;
    const offBoard = !crypto && leagueOffBoard.has(symbol);
    const mine = myDrafted.has(symbol);
    const queuePriority = getSafetyPickQueuePriority(safetyPickQueue, symbol);

    return (
      <div
        key={`${isSearchPick ? "search" : "pool"}-${symbol}`}
        className={`draft-pool-row ${offBoard || (mine && !crypto) ? "draft-pool-row--drafted" : ""} ${mine ? "draft-pool-row--mine" : ""} ${skipped ? "draft-pool-row--skipped" : ""} ${queuePriority ? "draft-pool-row--queued" : ""}`}
      >
        <span
          className={`draft-ticker-badge ${crypto ? "draft-ticker-badge--crypto" : ""} ${offBoard ? "draft-ticker-badge--taken" : ""}`}
        >
          {symbol}
        </span>
        <div className="draft-pool-info">
          <p className="draft-pool-name">{name}</p>
          <p className="draft-pool-meta">
            {rank != null ? `#${rank} · ${sectorLabel}` : sectorLabel}
            {isSearchPick && (
              <span className="text-primary-light/80"> · NYSE/NASDAQ search</span>
            )}
            {crypto && surcharge > 0 && (
              <span className="text-amber-400/80"> · +{surcharge}% surcharge next</span>
            )}
          </p>
        </div>
        <div className="draft-pool-price-col">
          <p className="draft-pool-price">{price > 0 ? formatMoney(price) : "—"}</p>
          {!crypto && price > 0 && (
            <p className="draft-pool-shares">{formatShares(STOCK_BUDGET / price)}</p>
          )}
        </div>
        <p
          className={`draft-pool-chg ${change >= 0 ? "text-green-400" : "text-red-400"}`}
        >
          {price > 0 ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "—"}
        </p>
        <div className="draft-pool-actions">
          <StockDetailChartButton
            onClick={() => openDetail(symbol, name, sectorLabel, quote)}
          />
          {!crypto && onToggleSafetyPick && turn.type !== "complete" && (
            <button
              type="button"
              className={`draft-safety-btn ${queuePriority ? "draft-safety-btn--active" : ""}`}
              title={
                queuePriority
                  ? `Safety queue #${queuePriority} — tap to remove`
                  : `Add to safety queue (up to ${SAFETY_PICK_QUEUE_MAX})`
              }
              disabled={busy || isPushbackSkip}
              onClick={() => onToggleSafetyPick(symbol)}
            >
              {queuePriority ?? "Q"}
            </button>
          )}
          <button
            type="button"
            disabled={!eligible || (!quote && !crypto) || !canPick}
            className={`draft-pick-btn ${crypto ? "draft-pick-btn--crypto" : ""} ${skipped ? "draft-pick-btn--skipped" : ""} ${!canPick && !crypto ? "draft-pick-btn--watching" : ""}`}
            onClick={() => quote && eligible && canPick && onDraft(symbol, quote, isSearchPick)}
          >
            {label}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="draft-pool">
      <div className="draft-pool-header">
        <div>
          <h2 className="draft-pool-title">Draft Pool</h2>
          <p className="draft-pool-subtitle">
            {isReferenceMode ? "Reference — " : ""}
            {turn.label} · S&P 500 ({poolLoading ? "…" : enrichedPool.length} stocks)
          </p>
        </div>
      </div>

      <div className="draft-pool-search">
        <div className="draft-pool-search-row">
          <input
            type="search"
            placeholder="Search any NYSE/NASDAQ ticker (Finnhub)…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="draft-input"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              className="draft-search-clear"
              aria-label="Clear ticker search"
              onClick={clearSearch}
            >
              ×
            </button>
          )}
        </div>
        {searchLoading && (
          <p className="text-xs text-muted mt-1">Searching Finnhub…</p>
        )}
        {searchError && !searchLoading && (
          <p className="text-xs text-amber-400/90 mt-1">{searchError}</p>
        )}
      </div>

      {displayedSearchResults.length > 0 && (
        <div className="draft-search-results">
          <p className="draft-search-label">
            Search results ($5+ · outside S&P 500 pool)
          </p>
          <div className="draft-pool-list draft-pool-list--compact">
            {displayedSearchResults.map((item) =>
              renderRow(
                item.symbol,
                item.name,
                "Search",
                quoteMap.get(item.symbol) ??
                  ({
                    symbol: item.symbol,
                    price: item.price,
                    changePercent: item.changePercent,
                    assetType: "stock",
                    updatedAt: Date.now(),
                  } as MarketQuote),
                true
              )
            )}
          </div>
        </div>
      )}

      <div className="draft-pool-search">
        <input
          type="search"
          placeholder="Filter S&P 500 list…"
          value={localFilter}
          onChange={(e) => setLocalFilter(e.target.value)}
          className="draft-input"
        />
      </div>

      <div className="draft-pool-filters">
        {DRAFT_POOL_FILTER_BUTTONS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={`draft-filter-btn ${poolFilter === filter ? "draft-filter-btn--active" : ""} ${filter === "Top 100" ? "draft-filter-btn--top100" : ""} ${filter === "Crypto" ? "draft-filter-btn--crypto-tab" : ""}`}
            onClick={() => setPoolFilter(filter)}
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
            className={`draft-filter-btn ${poolSort === "name" ? "draft-filter-btn--active" : ""}`}
            onClick={handleNameSortClick}
          >
            Name A–Z
          </button>
          <button
            type="button"
            className={`draft-filter-btn ${poolSort === "price" ? "draft-filter-btn--active" : ""}`}
            onClick={handlePriceSortClick}
            title={
              poolSort === "price" && priceSortDirection === "desc"
                ? "Price high to low — click to switch"
                : "Price low to high — click to switch"
            }
          >
            Price{" "}
            {poolSort === "price" && priceSortDirection === "desc"
              ? "↓ High"
              : "↑ Low"}
          </button>
        </div>
        <span className="draft-pool-sorts-divider" aria-hidden="true" />
        <button
          type="button"
          role="switch"
          aria-checked={showDraftedStocks}
          className={`draft-filter-btn draft-filter-btn--toggle ${showDraftedStocks ? "draft-filter-btn--active" : ""}`}
          onClick={() => setShowDraftedStocks((value) => !value)}
        >
          Show drafted
        </button>
      </div>

      {onToggleSafetyPick && !isReferenceMode && turn.type !== "complete" && (
        <p className="draft-safety-hint">
          Tap <strong>Q</strong> to queue safety stocks while you watch or pick — tried
          in order (#1, #2, …) if your {SAFETY_PICK_QUEUE_MAX}-slot timer expires
          {safetyPickQueue.length > 0
            ? `: ${safetyPickQueue.join(" → ")}`
            : "."}
        </p>
      )}

      {!canPick && !isReferenceMode && onToggleSafetyPick && (
        <p className="draft-watching-hint">
          Queue stocks with <strong>Q</strong> while other teams pick — your list
          runs automatically when you&apos;re on the clock.
        </p>
      )}

      {isPushbackSkip && (
        <div className="draft-pool-skip-banner" role="status">
          <p className="draft-pool-skip-title">Round skipped — crypto pushback penalty</p>
          <p className="draft-pool-skip-detail">
            You cannot draft this round. Your pick slot will resume automatically after{" "}
            {pushbackSkipsRemaining} skip{pushbackSkipsRemaining === 1 ? "" : "s"}.
            You still keep all 10 stock picks — this only delays your turn.
          </p>
        </div>
      )}

      <p className="draft-pool-meta-line">
        {poolLoading
          ? "Loading S&P 500 from database…"
          : isCryptoView
            ? cryptoPoolLoading
              ? "Loading top crypto pool from database…"
              : `Top ${cryptoPool.length} crypto by market cap · surcharge per coin`
            : isTop100View
              ? `Top 100 S&P 500 by market cap · showing ${poolVisible.length} of ${displayedPool.length} stocks`
              : `Showing ${poolVisible.length} of ${displayedPool.length} S&P 500 stocks`}
        {isReferenceMode && !poolLoading && " · Browse anytime after your draft is complete"}
      </p>

      <div
        className={`draft-pool-list ${isPushbackSkip ? "draft-pool-list--locked" : ""}`}
      >
        {poolVisible.length === 0 && !poolLoading && isTop100View && (
          <p className="draft-pool-empty-msg">
            {displayedPool.length === 0 && filteredPool.length > 0
              ? "All visible stocks are drafted — turn on Show drafted to review them."
              : "No ranked stocks loaded. Run migration 004_draft_pool.sql or refresh the page."}
          </p>
        )}

        {poolVisible.length === 0 &&
          !poolLoading &&
          !isCryptoView &&
          !isTop100View &&
          displayedPool.length === 0 &&
          filteredPool.length > 0 && (
            <p className="draft-pool-empty-msg">
              All visible stocks are drafted — turn on Show drafted to review them.
            </p>
          )}

        {!isCryptoView &&
          poolVisible.map((stock) =>
            renderRow(
              stock.symbol,
              stock.name,
              stock.sector,
              quoteMap.get(stock.symbol),
              false,
              isTop100View ? getMarketCapRank(stock) : null
            )
          )}

        {isCryptoView && (
          <>
            <div className="draft-pool-divider">
              Crypto flex — top {cryptoPool.length} by market cap
            </div>
            {cryptoPoolLoading && (
              <p className="draft-pool-empty-msg">Loading crypto pool…</p>
            )}
            {!cryptoPoolLoading && displayedCryptoSymbols.length === 0 && (
              <p className="draft-pool-empty-msg">
                Crypto pool is empty. Run migration 030_crypto_pool.sql.
              </p>
            )}
            {displayedCryptoSymbols.map((symbol) =>
              renderRow(
                symbol,
                cryptoNameBySymbol[symbol] ?? symbol,
                "Crypto",
                quoteMap.get(symbol),
                false,
                cryptoPool.find((coin) => coin.symbol === symbol)?.marketCapRank ??
                  null
              )
            )}
          </>
        )}
      </div>

      <StockDetailModal
        open={!!detailSymbol}
        symbol={detailSymbol}
        meta={
          detailMeta
            ? { name: detailMeta.name, sector: detailMeta.sector }
            : undefined
        }
        quote={
          detailQuote
            ? {
                price: detailQuote.price,
                changePercent: detailQuote.changePercent,
              }
            : null
        }
        onClose={() => {
          setDetailSymbol(null);
          setDetailMeta(null);
          setDetailQuote(null);
        }}
      />
    </section>
  );
}
