"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatMoney,
  formatShares,
  isCryptoSymbol,
  STOCK_BUDGET,
} from "@/lib/draft/engine";
import { formatPct } from "@/lib/format";
import { CRYPTO_DISPLAY_NAMES } from "@/lib/market/draft-pool";
import type { MarketQuote } from "@/lib/market/types";
import { Button } from "@/components/Button";

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
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !symbol) return null;

  const crypto = isCryptoSymbol(symbol);
  const name =
    meta?.name ??
    (crypto ? CRYPTO_DISPLAY_NAMES[symbol] : undefined) ??
    symbol;
  const sector = meta?.sector ?? (crypto ? "Crypto" : "Stock");
  const price = quote?.price ?? 0;
  const change = quote?.changePercent ?? 0;
  const sharesAtBudget =
    price > 0 && !crypto ? STOCK_BUDGET / price : 0;

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
          <div>
            <h3 id="stock-detail-title" className="draft-modal-title">
              {symbol}
            </h3>
            <p className="draft-modal-subtitle">{name}</p>
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

        <div className="draft-modal-body">
          <div className="draft-modal-stat">
            <span className="text-muted">Sector</span>
            <span>{sector}</span>
          </div>
          <div className="draft-modal-stat">
            <span className="text-muted">Type</span>
            <span>{crypto ? "Crypto flex" : "Stock"}</span>
          </div>
          <div className="draft-modal-stat">
            <span className="text-muted">Day change</span>
            <span className={change >= 0 ? "text-green-400" : "text-red-400"}>
              {price > 0 ? formatPct(change) : "—"}
            </span>
          </div>
          {!crypto && price > 0 && !context && (
            <div className="draft-modal-stat">
              <span className="text-muted">Shares @ $80K</span>
              <span>{formatShares(sharesAtBudget)}</span>
            </div>
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
