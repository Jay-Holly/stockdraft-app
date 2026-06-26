"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  formatMoney,
  formatShares,
  isCryptoSymbol,
  STOCK_BUDGET,
} from "@/lib/draft/engine";
import { formatPct } from "@/lib/format";
import {
  formatMarketCap,
  formatPercentRatio,
  formatRatio,
  type StockDetailCandles,
  type StockDetailMetrics,
  type StockDetailProfile,
} from "@/lib/finnhub/stock-detail";
import { CRYPTO_DISPLAY_NAMES } from "@/lib/market/draft-pool";
import type { MarketQuote } from "@/lib/market/types";
import { Button } from "@/components/Button";
import { StockPriceChart } from "@/components/market/StockPriceChart";

export type StockDetailContext = {
  slotLabel?: string;
  budgetSpent?: number;
  shares?: number;
  scores?: boolean;
  gainPercent?: number;
};

export type StockDetailMeta = {
  name?: string;
  sector?: string;
};

type StockDetailModalProps = {
  open: boolean;
  symbol: string | null;
  meta?: StockDetailMeta;
  quote?: Pick<MarketQuote, "price" | "changePercent"> | null;
  context?: StockDetailContext;
  onClose: () => void;
};

type DetailTab = "overview" | "financials" | "chart";

type StockDetailResponse = {
  profile?: StockDetailProfile | null;
  metrics?: StockDetailMetrics | null;
  candles?: StockDetailCandles | null;
  error?: string;
};

function ChartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 3v18h18" />
      <path d="M7 16l4-6 4 3 6-8" />
    </svg>
  );
}

export function StockDetailChartButton({
  onClick,
  label = "View stock details",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="stock-detail-chart-btn"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <ChartIcon />
    </button>
  );
}

function DetailStat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="draft-modal-stat">
      <span className="text-muted">{label}</span>
      <span className={valueClassName}>{value}</span>
    </div>
  );
}

