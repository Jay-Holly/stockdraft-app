"use client";

import { useCallback, useEffect, useState } from "react";
import { formatMoney, formatPct, formatSignedMoney } from "@/lib/format";
import { formatShares } from "@/lib/draft/engine";
import { CRYPTO_SYMBOLS } from "@/lib/market/symbols";
import type { RosterPickView, RosterView } from "@/lib/roster/types";
import { Button } from "@/components/Button";
import {
  StockDetailModal,
  type StockDetailContext,
} from "@/components/market/StockDetailModal";
import { useStockMetaLookup } from "@/hooks/useStockMetaLookup";

export function MyTeamPageContent() {
  const [roster, setRoster] = useState<RosterView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [irStarterId, setIrStarterId] = useState<string | null>(null);
  const [irBenchId, setIrBenchId] = useState<string | null>(null);
  const [cryptoPickId, setCryptoPickId] = useState<string | null>(null);
  const [cryptoTarget, setCryptoTarget] = useState<string>(CRYPTO_SYMBOLS[0]);
  const [cryptoSellPercent, setCryptoSellPercent] = useState(100);
  const [detailPick, setDetailPick] = useState<RosterPickView | null>(null);
  const [detailSlotLabel, setDetailSlotLabel] = useState<string>("");

  const { getMeta } = useStockMetaLookup();

  const load = useCallback(async () => {
    const res = await fetch("/api/roster", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Could not load roster");
      setLoading(false);
      return;
    }
    setRoster(json as RosterView);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function handleIrSwap() {
    if (!irStarterId || !irBenchId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/roster/ir-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starterPickId: irStarterId,
          benchPickId: irBenchId,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? `IR swap failed (${res.status})`);
        return;
      }
      setIrStarterId(null);
      setIrBenchId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error during IR swap");
    } finally {
      setBusy(false);
    }
  }

  async function handleCryptoSwap() {
    if (!cryptoPickId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/roster/crypto-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickId: cryptoPickId,
          newSymbol: cryptoTarget,
          sellPercent: cryptoSellPercent,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? `Crypto rebalance failed (${res.status})`);
        return;
      }
      setCryptoPickId(null);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error during crypto rebalance"
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-muted text-sm py-12 text-center">Loading roster…</p>;
  }

  if (error && !roster) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!roster) return null;

  return (
    <div className="space-y-4">
      <section className="season-card">
        <h1 className="text-xl font-bold">My Team</h1>
        <p className="text-muted text-xs mt-1">
          Week {roster.currentWeek} · prices refresh every 15s
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-dark-border bg-dark/40 px-3 py-2">
            <p className="text-xs text-muted">Matchup gain (starters + crypto)</p>
            <p
              className={`text-lg font-bold ${
                roster.scoringWeekGainPercent >= 0
                  ? "text-green-400"
                  : "text-red-400"
              }`}
            >
              {formatPct(roster.scoringWeekGainPercent)}
            </p>
            <p className="text-[11px] text-muted mt-0.5">Weekly % · bench excluded</p>
          </div>
          <div className="rounded-lg border border-dark-border bg-dark/40 px-3 py-2">
            <p className="text-xs text-muted">Winner of the Week pace</p>
            <p
              className={`text-lg font-bold ${
                roster.totalWeekDollarGain >= 0 ? "text-green-400" : "text-red-400"
              }`}
            >
              {formatSignedMoney(roster.totalWeekDollarGain)}
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              Weekly $ · full roster incl. bench
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <RosterBlock
        title="Starting stocks"
        subtitle="10 starters · scores in matchups"
        tone="starters"
        picks={roster.starters}
        selectable
        selectedId={irStarterId}
        onSelect={(id) =>
          setIrStarterId((prev) => (prev === id ? null : id))
        }
        selectLabel="Bench"
        onOpenDetail={(pick) => {
          setDetailPick(pick);
          setDetailSlotLabel("Starter");
        }}
      />

      <RosterBlock
        title="Bench"
        subtitle="Does not score · promote via IR swap"
        tone="bench"
        picks={roster.bench}
        selectable
        selectedId={irBenchId}
        onSelect={(id) => setIrBenchId((prev) => (prev === id ? null : id))}
        selectLabel="Promote"
        onOpenDetail={(pick) => {
          setDetailPick(pick);
          setDetailSlotLabel("Bench");
        }}
      />

      <section className="season-card">
        <h2 className="season-card-title">IR swap</h2>
        <p className="text-sm text-muted mb-3">
          Bench a starter and call up a bench player. The promoted stock receives
          budget equal to the benched starter&apos;s current market value (not the
          original $80K).
        </p>
        <Button
          variant="primary"
          className="w-full"
          disabled={busy || !irStarterId || !irBenchId}
          onClick={handleIrSwap}
        >
          {busy ? "Processing…" : "Confirm IR swap"}
        </Button>
      </section>

      <RosterBlock
        title="Crypto flex"
        subtitle="Scores in matchups · day-trade anytime"
        tone="crypto"
        picks={roster.crypto}
        selectable
        selectedId={cryptoPickId}
        onSelect={(id) => setCryptoPickId((prev) => (prev === id ? null : id))}
        selectLabel="Sell"
        onOpenDetail={(pick) => {
          setDetailPick(pick);
          setDetailSlotLabel("Crypto flex");
        }}
      />

      <section className="season-card">
        <h2 className="season-card-title">Crypto rebalance</h2>
        <p className="text-sm text-muted mb-3">
          Sell part of a crypto position and buy a different coin with the
          proceeds. You can hold multiple coins at once. A league surcharge applies
          the first time you buy a coin you do not already hold.
        </p>
        <label className="text-xs text-muted block mb-1">
          Sell percentage
        </label>
        <div className="flex flex-wrap gap-2 mb-3">
          {[25, 33, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              className={`season-select-btn ${cryptoSellPercent === pct ? "season-select-btn--active" : ""}`}
              disabled={!cryptoPickId || busy}
              onClick={() => setCryptoSellPercent(pct)}
            >
              {pct}%
            </button>
          ))}
        </div>
        <input
          type="range"
          min={1}
          max={100}
          value={cryptoSellPercent}
          onChange={(e) => setCryptoSellPercent(Number(e.target.value))}
          disabled={!cryptoPickId || busy}
          className="w-full mb-1"
        />
        <p className="text-xs text-muted mb-3">
          Selling {cryptoSellPercent}% of the selected position
        </p>
        <label className="text-xs text-muted block mb-1">Buy with proceeds</label>
        <select
          className="season-select w-full mb-3"
          value={cryptoTarget}
          onChange={(e) => setCryptoTarget(e.target.value)}
          disabled={!cryptoPickId || busy}
        >
          {CRYPTO_SYMBOLS.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          className="w-full"
          disabled={busy || !cryptoPickId}
          onClick={handleCryptoSwap}
        >
          {busy ? "Processing…" : "Rebalance crypto"}
        </Button>
      </section>

      <StockDetailModal
        open={!!detailPick}
        symbol={detailPick?.symbol ?? null}
        meta={detailPick ? getMeta(detailPick.symbol) : undefined}
        quote={
          detailPick
            ? {
                price: detailPick.currentPrice,
                changePercent: detailPick.changePercent,
              }
            : null
        }
        context={
          detailPick
            ? ({
                slotLabel: detailSlotLabel,
                budgetSpent: detailPick.budget_spent,
                shares: detailPick.shares,
                scores: detailPick.scores,
                gainPercent: detailPick.gainPercent,
              } satisfies StockDetailContext)
            : undefined
        }
        onClose={() => {
          setDetailPick(null);
          setDetailSlotLabel("");
        }}
      />
    </div>
  );
}

