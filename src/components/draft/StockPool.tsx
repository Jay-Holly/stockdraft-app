"use client";

import { useEffect, useMemo, useState } from "react";
import { CRYPTO_SYMBOLS } from "@/lib/market/symbols";
import type { DraftPoolFilter, DraftPoolStock } from "@/lib/market/draft-pool";
import {
  CRYPTO_DISPLAY_NAMES,
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

type SearchResult = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
};

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
  safetyPickSymbol = null,
  onSetSafetyPick,
}: {
  poolStocks: DraftPoolStock[];
  poolLoading?: boolean;
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
  safetyPickSymbol?: string | null;
  onSetSafetyPick?: (symbol: string | null) => void;
}) {
  const [poolFilter, setPoolFilter] = useState<DraftPoolFilter>("All");
  const [localFilter, setLocalFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
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

  const filteredPool = useMemo(
    () =>
      filterDraftPoolStocks(enrichedPool, { filter: poolFilter, query: localFilter }),
    [enrichedPool, poolFilter, localFilter]
  );

  const isTop100View = poolFilter === "Top 100";
  const isCryptoView = poolFilter === "Crypto";
  const isPushbackSkip = turn.type === "pushback_skip";

  const poolVisibleLimit =
    poolFilter === "Top 100" ? TOP_100_PAGE_SIZE : POOL_PAGE_SIZE;

  const poolVisible = useMemo(
    () => filteredPool.slice(0, poolVisibleLimit),
    [filteredPool, poolVisibleLimit]
  );

  const isReferenceMode = turn.type === "complete";

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { results: SearchResult[] };
        const outsidePool = (data.results ?? []).filter(
          (item) => !poolSymbolSet.has(item.symbol)
        );
        setSearchResults(outsidePool);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
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
      return { eligible: false, label: "Watching" };
    }
    if (busy && !crypto) {
      return { eligible: false, label: "Wait…" };
    }
    if (myDrafted.has(symbol)) {
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

    return (
      <div
        key={`${isSearchPick ? "search" : "pool"}-${symbol}`}
        className={`draft-pool-row ${offBoard || mine ? "draft-pool-row--drafted" : ""} ${mine ? "draft-pool-row--mine" : ""} ${skipped ? "draft-pool-row--skipped" : ""}`}
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
          {!crypto && onSetSafetyPick && canPick && turn.type !== "complete" && (
            <button
              type="button"
              className={`draft-safety-btn ${safetyPickSymbol === symbol ? "draft-safety-btn--active" : ""}`}
              title="Queue safety pick (auto-drafts if timer expires)"
              disabled={busy || isPushbackSkip}
              onClick={() =>
                onSetSafetyPick(safetyPickSymbol === symbol ? null : symbol)
              }
            >
              Q
            </button>
          )}
          <button
            type="button"
            disabled={!eligible || (!quote && !crypto)}
            className={`draft-pick-btn ${crypto ? "draft-pick-btn--crypto" : ""} ${skipped ? "draft-pick-btn--skipped" : ""}`}
            onClick={() => quote && eligible && onDraft(symbol, quote, isSearchPick)}
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
        <input
          type="search"
          placeholder="Search any NYSE/NASDAQ ticker (Finnhub)…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="draft-input"
        />
        {searchLoading && (
          <p className="text-xs text-muted mt-1">Searching Finnhub…</p>
        )}
      </div>

      {searchResults.length > 0 && (
        <div className="draft-search-results">
          <p className="draft-search-label">
            Search results ($5+ · outside S&P 500 pool)
          </p>
          <div className="draft-pool-list draft-pool-list--compact">
            {searchResults.map((item) =>
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

      {onSetSafetyPick && canPick && !isReferenceMode && (
        <p className="draft-safety-hint">
          Tap <strong>Q</strong> on a stock to queue your safety pick — used if the
          2:00 timer expires{ safetyPickSymbol ? ` (queued: ${safetyPickSymbol})` : ""}.
        </p>
      )}

      {!canPick && !isReferenceMode && (
        <p className="draft-watching-hint">
          You&apos;re watching the live draft — picks unlock when it&apos;s your turn.
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
            ? "Crypto flex — always on the board · BTC, ETH, SOL, DOGE"
            : isTop100View
              ? `Top 100 S&P 500 by market cap · showing ${poolVisible.length} of ${filteredPool.length} stocks`
              : `Showing ${poolVisible.length} of ${filteredPool.length} S&P 500 stocks`}
        {isReferenceMode && !poolLoading && " · Browse anytime after your draft is complete"}
      </p>

      <div
        className={`draft-pool-list ${isPushbackSkip ? "draft-pool-list--locked" : ""}`}
      >
        {poolVisible.length === 0 && !poolLoading && isTop100View && (
          <p className="draft-pool-empty-msg">
            No ranked stocks loaded. Run migration 004_draft_pool.sql or refresh the page.
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
            <div className="draft-pool-divider">Crypto flex — always on the board</div>
            {CRYPTO_SYMBOLS.map((symbol) =>
              renderRow(
                symbol,
                CRYPTO_DISPLAY_NAMES[symbol] ?? symbol,
                "Crypto",
                quoteMap.get(symbol),
                false
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