export function StockDetailModal({
  open,
  symbol,
  meta,
  quote: initialQuote,
  context,
  onClose,
}: StockDetailModalProps) {
  const [quote, setQuote] = useState<{
    price: number;
    changePercent: number;
  } | null>(initialQuote ?? null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [profile, setProfile] = useState<StockDetailProfile | null>(null);
  const [metrics, setMetrics] = useState<StockDetailMetrics | null>(null);
  const [candles, setCandles] = useState<StockDetailCandles | null>(null);

  const crypto = symbol ? isCryptoSymbol(symbol) : false;

  useEffect(() => {
    if (!open || !symbol) return;

    const activeSymbol = symbol;
    setQuote(initialQuote ?? null);

    let cancelled = false;

    async function loadQuote() {
      setLoading(true);
      try {
        if (isCryptoSymbol(activeSymbol)) {
          const res = await fetch("/api/market/crypto", { cache: "no-store" });
          const data = await res.json();
          const entry = data[activeSymbol.toUpperCase()];
          if (!cancelled && entry?.price) {
            setQuote({
              price: entry.price,
              changePercent: entry.changePercent ?? 0,
            });
          }
        } else {
          const res = await fetch(
            `/api/market/stocks?symbols=${encodeURIComponent(activeSymbol)}`,
            { cache: "no-store" }
          );
          const data = await res.json();
          const entry = data[activeSymbol.toUpperCase()];
          if (!cancelled && entry?.price) {
            setQuote({
              price: entry.price,
              changePercent: entry.changePercent ?? 0,
            });
          }
        }
      } catch {
        // Keep initial quote if fetch fails.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadQuote();
    const id = window.setInterval(loadQuote, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, symbol, initialQuote]);

  useEffect(() => {
    if (!open || !symbol || crypto) {
      setProfile(null);
      setMetrics(null);
      setCandles(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    const activeSymbol = symbol;
    let cancelled = false;

    setActiveTab("overview");
    setProfile(null);
    setMetrics(null);
    setCandles(null);
    setDetailError(null);
    setDetailLoading(true);

    void (async () => {
      try {
        const res = await fetch(
          `/api/market/stock-detail?symbol=${encodeURIComponent(activeSymbol)}`,
          { cache: "no-store" }
        );
        const data = (await res.json()) as StockDetailResponse;

        if (cancelled) return;

        if (!res.ok) {
          setDetailError(
            data.error ?? "Could not load company details — try again."
          );
          return;
        }

        setProfile(data.profile ?? null);
        setMetrics(data.metrics ?? null);
        setCandles(data.candles ?? null);
      } catch {
        if (!cancelled) {
          setDetailError("Could not load company details — try again.");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, symbol, crypto]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !symbol) return null;

  const name =
    profile?.name ??
    meta?.name ??
    (crypto ? CRYPTO_DISPLAY_NAMES[symbol] : undefined) ??
    symbol;
  const sector =
    meta?.sector ?? profile?.industry ?? (crypto ? "Crypto" : "Stock");
  const price = quote?.price ?? 0;
  const change = quote?.changePercent ?? 0;
  const sharesAtBudget =
    price > 0 && !crypto ? STOCK_BUDGET / price : 0;

  const tabs: Array<{ id: DetailTab; label: string; disabled?: boolean }> = [
    { id: "overview", label: "Overview" },
    { id: "financials", label: "Financials", disabled: crypto },
    { id: "chart", label: "Chart", disabled: crypto },
  ];

  const modal = (
    <div className="draft-modal-backdrop" onClick={onClose}>
      <div
        className="draft-modal stock-detail-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-detail-title"
      >
        <div className="stock-detail-modal-header">
          <div className="stock-detail-modal-title-row">
            {profile?.logo && !crypto && (
              <img
                src={profile.logo}
                alt=""
                className="stock-detail-logo"
                width={32}
                height={32}
              />
            )}
            <div>
              <h3 id="stock-detail-title" className="draft-modal-title">
                {symbol}
              </h3>
              <p className="draft-modal-subtitle">{name}</p>
            </div>
          </div>
          <button
            type="button"
            className="stock-detail-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="stock-detail-price-row">
          <span
            className={`stock-detail-price ${
              change >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {price > 0 ? formatMoney(price) : loading ? "Loading…" : "—"}
          </span>
          <span
            className={`stock-detail-change ${
              change >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {price > 0 ? formatPct(change) : "—"}
          </span>
        </div>

        {!crypto && (
          <div className="stock-detail-tabs" role="tablist" aria-label="Stock detail">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`stock-detail-tab ${
                  activeTab === tab.id ? "stock-detail-tab--active" : ""
                }`}
                disabled={tab.disabled}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="draft-modal-body stock-detail-body">
          {crypto ? (
            <>
              <DetailStat label="Sector" value={sector} />
              <DetailStat label="Type" value="Crypto flex" />
              <DetailStat
                label="Day change"
                value={price > 0 ? formatPct(change) : "—"}
                valueClassName={change >= 0 ? "text-green-400" : "text-red-400"}
              />
            </>
          ) : detailLoading ? (
            <p className="text-sm text-muted py-4 text-center">
              Loading company data…
            </p>
          ) : detailError ? (
            <p className="text-sm text-amber-400/90 py-2">{detailError}</p>
          ) : (
            <>
              {activeTab === "overview" && (
                <div role="tabpanel">
                  <DetailStat label="Sector" value={sector} />
                  <DetailStat label="Exchange" value={profile?.exchange ?? "—"} />
                  <DetailStat label="Industry" value={profile?.industry ?? "—"} />
                  <DetailStat label="Country" value={profile?.country ?? "—"} />
                  <DetailStat
                    label="Market cap"
                    value={formatMarketCap(profile?.marketCapMillions)}
                  />
                  <DetailStat label="IPO" value={profile?.ipo ?? "—"} />
                  <DetailStat label="Currency" value={profile?.currency ?? "USD"} />
                  {profile?.website && (
                    <DetailStat
                      label="Website"
                      value={
                        <a
                          href={profile.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="stock-detail-link"
                        >
                          Visit
                        </a>
                      }
                    />
                  )}
                  {!crypto && price > 0 && !context && (
                    <DetailStat
                      label="Shares @ $80K"
                      value={formatShares(sharesAtBudget)}
                    />
                  )}
                </div>
              )}

              {activeTab === "financials" && (
                <div role="tabpanel">
                  <DetailStat
                    label="P/E (TTM)"
                    value={formatRatio(metrics?.peRatio)}
                  />
                  <DetailStat
                    label="52-week high"
                    value={
                      metrics?.week52High != null
                        ? formatMoney(metrics.week52High)
                        : "—"
                    }
                  />
                  <DetailStat
                    label="52-week low"
                    value={
                      metrics?.week52Low != null
                        ? formatMoney(metrics.week52Low)
                        : "—"
                    }
                  />
                  <DetailStat
                    label="Profit margin"
                    value={formatPercentRatio(metrics?.profitMargin)}
                  />
                  <DetailStat
                    label="Revenue growth (5Y)"
                    value={formatPercentRatio(metrics?.revenueGrowth5Y)}
                  />
                  <DetailStat
                    label="Dividend yield"
                    value={formatPercentRatio(metrics?.dividendYield)}
                  />
                  <DetailStat label="Beta" value={formatRatio(metrics?.beta)} />
                </div>
              )}

              {activeTab === "chart" && (
                <div role="tabpanel">
                  <p className="stock-detail-chart-caption">Last 90 days</p>
                  {candles ? (
                    <StockPriceChart
                      timestamps={candles.timestamps}
                      closes={candles.closes}
                    />
                  ) : (
                    <p className="text-sm text-muted">
                      Price history is not available for this symbol.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {context && (
            <div className="draft-modal-preview">
              {context.slotLabel && (
                <p>
                  <span className="text-muted">Roster slot · </span>
                  {context.slotLabel}
                  {context.scores === false && " · does not score"}
                </p>
              )}
              {context.shares != null && context.shares > 0 && (
                <p className="mt-1">
                  <span className="text-muted">Your shares · </span>
                  {formatShares(context.shares)}
                </p>
              )}
              {context.budgetSpent != null && (
                <p className="mt-1">
                  <span className="text-muted">Budget · </span>
                  {formatMoney(context.budgetSpent)}
                </p>
              )}
              {context.gainPercent != null && context.scores !== false && (
                <p className="mt-1">
                  <span className="text-muted">Total gain · </span>
                  <span
                    className={
                      context.gainPercent >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }
                  >
                    {formatPct(context.gainPercent)}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="draft-modal-actions">
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
