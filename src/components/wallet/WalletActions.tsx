"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/Button";
import { MIN_DEPOSIT_USD } from "@/lib/wallet/constants";

function AmountModal({
  title,
  helperText,
  minAmount,
  onClose,
  onSubmit,
}: {
  title: string;
  helperText?: string;
  minAmount?: number;
  onClose: () => void;
  onSubmit: (amountUsd: number) => Promise<string | null>;
}) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (minAmount && parsed < minAmount) {
      setError(`Minimum is $${minAmount}.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    const result = await onSubmit(parsed);
    setSubmitting(false);
    if (result) setError(result);
  }

  const modal = (
    <div className="draft-modal-backdrop" onClick={onClose}>
      <div
        className="draft-modal max-w-sm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="draft-modal-title">{title}</h3>
        <div className="draft-modal-body space-y-3">
          {helperText && (
            <p className="text-sm text-muted">{helperText}</p>
          )}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              $
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={minAmount ?? 0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg bg-dark-card border border-white/10 pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-gold/60"
              autoFocus
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="draft-modal-actions flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-white/10 text-white font-semibold py-2.5 text-sm hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="flex-1 rounded-lg bg-gold text-black font-semibold py-2.5 text-sm hover:brightness-95 disabled:opacity-40"
          >
            {submitting ? "Please wait..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export function WalletActions({ balance }: { balance: number }) {
  const [openModal, setOpenModal] = useState<"deposit" | "withdraw" | null>(
    null
  );

  async function handleDeposit(amountUsd: number): Promise<string | null> {
    try {
      const response = await fetch("/api/wallet/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsd }),
      });
      const data = await response.json();
      if (!response.ok) {
        return data.error ?? "Could not start deposit.";
      }
      window.location.href = data.url;
      return null;
    } catch {
      return "Could not start deposit.";
    }
  }

  async function handleWithdraw(amountUsd: number): Promise<string | null> {
    try {
      const response = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsd }),
      });
      const data = await response.json();
      if (!response.ok) {
        return data.error ?? "Could not submit withdrawal request.";
      }
      window.location.reload();
      return null;
    } catch {
      return "Could not submit withdrawal request.";
    }
  }

  return (
    <div className="flex gap-3">
      <Button
        variant="primary"
        className="flex-1"
        onClick={() => setOpenModal("deposit")}
      >
        Deposit Funds
      </Button>
      <Button
        variant="secondary"
        className="flex-1"
        onClick={() => setOpenModal("withdraw")}
      >
        Withdraw Funds
      </Button>

      {openModal === "deposit" && (
        <AmountModal
          title="Deposit Funds"
          helperText={`Minimum deposit is $${MIN_DEPOSIT_USD}. You'll be redirected to a secure checkout to complete payment.`}
          minAmount={MIN_DEPOSIT_USD}
          onClose={() => setOpenModal(null)}
          onSubmit={handleDeposit}
        />
      )}
      {openModal === "withdraw" && (
        <AmountModal
          title="Withdraw Funds"
          helperText={`Available balance: $${balance.toFixed(2)}. Withdrawal requests are reviewed and paid out manually.`}
          onClose={() => setOpenModal(null)}
          onSubmit={handleWithdraw}
        />
      )}
    </div>
  );
}
