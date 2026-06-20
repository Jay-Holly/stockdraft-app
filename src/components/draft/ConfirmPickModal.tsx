"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  computeCryptoPick,
  computeStockPick,
  formatMoney,
  formatShares,
  getSurchargePercent,
  isCryptoSymbol,
  STOCK_BUDGET,
} from "@/lib/draft/engine";
import type { CryptoBuyerCounts, DraftTurn } from "@/lib/draft/types";
import type { MarketQuote } from "@/lib/market/types";
import { Button } from "@/components/Button";

const CRYPTO_PRESETS = [50_000, 100_000, 150_000, 200_000];

export function ConfirmPickModal({
  open,
  symbol,
  quote,
  turn,
  buyerCounts,
  cryptoRemaining,
  onConfirm,
  onClose,
  busy,
}: {
  open: boolean;
  symbol: string | null;
  quote: MarketQuote | null;
  turn: DraftTurn;
  buyerCounts: CryptoBuyerCounts;
  cryptoRemaining: number;
  onConfirm: (allocation?: number) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [allocation, setAllocation] = useState(cryptoRemaining);

  useEffect(() => {
    if (open) setAllocation(cryptoRemaining);
  }, [open, cryptoRemaining, symbol]);

  if (!open || !symbol || !quote) return null;

  const crypto = isCryptoSymbol(symbol);
  if (!crypto) return null;
  const buyerCount = buyerCounts[symbol] ?? 0;
  const surcharge = crypto ? getSurchargePercent(buyerCount) : 0;

  let preview = {
    budget: STOCK_BUDGET,
    shares: 0,
    effective: STOCK_BUDGET,
    surcharge: 0,
  };

  if (crypto) {
    const amount = Math.min(allocation, cryptoRemaining);
    const computed = computeCryptoPick(amount, quote.price, buyerCount);
    preview = {
      budget: amount,
      shares: computed.shares,
      effective: computed.effectiveValue,
      surcharge: computed.surchargePercent,
    };
  } else if (turn.type === "bench") {
    preview = { budget: 0, shares: 0, effective: 0, surcharge: 0 };
  } else {
    const computed = computeStockPick(quote.price);
    preview = {
      budget: computed.budgetSpent,
      shares: computed.shares,
      effective: computed.budgetSpent,
      surcharge: 0,
    };
  }

  const modal = (
    <div className="draft-modal-backdrop" onClick={onClose}>
      <div
        className="draft-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-pick-title"
      >
        <h3 id="confirm-pick-title" className="draft-modal-title">
          Crypto pick — {symbol}
        </h3>
        <p className="draft-modal-subtitle">{turn.label}</p>

        <div className="draft-modal-body">
          <div className="draft-modal-stat">
            <span>Price</span>
            <strong>{formatMoney(quote.price)}</strong>
          </div>
          <div className="draft-modal-stat">
            <span>24h change</span>
            <strong className={quote.changePercent >= 0 ? "text-green-400" : "text-red-400"}>
              {quote.changePercent >= 0 ? "+" : ""}
              {quote.changePercent.toFixed(1)}%
            </strong>
          </div>

          {crypto && (
            <>
              <p className="text-sm text-muted mt-2">
                Buyer #{buyerCount + 1} · Surcharge {surcharge}%
              </p>
              <label className="block text-sm text-gray-300 mt-3 mb-1.5">
                Allocation ({formatMoney(cryptoRemaining)} left)
              </label>
              <input
                type="range"
                min={1000}
                max={cryptoRemaining}
                step={1000}
                value={Math.min(allocation, cryptoRemaining)}
                onChange={(e) => setAllocation(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {CRYPTO_PRESETS.filter((p) => p <= cryptoRemaining).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="draft-filter-btn"
                    onClick={() => setAllocation(preset)}
                  >
                    {formatMoney(preset)}
                  </button>
                ))}
                <button
                  type="button"
                  className="draft-filter-btn draft-filter-btn--active"
                  onClick={() => setAllocation(cryptoRemaining)}
                >
                  Max
                </button>
              </div>
            </>
          )}

          <div className="draft-modal-preview">
            {turn.type === "bench" ? (
              <p>Free bench pick — no cap impact</p>
            ) : (
              <>
                <p>
                  Spend: <strong>{formatMoney(preview.budget)}</strong>
                </p>
                {crypto && preview.surcharge > 0 && (
                  <p>
                    After surcharge: <strong>{formatMoney(preview.effective)}</strong>
                  </p>
                )}
                <p>
                  Shares: <strong>{formatShares(preview.shares)}</strong>
                </p>
              </>
            )}
          </div>
        </div>

        <div className="draft-modal-actions">
          <Button variant="ghost" onClick={onClose} disabled={busy} className="w-full">
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || (crypto && allocation <= 0)}
            onClick={() => onConfirm(crypto ? allocation : undefined)}
            className="w-full"
          >
            {busy ? "Drafting…" : "Confirm pick"}
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
