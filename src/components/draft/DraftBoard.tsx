"use client";

import {
  BENCH_ROUNDS,
  BENCH_START_ROUND,
  formatMoney,
  formatShares,
  OPEN_ROUNDS,
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
  showActions = true,
  sportsSimDraftRules = false,
  subtitle,
  emptyMessage,
}: {
  teamName: string;
  picks: DraftPick[];
  summary: DraftSummary;
  currentRound: number;
  onUndo?: () => void;
  onReset?: () => void;
  busy?: boolean;
  showActions?: boolean;
  sportsSimDraftRules?: boolean;
  subtitle?: string;
  emptyMessage?: string;
}) {
  const realPicks = picks.filter((p) => p.pick_type !== "skip");
  const rows: Array<{
    round: number;
    type: "open" | "bench";
    pick?: DraftPick;
    skipped?: boolean;
  }> = [];

  for (let round = 1; round <= OPEN_ROUNDS; round++) {
    const pick = realPicks.find((p) => p.round_number === round);
    const skipped = picks.some(
      (p) => p.pick_type === "skip" && p.round_number === round
    );
    rows.push({ round, type: "open", pick, skipped });
  }

  for (let i = 0; i < BENCH_ROUNDS; i++) {
    const round = BENCH_START_ROUND + i;
    const pick = realPicks.find(
      (p) => p.pick_type === "bench" && p.round_number === round
    );
    rows.push({ round, type: "bench", pick });
  }

  const openSlotPicks = realPicks.filter(
    (p) =>
      p.round_number <= OPEN_ROUNDS &&
      (p.pick_type === "stock" || p.pick_type === "crypto")
  ).length;

  return (
    <aside className="draft-board">
      <div className="draft-board-header">
        <h2 className="draft-board-title">{teamName} Draft Board</h2>
        {subtitle && <p className="draft-board-subtitle">{subtitle}</p>}
      </div>

      <div className="draft-board-stats">
        <div>
          <p className="draft-stat-label">
            {sportsSimDraftRules ? "Open slots" : "Stock picks"}
          </p>
          <p className="draft-stat-val text-primary-light">
            {sportsSimDraftRules
              ? `${openSlotPicks} / ${STOCK_ROUNDS}`
              : `${summary.stockPicks} / ${STOCK_ROUNDS}`}
          </p>
        </div>
        <div>
          <p className="draft-stat-label">Bench</p>
          <p className="draft-stat-val text-muted">
            {summary.benchPicks} / {BENCH_ROUNDS}
          </p>
        </div>
        {!sportsSimDraftRules && (
          <>
            <div>
              <p className="draft-stat-label">Open rounds</p>
              <p className="draft-stat-val text-muted">
                {realPicks.filter((p) => p.round_number <= OPEN_ROUNDS && p.pick_type !== "bench").length} / {OPEN_ROUNDS}
              </p>
            </div>
            <div>
              <p className="draft-stat-label">Crypto left</p>
              <p className="draft-stat-val text-green-400">
                {formatMoney(summary.cryptoRemaining)}
              </p>
            </div>
          </>
        )}
        {sportsSimDraftRules && (
          <div>
            <p className="draft-stat-label">Crypto picks</p>
            <p className="draft-stat-val text-green-400">
              {summary.cryptoPicks}
            </p>
          </div>
        )}
      </div>

      <div className="draft-board-picks">
        {emptyMessage && realPicks.length === 0 && (
          <p className="draft-board-empty">{emptyMessage}</p>
        )}
        {rows.map(({ round, type, pick, skipped }) => {
          const isActive = showActions && round === currentRound;
          const isCrypto = pick?.pick_type === "crypto";
          let label = `Round ${round}`;
          if (type === "bench") label = `Bench ${round - OPEN_ROUNDS}`;

          return (
            <div
              key={`${type}-${round}`}
              className={`draft-board-row ${isActive ? "draft-board-row--active" : ""} ${isCrypto ? "draft-board-row--crypto" : ""} ${skipped ? "draft-board-row--skipped" : ""} ${!pick && !skipped ? "draft-board-row--empty" : ""}`}
            >
              <span className="draft-board-round">{round}</span>
              <div className="draft-board-pick-info">
                {skipped ? (
                  <>
                    <p className="draft-board-ticker">Skipped</p>
                    <p className="draft-board-detail">Crypto pushback penalty</p>
                  </>
                ) : pick ? (
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
                      {type === "bench"
                        ? "Free"
                        : sportsSimDraftRules
                          ? "Stock or crypto $80K"
                          : "Stock $80K or crypto"}
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

      {showActions && onUndo && onReset && (
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
      )}
    </aside>
  );
}
