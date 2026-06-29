"use client";

import {
  BENCH_START_ROUND,
  CRYPTO_POOL,
  formatMoney,
  OPEN_ROUNDS,
  STOCK_CAP,
  TOTAL_CAP,
  TOTAL_ROUNDS,
} from "@/lib/draft/engine";
import type { DraftPick, DraftSummary } from "@/lib/draft/types";

export function SalaryCapBar({
  summary,
  currentRound,
  picks,
}: {
  summary: DraftSummary;
  currentRound: number;
  picks: DraftPick[];
}) {
  const stockPct = Math.min(100, (summary.stockSpent / STOCK_CAP) * 100);
  const cryptoPct = Math.min(100, (summary.cryptoSpent / CRYPTO_POOL) * 100);

  const slots = Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
    const round = i + 1;
    const pick = picks.find(
      (p) => p.round_number === round && p.pick_type !== "skip"
    );
    const skip = picks.some(
      (p) => p.round_number === round && p.pick_type === "skip"
    );
    const isActive = round === currentRound;
    let slotClass = "draft-round-slot";
    if (round <= OPEN_ROUNDS) slotClass += " draft-round-slot--stock";
    else slotClass += " draft-round-slot--bench";
    if (pick?.pick_type === "crypto") slotClass += " draft-round-slot--crypto";
    if (pick) slotClass += " draft-round-slot--filled";
    if (skip) slotClass += " draft-round-slot--skip";
    if (isActive) slotClass += " draft-round-slot--active";

    return (
      <div key={round} className={slotClass}>
        <span className="draft-round-num">R{round}</span>
        {pick ? (
          <>
            <span className="draft-round-ticker">{pick.symbol}</span>
            {pick.shares > 0 && (
              <span className="draft-round-shares">
                {pick.pick_type === "bench"
                  ? "BN"
                  : pick.pick_type === "crypto"
                    ? `$${Math.round(pick.budget_spent / 1000)}K`
                    : `$${Math.round(pick.budget_spent / 1000)}K`}
              </span>
            )}
          </>
        ) : skip ? (
          <span className="draft-round-empty">SKIP</span>
        ) : (
          <span className="draft-round-empty">
            {round >= BENCH_START_ROUND ? "BN" : round <= OPEN_ROUNDS ? "O" : "—"}
          </span>
        )}
      </div>
    );
  });

  return (
    <section className="draft-cap-bar">
      <div className="draft-cap-header">
        <h2 className="draft-cap-title">Salary Cap — {formatMoney(TOTAL_CAP)} Total</h2>
        <p className="draft-cap-spent">
          <span className="text-red-400">{formatMoney(summary.totalSpent)}</span>
          <span className="text-muted text-sm ml-1">spent</span>
        </p>
      </div>

      <div className="draft-dual-cap">
        <div>
          <div className="draft-cap-label">
            <span>Stock budget (10 × $80K)</span>
            <span>
              {formatMoney(summary.stockSpent)} / {formatMoney(STOCK_CAP)}
            </span>
          </div>
          <div className="draft-cap-track">
            <div
              className="draft-cap-fill draft-cap-fill--stock"
              style={{ width: `${stockPct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="draft-cap-label draft-cap-label--crypto">
            <span>Crypto flex pool (rounds 1–13)</span>
            <span>
              {formatMoney(summary.cryptoSpent)} / {formatMoney(CRYPTO_POOL)}
            </span>
          </div>
          <div className="draft-cap-track">
            <div
              className="draft-cap-fill draft-cap-fill--crypto"
              style={{ width: `${cryptoPct}%` }}
            />
          </div>
        </div>
      </div>

      <p className="text-xs text-muted px-4 pb-2">
        R1–R{OPEN_ROUNDS} open (stock or crypto) · R{BENCH_START_ROUND}–R{TOTAL_ROUNDS} bench (crypto still available)
      </p>

      <div className="draft-cap-rounds">{slots}</div>
    </section>
  );
}
