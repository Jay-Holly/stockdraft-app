"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatMoney, formatPct, formatSignedMoney } from "@/lib/format";
import { useCryptoPool } from "@/hooks/useCryptoPool";
import { computeCryptoPick, formatShares } from "@/lib/draft/engine";
import type { RosterPickView, RosterView } from "@/lib/roster/types";
import type { LeagueScoringMode } from "@/lib/league/scoring-mode";
import {
  getOrderedPickGainStats,
  type OrderedGainStat,
} from "@/lib/roster/team-stats";
import { Button } from "@/components/Button";
import { StockDetailChartButton } from "@/components/market/StockDetailChartButton";
import {
  fetchJsonWithTimeout,
  formatFetchError,
} from "@/lib/fetch-client";
import { SeasonWeekNavigator } from "@/components/season/SeasonWeekNavigator";
import { SeasonCalendarBanner } from "@/components/season/SeasonCalendarBanner";
import { RosterIrBanner } from "@/components/season/RosterIrBanner";
import { TeamLogoBox } from "@/components/season/TeamLogoBox";
import { useVisibilityAwareInterval } from "@/hooks/useVisibilityAwareInterval";

export function MyTeamPageContent({
  initialRoster = null,
  initialError = null,
}: {
  /** Server-fetched on first render so there's no client-side loading flash. */
  initialRoster?: RosterView | null;
  initialError?: string | null;
} = {}) {
  const [roster, setRoster] = useState<RosterView | null>(initialRoster);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(
    initialRoster?.viewWeek ?? null
  );
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(!initialRoster && !initialError);
  const [busy, setBusy] = useState(false);
  const [irStarterId, setIrStarterId] = useState<string | null>(null);
  const [irBenchId, setIrBenchId] = useState<string | null>(null);
  const [teamLogoUrl, setTeamLogoUrl] = useState<string | null>(
    initialRoster?.teamLogoUrl ?? null
  );
  const [irMoveStarterId, setIrMoveStarterId] = useState<string | null>(null);
  const [irMoveSlotId, setIrMoveSlotId] = useState<string | null>(null);
  const [irReturnPickId, setIrReturnPickId] = useState<string | null>(null);
  const [cryptoPickId, setCryptoPickId] = useState<string | null>(null);
  const { coins: cryptoPool } = useCryptoPool();
  const cryptoSymbols = useMemo(
    () => cryptoPool.map((coin) => coin.symbol),
    [cryptoPool]
  );

  const [cryptoTarget, setCryptoTarget] = useState<string>("BTC");
  const [cryptoSellPercent, setCryptoSellPercent] = useState(100);

  const selectedCryptoPick = useMemo(
    () => roster?.crypto.find((p) => p.id === cryptoPickId) ?? null,
    [roster, cryptoPickId]
  );

  const cryptoBuyOptions = useMemo(() => {
    if (!selectedCryptoPick) return cryptoSymbols;
    const source = selectedCryptoPick.symbol.toUpperCase();
    return cryptoSymbols.filter((symbol) => symbol !== source);
  }, [selectedCryptoPick, cryptoSymbols]);

  useEffect(() => {
    if (!selectedCryptoPick) return;
    if (cryptoTarget.toUpperCase() === selectedCryptoPick.symbol.toUpperCase()) {
      setCryptoTarget(cryptoBuyOptions[0] ?? cryptoSymbols[0] ?? "BTC");
    }
  }, [selectedCryptoPick, cryptoTarget, cryptoBuyOptions]);

  const cryptoRebalancePreview = useMemo(() => {
    if (!roster || !selectedCryptoPick) return null;

    const fraction = cryptoSellPercent / 100;
    const soldBudget = selectedCryptoPick.budget_spent * fraction;
    const soldShares = selectedCryptoPick.shares * fraction;
    const remainingBudget = Math.max(
      0,
      selectedCryptoPick.budget_spent - soldBudget
    );
    const targetUpper = cryptoTarget.toUpperCase();
    const targetPrice = roster.cryptoQuotes[targetUpper]?.price ?? 0;

    const existingTarget = roster.crypto.find(
      (p) =>
        p.id !== selectedCryptoPick.id &&
        p.symbol.toUpperCase() === targetUpper &&
        p.budget_spent > 0.01
    );

    if (existingTarget) {
      const buyShares = targetPrice > 0 ? soldBudget / targetPrice : 0;
      return {
        soldBudget,
        soldShares,
        remainingBudget,
        targetPrice,
        buyShares,
        surchargePercent: 0,
        effectiveBuy: soldBudget,
        mergesIntoExisting: true,
        existingSymbol: existingTarget.symbol,
        createsNewPosition: false,
      };
    }

    const buyerCount = roster.cryptoBuyerCounts[targetUpper] ?? 0;
    const computed = computeCryptoPick(soldBudget, targetPrice, buyerCount);

    return {
      soldBudget,
      soldShares,
      remainingBudget,
      targetPrice,
      buyShares: computed.shares,
      surchargePercent: computed.surchargePercent,
      effectiveBuy: computed.effectiveValue,
      mergesIntoExisting: false,
      createsNewPosition: true,
    };
  }, [roster, selectedCryptoPick, cryptoSellPercent, cryptoTarget]);

  const load = useCallback(async (weekNumber?: number) => {
    try {
      const weekQuery =
        weekNumber != null ? `?week=${encodeURIComponent(String(weekNumber))}` : "";
      const { res, data: json } = await fetchJsonWithTimeout<{
        error?: string;
      } & RosterView>(`/api/roster${weekQuery}`, {
        cache: "no-store",
        timeoutMs: 30_000,
        label: "Roster load",
      });

      if (!res.ok) {
        setError(json.error ?? `Could not load roster (HTTP ${res.status})`);
        setLoading(false);
        return;
      }

      const nextRoster = json as RosterView;
      setRoster(nextRoster);
      setTeamLogoUrl(nextRoster.teamLogoUrl ?? null);
      setSelectedWeek((current) => current ?? nextRoster.viewWeek);
      setError(null);
      setLoading(false);
    } catch (err) {
      setError(formatFetchError(err, "Roster load"));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(selectedWeek ?? undefined);
  }, [load, selectedWeek]);

  const isLiveRoster = Boolean(roster && !roster.isHistorical);

  useVisibilityAwareInterval(
    () => void load(roster?.viewWeek),
    isLiveRoster ? 30_000 : null
  );

  async function handleMoveToIr() {
    if (!irMoveStarterId || !irMoveSlotId) return;
    setBusy(true);
    setError(null);
    try {
      const { res, data: json } = await fetchJsonWithTimeout<{
        error?: string;
      }>("/api/roster/move-to-ir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starterPickId: irMoveStarterId,
          irSlotPickId: irMoveSlotId,
        }),
        timeoutMs: 30_000,
        label: "Move to IR",
      });

      if (!res.ok) {
        setError(json.error ?? `Move to IR failed (HTTP ${res.status})`);
        return;
      }

      setIrMoveStarterId(null);
      setIrMoveSlotId(null);
      void load(selectedWeek ?? roster?.viewWeek).catch((reloadErr) => {
        setError(
          formatFetchError(reloadErr, "Move to IR saved, but roster refresh")
        );
      });
    } catch (err) {
      setError(formatFetchError(err, "Move to IR"));
    } finally {
      setBusy(false);
    }
  }

  async function handleReturnFromIr() {
    if (!irReturnPickId) return;
    setBusy(true);
    setError(null);
    try {
      const openStockPickId = roster?.starters.find(
        (pick) => pick.symbol.toUpperCase() === "__OPEN__"
      )?.id;

      const { res, data: json } = await fetchJsonWithTimeout<{
        error?: string;
      }>("/api/roster/return-from-ir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          irPickId: irReturnPickId,
          openStockPickId,
        }),
        timeoutMs: 30_000,
        label: "Return from IR",
      });

      if (!res.ok) {
        setError(json.error ?? `Return from IR failed (HTTP ${res.status})`);
        return;
      }

      setIrReturnPickId(null);
      void load(selectedWeek ?? roster?.viewWeek).catch((reloadErr) => {
        setError(
          formatFetchError(reloadErr, "Return from IR saved, but roster refresh")
        );
      });
    } catch (err) {
      setError(formatFetchError(err, "Return from IR"));
    } finally {
      setBusy(false);
    }
  }

  async function handleIrSwap() {
    if (!irStarterId || !irBenchId) return;
    setBusy(true);
    setError(null);
    try {
      const { res, data: json } = await fetchJsonWithTimeout<{
        error?: string;
        step?: string;
        success?: boolean;
      }>("/api/roster/ir-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starterPickId: irStarterId,
          benchPickId: irBenchId,
        }),
        timeoutMs: 30_000,
        label: "IR swap",
      });

      if (!res.ok) {
        const detail = json.step ? ` [${json.step}]` : "";
        setError(json.error ?? `IR swap failed (HTTP ${res.status})${detail}`);
        return;
      }

      setIrStarterId(null);
      setIrBenchId(null);
      void load(selectedWeek ?? roster?.viewWeek).catch((reloadErr) => {
        setError(formatFetchError(reloadErr, "IR swap saved, but roster refresh"));
      });
    } catch (err) {
      setError(formatFetchError(err, "IR swap"));
    } finally {
      setBusy(false);
    }
  }

  async function handleCryptoSwap() {
    if (!cryptoPickId) return;
    setBusy(true);
    setError(null);
    try {
      const { res, data: json } = await fetchJsonWithTimeout<{
        error?: string;
        step?: string;
        success?: boolean;
      }>("/api/roster/crypto-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickId: cryptoPickId,
          newSymbol: cryptoTarget,
          sellPercent: cryptoSellPercent,
        }),
        timeoutMs: 30_000,
        label: "Crypto rebalance",
      });

      if (!res.ok) {
        const detail = json.step ? ` [${json.step}]` : "";
        setError(
          json.error ?? `Crypto rebalance failed (HTTP ${res.status})${detail}`
        );
        return;
      }

      setCryptoPickId(null);
      void load(selectedWeek ?? roster?.viewWeek).catch((reloadErr) => {
        setError(
          formatFetchError(reloadErr, "Crypto rebalance saved, but roster refresh")
        );
      });
    } catch (err) {
      setError(formatFetchError(err, "Crypto rebalance"));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !roster) {
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

  const viewingHistorical = roster.isHistorical;
  const lineupLocked =
    !viewingHistorical && roster.calendar?.lineupLocked === true;

  return (
    <div className="space-y-4">
      <section className="season-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">My Team</h1>
            <p className="text-muted text-xs mt-1">
              {viewingHistorical
                ? `Archived week ${roster.viewWeek} snapshot`
                : `Week ${roster.currentWeek} · prices refresh every 15s`}
            </p>
          </div>
          <SeasonWeekNavigator
            selectedWeek={roster.viewWeek}
            currentWeek={roster.currentWeek}
            availableWeeks={roster.availableWeeks}
            onWeekChange={(week) => {
              setLoading(true);
              setSelectedWeek(week);
            }}
          />
        </div>
        <TeamLogoBox
          logoUrl={teamLogoUrl}
          onChange={(next) => setTeamLogoUrl(next)}
        />
        <div
          className={`mt-4 grid grid-cols-1 gap-3 ${
            roster.sportsSimIrEnabled ? "" : "sm:grid-cols-2"
          }`}
        >
          <div className="rounded-lg border border-dark-border bg-dark/40 px-3 py-2">
            <p className="text-xs text-muted">Matchup gain (starters + crypto)</p>
            <p
              className={`text-lg font-bold ${
                (roster.scoringMode === "dollar_gain"
                  ? roster.scoringWeekDollarGain
                  : roster.scoringWeekGainPercent) >= 0
                  ? "text-green-400"
                  : "text-red-400"
              }`}
            >
              {roster.scoringMode === "dollar_gain"
                ? formatSignedMoney(roster.scoringWeekDollarGain)
                : formatPct(roster.scoringWeekGainPercent)}
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              {roster.scoringMode === "dollar_gain"
                ? "Weekly $ · bench excluded · matchup scoring"
                : "Weekly % · bench excluded · matchup scoring"}
            </p>
          </div>
          {!roster.sportsSimIrEnabled && (
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
          )}
        </div>
      </section>

      {!viewingHistorical && (
        <SeasonCalendarBanner calendar={roster.calendar} variant="lineup" />
      )}

      {!viewingHistorical && roster.sportsSimIrEnabled && (
        <RosterIrBanner resolution={roster.irResolution} />
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <RosterBlock
        title="Starting stocks"
        subtitle={
          roster.sportsSimIrEnabled
            ? "Stock starters · scores in matchups · bench swap below"
            : "10 starters · scores in matchups"
        }
        tone="starters"
        scoringMode={roster.scoringMode}
        picks={
          roster.sportsSimIrEnabled
            ? roster.starters.filter((p) => p.pick_type === "stock")
            : roster.starters
        }
        selectable={
          !viewingHistorical &&
          !lineupLocked &&
          !roster.irResolution?.required
        }
        selectedId={irStarterId}
        onSelect={(id) => {
          setIrStarterId((prev) => (prev === id ? null : id));
          setIrMoveStarterId(null);
        }}
        selectLabel="To Bench"
        renderActions={
          roster.sportsSimIrEnabled
            ? (pick) => {
                if (pick.symbol.toUpperCase() === "__OPEN__") return null;
                if (viewingHistorical || lineupLocked || roster.irResolution?.required) {
                  return null;
                }
                return (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`season-select-btn ${irStarterId === pick.id ? "season-select-btn--active" : ""}`}
                      onClick={() => {
                        setIrStarterId((prev) => (prev === pick.id ? null : pick.id));
                        setIrMoveStarterId(null);
                      }}
                    >
                      {irStarterId === pick.id ? "Selected" : "To Bench"}
                    </button>
                    {pick.irEligible && (
                      <button
                        type="button"
                        className={`season-select-btn ${irMoveStarterId === pick.id ? "season-select-btn--active" : ""}`}
                        onClick={() => {
                          setIrMoveStarterId((prev) => (prev === pick.id ? null : pick.id));
                          setIrStarterId(null);
                        }}
                      >
                        {irMoveStarterId === pick.id ? "Selected" : "To IR"}
                      </button>
                    )}
                  </div>
                );
              }
            : undefined
        }
      />

      <RosterBlock
        title={roster.sportsSimIrEnabled ? "Starting crypto" : "Crypto flex"}
        subtitle={
          roster.sportsSimIrEnabled
            ? "Scores in matchups · always active · no bench or IR · tap Sell to rebalance"
            : "Scores in matchups · tap Sell to rebalance · multiple coins OK"
        }
        tone="crypto"
        scoringMode={roster.scoringMode}
        picks={roster.crypto}
        selectable={!viewingHistorical}
        selectedId={cryptoPickId}
        onSelect={(id) => setCryptoPickId((prev) => (prev === id ? null : id))}
        selectLabel="Sell"
      />

      {!viewingHistorical && (
      <section className="season-card">
        <h2 className="season-card-title">Crypto rebalance</h2>
        <p className="text-sm text-muted mb-3">
          Sell a portion of one coin and buy another with the proceeds. Your
          original position stays open at the remaining size — you can hold
          multiple coins at once. League surcharge tiers apply only when you
          buy a coin you don&apos;t already hold on your roster.
        </p>

        {!cryptoPickId && (
          <p className="text-xs text-muted mb-3">
            Select a coin under {roster.sportsSimIrEnabled ? "Starting crypto" : "Crypto flex"} (tap{" "}
            <strong>Sell</strong>) to start.
          </p>
        )}

        {selectedCryptoPick && (
          <p className="text-xs text-primary-light mb-3">
            Selling from: <strong>{selectedCryptoPick.symbol}</strong> (
            {formatMoney(selectedCryptoPick.budget_spent)} budget)
          </p>
        )}

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
          Selling {cryptoSellPercent}% of{" "}
          {selectedCryptoPick?.symbol ?? "selected position"}
          {cryptoRebalancePreview
            ? ` · ${formatMoney(cryptoRebalancePreview.soldBudget)} proceeds`
            : ""}
        </p>

        <label className="text-xs text-muted block mb-1">Buy with proceeds</label>
        <select
          className="season-select w-full mb-3"
          value={cryptoTarget}
          onChange={(e) => setCryptoTarget(e.target.value)}
          disabled={!cryptoPickId || busy}
        >
          {cryptoBuyOptions.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>

        {cryptoRebalancePreview && cryptoRebalancePreview.soldBudget >= 0.01 && (
          <div className="crypto-rebalance-preview mb-3">
            <p className="crypto-rebalance-preview__title">Preview</p>
            <ul className="crypto-rebalance-preview__list">
              <li>
                Sell {formatShares(cryptoRebalancePreview.soldShares)}{" "}
                {selectedCryptoPick?.symbol} for{" "}
                {formatMoney(cryptoRebalancePreview.soldBudget)}
              </li>
              {cryptoRebalancePreview.remainingBudget >= 0.01 && (
                <li>
                  Keep {formatMoney(cryptoRebalancePreview.remainingBudget)} in{" "}
                  {selectedCryptoPick?.symbol}
                </li>
              )}
              {cryptoRebalancePreview.mergesIntoExisting ? (
                <li>
                  Add to existing {cryptoRebalancePreview.existingSymbol} position
                  (no surcharge)
                </li>
              ) : cryptoRebalancePreview.surchargePercent > 0 ? (
                <li>
                  {cryptoRebalancePreview.surchargePercent}% league surcharge on
                  new {cryptoTarget} · effective buy{" "}
                  {formatMoney(cryptoRebalancePreview.effectiveBuy)}
                </li>
              ) : (
                <li>Open new {cryptoTarget} position (no surcharge)</li>
              )}
              <li>
                Receive ~{formatShares(cryptoRebalancePreview.buyShares)}{" "}
                {cryptoTarget}
                {cryptoRebalancePreview.targetPrice > 0
                  ? ` @ ${formatMoney(cryptoRebalancePreview.targetPrice)}`
                  : ""}
              </li>
            </ul>
          </div>
        )}

        <Button
          variant="secondary"
          className="w-full"
          disabled={
            busy ||
            !cryptoPickId ||
            !cryptoRebalancePreview ||
            cryptoRebalancePreview.soldBudget < 0.01
          }
          onClick={handleCryptoSwap}
        >
          {busy
            ? "Processing…"
            : cryptoSellPercent === 100
              ? `Swap ${selectedCryptoPick?.symbol ?? "coin"} → ${cryptoTarget}`
              : `Rebalance ${cryptoSellPercent}% → ${cryptoTarget}`}
        </Button>
      </section>
      )}


      <RosterBlock
        title="Bench"
        subtitle="Does not score · promote via IR swap"
        tone="bench"
        scoringMode={roster.scoringMode}
        picks={roster.bench}
        selectable={!viewingHistorical && !lineupLocked && !roster.irResolution?.required}
        selectedId={irBenchId}
        onSelect={(id) => setIrBenchId((prev) => (prev === id ? null : id))}
        selectLabel="Promote"
        footer={
          !viewingHistorical ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">
                Bench a starter and call up a bench player.
              </p>
              <Button
                variant="primary"
                className="w-full"
                disabled={
                  busy ||
                  lineupLocked ||
                  roster.irResolution?.required ||
                  !irStarterId ||
                  !irBenchId
                }
                onClick={handleIrSwap}
              >
                {busy
                  ? "Processing…"
                  : lineupLocked
                    ? "Lineups locked until 4:00 PM ET"
                    : "Confirm bench promote"}
              </Button>
            </div>
          ) : undefined
        }
      />

      {roster.sportsSimIrEnabled && (
        <RosterBlock
          title="Injured reserve"
          subtitle="Up to 3 slots · does not score · injury-eligible stocks only"
          tone="ir"
          scoringMode={roster.scoringMode}
          picks={roster.ir ?? []}
          selectable={!viewingHistorical}
          selectedId={irMoveSlotId ?? irReturnPickId}
          onSelect={(id) => {
            const pick = roster.ir?.find((row) => row.id === id);
            if (!pick) return;
            if (pick.symbol.toUpperCase() === "__OPEN__") {
              setIrMoveSlotId((prev) => (prev === id ? null : id));
              setIrReturnPickId(null);
              return;
            }
            const stale = roster.irResolution?.picks.some((row) => row.pickId === id);
            if (stale) {
              setIrReturnPickId((prev) => (prev === id ? null : id));
              setIrMoveSlotId(null);
            }
          }}
          selectLabel={
            roster.irResolution?.required ? "Return" : "IR slot"
          }
          footer={
            !viewingHistorical ? (
              <div className="space-y-2">
                <p className="text-sm text-muted">
                  Select an injury-eligible starter and an empty IR slot.
                </p>
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={
                    busy ||
                    roster.irResolution?.required ||
                    !irMoveStarterId ||
                    !irMoveSlotId
                  }
                  onClick={handleMoveToIr}
                >
                  {busy ? "Processing…" : "Move starter to IR"}
                </Button>

                {roster.irResolution?.required && (
                  <>
                    <p className="text-sm text-muted">
                      Drop or bench a starter to open an active slot, then return
                      the healed stock from IR.
                    </p>
                    <Button
                      variant="primary"
                      className="w-full"
                      disabled={busy || !irReturnPickId}
                      onClick={handleReturnFromIr}
                    >
                      {busy ? "Processing…" : "Return selected stock to active"}
                    </Button>
                  </>
                )}
              </div>
            ) : undefined
          }
        />
      )}

    </div>
  );
}

function formatPickGainStat(stat: OrderedGainStat): string {
  return stat.format === "money"
    ? formatSignedMoney(stat.value)
    : formatPct(stat.value);
}

function PickGainStats({
  pick,
  scoringMode,
}: {
  pick: RosterPickView;
  scoringMode: LeagueScoringMode;
}) {
  const stats = getOrderedPickGainStats(pick, scoringMode);

  return (
    <div className="space-y-0.5">
      {stats.map((stat, index) => (
        <p
          key={stat.key}
          className={`${
            index === 0 ? "text-sm font-semibold" : "text-[11px] font-medium"
          } ${stat.value >= 0 ? "text-green-400" : "text-red-400"}`}
        >
          {formatPickGainStat(stat)}
          <span className="text-muted font-normal"> · {stat.label}</span>
        </p>
      ))}
    </div>
  );
}

function RosterBlock({
  title,
  subtitle,
  tone,
  scoringMode,
  picks,
  selectable = false,
  selectedId,
  onSelect,
  selectLabel,
  renderActions,
  footer,
}: {
  title: string;
  subtitle: string;
  tone: "starters" | "bench" | "crypto" | "ir";
  scoringMode: LeagueScoringMode;
  picks: RosterPickView[];
  selectable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  selectLabel?: string;
  /** Overrides the default single-button action with custom per-row actions. */
  renderActions?: (pick: RosterPickView) => ReactNode;
  /** Optional content rendered inside the card, below the pick rows. */
  footer?: ReactNode;
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
            <div
              key={pick.id}
              className={`season-roster-row${pick.irEligible ? " season-roster-row--injured" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div>
                    <p className="font-semibold">
                      {pick.symbol.toUpperCase() === "__OPEN__"
                        ? "Empty slot"
                        : pick.symbol}
                    </p>
                    {pick.companyName && pick.symbol.toUpperCase() !== "__OPEN__" && (
                      <p className="text-xs text-muted">{pick.companyName}</p>
                    )}
                  </div>
                  {pick.irEligible && (
                    <span className="season-injury-badge">INJURED</span>
                  )}
                  {pick.symbol.toUpperCase() !== "__OPEN__" && (
                    <StockDetailChartButton symbol={pick.symbol} />
                  )}
                </div>
                <p
                  className={`text-xs ${pick.irEligible ? "season-injury-note" : "text-muted"}`}
                >
                  {pick.irEligible
                    ? "Player on IR · bench it or score a zero"
                    : pick.symbol.toUpperCase() === "__OPEN__"
                    ? "Released to free agency"
                    : pick.pick_type === "bench" && pick.budget_spent === 0
                    ? pick.acquired_via === "waiver"
                      ? "Waiver pickup · $0 until promoted"
                      : "Bench · does not score"
                    : pick.pick_type === "crypto"
                      ? `${formatMoney(pick.budget_spent)} · ${formatShares(pick.shares)}`
                      : `${formatShares(pick.shares)} · ${formatMoney(pick.budget_spent)}`}
                </p>
              </div>
              <div className="text-right shrink-0 mr-2 min-w-[8.5rem]">
                <p className="text-sm font-semibold">
                  {formatMoney(pick.currentValue)}
                </p>
                <p className="text-[11px] text-muted mb-1">Value</p>
                {pick.symbol.toUpperCase() !== "__OPEN__" && (
                  <PickGainStats pick={pick} scoringMode={scoringMode} />
                )}
              </div>
              {renderActions
                ? renderActions(pick)
                : selectable &&
                  onSelect &&
                  selectLabel && (
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
      {footer && <div className="px-4 py-3 border-t border-white/10">{footer}</div>}
    </section>
  );
}