function RosterBlock({
  title,
  subtitle,
  tone,
  picks,
  selectable = false,
  selectedId,
  onSelect,
  selectLabel,
  onOpenDetail,
}: {
  title: string;
  subtitle: string;
  tone: "starters" | "bench" | "crypto";
  picks: RosterPickView[];
  selectable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  selectLabel?: string;
  onOpenDetail?: (pick: RosterPickView) => void;
}) {
  return (
    <section className="season-card overflow-hidden p-0">
      <div className={`draft-roster-head draft-roster-head--${tone} px-4 py-3`}>
        <div>
          <h2 className="season-card-title">{title}</h2>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
      </div>
      <div>
        {picks.length === 0 ? (
          <p className="text-sm text-muted p-4">No picks in this slot.</p>
        ) : (
          picks.map((pick) => (
            <div key={pick.id} className="season-roster-row">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="stock-detail-symbol-btn"
                  onClick={() => onOpenDetail?.(pick)}
                >
                  {pick.symbol}
                </button>
                <p className="text-xs text-muted">
                  {pick.pick_type === "bench" && pick.budget_spent === 0
                    ? pick.acquired_via === "waiver"
                      ? "Waiver pickup · $0 until promoted"
                      : "Bench · does not score"
                    : pick.pick_type === "crypto"
                      ? `${formatMoney(pick.budget_spent)} · ${formatShares(pick.shares)}`
                      : `${formatShares(pick.shares)} · ${formatMoney(pick.budget_spent)}`}
                </p>
              </div>
              <div className="text-right shrink-0 mr-2">
                <p className="text-sm font-semibold">
                  {formatMoney(pick.currentValue)}
                </p>
                <p className="text-[11px] text-muted">Value</p>
                <p
                  className={`text-xs font-medium ${
                    pick.weekDollarGain >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {formatSignedMoney(pick.weekDollarGain)} wk
                </p>
                {pick.scores && (
                  <p
                    className={`text-[11px] ${
                      pick.gainPercent >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {formatPct(pick.gainPercent)} season
                  </p>
                )}
              </div>
              {selectable && onSelect && selectLabel && (
                <button
                  type="button"
                  className={`season-select-btn ${selectedId === pick.id ? "season-select-btn--active" : ""}`}
                  onClick={() => onSelect(pick.id)}
                >
                  {selectedId === pick.id ? "Selected" : selectLabel}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
