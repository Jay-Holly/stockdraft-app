"use client";

import {
  BENCH_ROUNDS,
  CRYPTO_FLEX_ROUNDS,
  formatMoney,
  formatShares,
  STOCK_BUDGET,
  STOCK_ROUNDS,
} from "@/lib/draft/engine";
import type { DraftPick, DraftSummary } from "@/lib/draft/types";

export function DraftBoard({
  teamName,
  picks,
  summary,
  currentRound,
  onUndo,
  onReset,
  busy,
}: {
  teamName: string;
  picks: DraftPick[];
  summary: DraftSummary;
  currentRound: number;
  onUndo: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  const realPicks = picks.filter((p) => p.pick_type !== "skip");

  const rows = [];

  for (let i = 1; i <= STOCK_ROUNDS; i++) {
    const pick = realPicks.find(
      (p) => p.pick_type === "stock" && p.round_number === i
    ) ?? picks.find((p) => p.round_number === i && p.pick_type === "stock");
    rows.push({ round: i, type: "stock" as const, pick });
  }

  for (let i = 0; i < BENCH_ROUNDS; i++) {
    const round = STOCK_ROUNDS + 1 + i;
    const pick = realPicks.find(
      (p) => p.pick_type === "bench" && p.round_number === round
    );
    rows.push({ round, type: "bench" as const, pick });
  }

  const cryptoPicks = realPicks.filter((p) => p.pick_type === "crypto");
  for (let i = 0; i < Math.max(CRYPTO_FLEX_ROUNDS, cryptoPicks.length); i++) {
    const round = STOCK_ROUNDS + BENCH_ROUNDS + 1 + i;
    const pick = cryptoPicks[i] ?? picks.find((p) => p.round_number === round && p.pick_type === "crypto");
    rows.push({ round, type: "crypto" as const, pick });
  }

  return (
    <aside className="draft-board">
      <div className="draft-board-header">
        <h2 className="draft-board-title">{teamName} Draft Board</h2>
      </div>

      <div className="draft-board-stats">
        <div>
          <p className="draft-stat-label">Stock picks</p>
          <p className="draft-stat-val text-primary-light">{summary.stockPicks} / {STOCK_ROUNDS}</p>
        </div>
        <div>
          <p className="draft-stat-label">Bench</p>
          <p className="draft-stat-val text-muted">{summary.benchPicks} / {BENCH_ROUNDS}</p>
        </div>
        <div>
          <p className="draft-stat-label">Total spent</p>
          <p className="draft-stat-val">{formatMoney(summary.totalSpent)}</p>
        </div>
        <div>
          <p className="draft-stat-label">Crypto left</p>
          <p className="draft-stat-val text-green-400">{formatMoney(summary.cryptoRemaining)}</p>
        </div>
      </div>

      <div className="draft-board-picks">
        {rows.map(({ round, type, pick }) => {
          const isActive = round === currentRound;
          let label = `Round ${round}`;
          if (type === "bench") label = `Bench ${round - STOCK_ROUNDS}`;
          if (type === "crypto") label = `Crypto ${round - STOCK_ROUNDS - BENCH_ROUNDS}`;

          return (
            <div
              key={`${type}-${round}`}
              className={`draft-board-row ${isActive ? "draft-board-row--active" : ""} ${type === "crypto" ? "draft-board-row--crypto" : ""} ${!pick ? "draft-board-row--empty" : ""}`}
            >
              <span className="draft-board-round">{round}</span>
              <div className="draft-board-pick-info">
                {pick ? (
                  <>
                    <p className="draft-board-ticker">{pick.symbol}</p>
                    <p className="draft-board-detail">
                      {pick.pick_type === "bench"
                        ? "Free bench pick"
                        : pick.pick_type === "crypto"
                          ? `${formatMoney(pick.budget_spent)} → ${formatShares(pick.shares)}${pick.surcharge_percent > 0 ? ` (${pick.surcharge_percent}% sur.)` : ""}`
                          : `${formatShares(pick.shares)} @ ${formatMoney(pick.price_at_pick)}`}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="draft-board-ticker">{label}</p>
                    <p className="draft-board-detail">
                      {type === "stock"
                        ? formatMoney(STOCK_BUDGET)
                        : type === "bench"
                          ? "Free"
                          : "Flex slot"}
                    </p>
                  </>
                )}
              </div>
              {pick && pick.budget_spent > 0 && (
                <p className="draft-board-cost">{formatMoney(pick.budget_spent)}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="draft-board-actions">
        <button
          type="button"
          className="draft-undo-btn"
          disabled={busy || realPicks.length === 0}
          onClick={onUndo}
        >
          Undo last pick
        </button>
        <button
          type="button"
          className="draft-reset-btn"
          disabled={busy || realPicks.length === 0}
          onClick={onReset}
        >
          Reset draft
        </button>
      </div>
    </aside>
  );
}
