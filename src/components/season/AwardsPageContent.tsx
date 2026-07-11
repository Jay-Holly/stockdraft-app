"use client";

import { useCallback, useEffect, useState } from "react";
import { formatMoney } from "@/lib/format";
import type { AwardsPageData } from "@/lib/awards/page-data";
import {
  fetchJsonWithTimeout,
  formatFetchError,
} from "@/lib/fetch-client";
import { SeasonWeekNavigator } from "@/components/season/SeasonWeekNavigator";
import { Button } from "@/components/Button";

export function AwardsPageContent() {
  const [data, setData] = useState<AwardsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimSymbols, setClaimSymbols] = useState<Record<string, string>>({});
  const [playoffPickIds, setPlayoffPickIds] = useState<Record<string, string>>(
    {}
  );

  const load = useCallback(async (weekNumber?: number) => {
    try {
      const weekQuery =
        weekNumber != null ? `?week=${encodeURIComponent(String(weekNumber))}` : "";
      const { res, data: json } = await fetchJsonWithTimeout<
        AwardsPageData & { error?: string }
      >(`/api/awards${weekQuery}`, {
        cache: "no-store",
        timeoutMs: 45_000,
        label: "Awards load",
      });

      if (!res.ok) {
        setError(json.error ?? `Could not load awards (HTTP ${res.status})`);
        setLoading(false);
        return;
      }

      setData(json as AwardsPageData);
      setSelectedWeek((current) => current ?? json.viewWeek);
      setError(null);
      setLoading(false);
    } catch (err) {
      setError(formatFetchError(err, "Awards load"));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(selectedWeek ?? undefined);
  }, [load, selectedWeek]);

  async function handleClaim(payoutId: string) {
    const symbol = claimSymbols[payoutId];
    if (!symbol) {
      setError("Choose a crypto coin before claiming.");
      return;
    }

    setClaimingId(payoutId);
    setError(null);

    try {
      const res = await fetch("/api/awards/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId, targetSymbol: symbol }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not claim award.");
        setClaimingId(null);
        return;
      }

      await load(data?.viewWeek);
      setClaimingId(null);
    } catch (err) {
      setError(formatFetchError(err, "Award claim"));
      setClaimingId(null);
    }
  }

  async function handlePlayoffClaim(payoutId: string) {
    const targetPickId = playoffPickIds[payoutId];
    if (!targetPickId) {
      setError("Choose a starter or bench stock before claiming.");
      return;
    }

    setClaimingId(payoutId);
    setError(null);

    try {
      const res = await fetch("/api/awards/playoff-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId, targetPickId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not claim playoff bonus.");
        setClaimingId(null);
        return;
      }

      await load(data?.viewWeek);
      setClaimingId(null);
    } catch (err) {
      setError(formatFetchError(err, "Playoff claim"));
      setClaimingId(null);
    }
  }

  if (loading && !data) {
    return (
      <p className="text-muted text-sm py-12 text-center">Loading awards…</p>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
        {error ?? "No awards data available."}
      </div>
    );
  }

  const weekOptions =
    data.availableWeeks.length > 0
      ? data.availableWeeks
      : Array.from({ length: Math.max(1, data.currentWeek - 1) }, (_, i) => i + 1);

  const poolAccumulating =
    data.pool.playoffAllocationStatus === "accumulating";

  return (
    <div className="space-y-6">
      <section className="season-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Weekly Awards</h1>
            <p className="text-muted text-sm mt-1">
              {data.leagueName} · bonus pool & weekly winners
            </p>
          </div>
          {data.availableWeeks.length > 0 && (
            <SeasonWeekNavigator
              selectedWeek={data.viewWeek}
              currentWeek={data.currentWeek}
              availableWeeks={weekOptions}
              label="Award week"
              onWeekChange={(week) => {
                setLoading(true);
                setSelectedWeek(week);
              }}
            />
          )}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      )}

      {!data.awardsEnabled && (
        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
          Weekly bonus awards apply to SDPL-format leagues only. This league
          does not run the bonus pool.
        </div>
      )}

      {data.awardsEnabled && (
        <section className="season-card border-[var(--color-league-primary)]/35 bg-[var(--color-league-primary)]/5 space-y-3">
          <div>
            <h2 className="season-card-title">Playoff bonus pool</h2>
            <p className="text-sm text-muted mt-1">
              {poolAccumulating
                ? "Grows each week from the season seed plus unclaimed weekly awards."
                : "Allocated to top-4 seeds at the start of playoffs."}
            </p>
          </div>
          <p className="text-3xl font-black text-[var(--color-league-primary)]">
            {formatMoney(data.pool.playoffPoolBalance)}
          </p>
          {poolAccumulating ? (
            <div className="text-sm text-muted space-y-1">
              <p>
                {formatMoney(data.pool.playoffSeedAmount)} season seed +{" "}
                {formatMoney(data.pool.rolloverFromWeeks)} from unclaimed weekly
                awards
              </p>
              <p className="text-xs">
                Top 4 seeds split the full pool 40% / 25% / 20% / 15% at week 12.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">
              Split among playoff seeds — invest into a starter or bench stock.
            </p>
          )}
          {data.playoffLedger.length > 0 && poolAccumulating && (
            <div className="rounded-lg border border-dark-border bg-dark/40 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border text-muted">
                    <th className="text-left px-3 py-2 font-medium">Event</th>
                    <th className="text-right px-3 py-2 font-medium">Amount</th>
                    <th className="text-right px-3 py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.playoffLedger
                    .filter((row) => row.eventType !== "allocation")
                    .map((row, index) => (
                      <tr key={`${row.eventType}-${index}`} className="border-b border-dark-border/50 last:border-0">
                        <td className="px-3 py-2">
                          {row.eventType === "seed"
                            ? "Season seed"
                            : row.eventType === "weekly_rollover"
                              ? `Week ${row.weekNumber ?? "?"} rollover`
                              : row.eventType}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {row.amountUsd >= 0 ? "+" : ""}
                          {formatMoney(row.amountUsd)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {formatMoney(row.balanceAfter)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data.pendingPlayoff.length > 0 && (
        <section className="season-card border-[var(--color-league-primary)]/30 bg-[var(--color-league-primary)]/5 space-y-4">
          <div>
            <h2 className="season-card-title">Your playoff bonus</h2>
            <p className="text-sm text-muted mt-1">
              Choose a starter or bench stock to invest your seed-based share.
            </p>
          </div>
          {data.pendingPlayoff.map((payout) => (
            <div
              key={payout.id}
              className="rounded-xl border border-[var(--color-league-primary)]/25 bg-dark/40 p-4 space-y-3"
            >
              <div>
                <p className="font-bold">
                  #{payout.seed_rank} seed · {payout.share_pct}% of pool
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {formatMoney(payout.amount_usd)} from{" "}
                  {formatMoney(payout.total_pool_amount)} total
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  className="season-week-nav__select flex-1"
                  value={playoffPickIds[payout.id] ?? ""}
                  onChange={(event) =>
                    setPlayoffPickIds((current) => ({
                      ...current,
                      [payout.id]: event.target.value,
                    }))
                  }
                >
                  <option value="">Choose stock…</option>
                  {data.stockPickOptions.map((pick) => (
                    <option key={pick.pickId} value={pick.pickId}>
                      {pick.symbol} ({pick.pickType}) ·{" "}
                      {formatMoney(pick.budgetSpent)}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  disabled={claimingId === payout.id}
                  onClick={() => void handlePlayoffClaim(payout.id)}
                >
                  {claimingId === payout.id ? "Investing…" : "Invest bonus"}
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {data.pending.length > 0 && (
        <section className="season-card border-[var(--color-league-primary)]/30 bg-[var(--color-league-primary)]/5 space-y-4">
          <div>
            <h2 className="season-card-title">Your pending claims</h2>
            <p className="text-sm text-muted mt-1">
              Choose a crypto flex coin to deposit each award into your roster.
            </p>
          </div>
          <div className="space-y-3">
            {data.pending.map((payout) => (
              <div
                key={payout.id}
                className="rounded-xl border border-[var(--color-league-primary)]/25 bg-dark/40 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">
                      {payout.award_emoji} {payout.award_label}
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      Week {payout.week_number} · {formatMoney(payout.amount_usd)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    className="season-week-nav__select flex-1"
                    value={claimSymbols[payout.id] ?? ""}
                    onChange={(event) =>
                      setClaimSymbols((current) => ({
                        ...current,
                        [payout.id]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose coin…</option>
                    {data.cryptoOptions.map((coin) => (
                      <option key={coin.symbol} value={coin.symbol}>
                        {coin.symbol} — {coin.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    disabled={claimingId === payout.id}
                    onClick={() => void handleClaim(payout.id)}
                  >
                    {claimingId === payout.id ? "Claiming…" : "Claim award"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.awardsEnabled && (
        <section className="season-card space-y-3">
          <h2 className="season-card-title">Weekly bonus pool</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-dark-border bg-dark/40 px-3 py-2">
              <p className="text-xs text-muted">This week&apos;s pool</p>
              <p className="text-lg font-bold text-[var(--color-league-primary)]">
                {formatMoney(data.pool.weeklyPoolAmount)}
              </p>
              <p className="text-[11px] text-muted mt-0.5">
                Base {formatMoney(data.pool.weeklyBaseAmount)}
                {data.pool.draftSurchargeTotal > 0 ? " + surcharge share" : ""}
              </p>
            </div>
            <div className="rounded-lg border border-dark-border bg-dark/40 px-3 py-2">
              <p className="text-xs text-muted">Unclaimed rollover</p>
              <p className="text-lg font-bold">
                {formatMoney(data.pool.rolloverBalance)}
              </p>
              <p className="text-[11px] text-muted mt-0.5">
                Feeds the playoff pool above
              </p>
            </div>
          </div>
          <p className="text-xs text-muted">
            Season base {formatMoney(data.pool.seasonBaseTotal)} —{" "}
            {formatMoney(data.pool.playoffSeedAmount)} to playoffs, remainder
            split across 11 regular-season weeks.
          </p>
        </section>
      )}

      {data.playoffPayoutBoard.length > 0 && (
        <section className="season-card space-y-3">
          <h2 className="season-card-title">Playoff bonus split</h2>
          <div className="space-y-2">
            {data.playoffPayoutBoard.map((row) => (
              <div
                key={row.id}
                className={`rounded-xl border px-3 py-3 flex flex-wrap items-center justify-between gap-2 ${
                  row.isViewer
                    ? "border-[var(--color-league-primary)]/40 bg-[var(--color-league-primary)]/5"
                    : "border-dark-border bg-dark/30"
                }`}
              >
                <div>
                  <p className="font-bold">
                    #{row.seedRank} · {row.teamName}
                    {row.isViewer && (
                      <span className="text-[var(--color-league-primary)] text-sm ml-1">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {row.sharePct}% ·{" "}
                    {row.status === "pending"
                      ? "Pending stock selection"
                      : row.targetSymbol
                        ? `Invested in ${row.targetSymbol}`
                        : row.status}
                  </p>
                </div>
                <p className="text-sm font-bold text-[var(--color-league-primary)]">
                  {formatMoney(row.amountUsd)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.awardsEnabled && (
        <section className="season-card space-y-4">
          <div>
            <h2 className="season-card-title">
              Week {data.viewWeek} winners
            </h2>
            <p className="text-sm text-muted mt-1">
              {data.weekHasResults
                ? data.viewWeek < data.currentWeek
                  ? "Finalized weekly bonus awards"
                  : "Awards computed for this week"
                : "No awards finalized for this week yet"}
            </p>
          </div>

          {!data.weekHasResults ? (
            <p className="text-sm text-muted">
              Awards run after weekly matchup scoring finalizes (Monday 6 AM ET).
            </p>
          ) : (
            <div className="space-y-2">
              {data.weekAwards.map((award) => (
                <div
                  key={award.id}
                  className={`rounded-xl border px-3 py-3 flex flex-wrap items-start justify-between gap-2 ${
                    award.isViewerWinner
                      ? "border-[var(--color-league-primary)]/40 bg-[var(--color-league-primary)]/5"
                      : "border-dark-border bg-dark/30"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-bold">
                      {award.awardEmoji} {award.awardLabel}
                    </p>
                    {award.winnerTeamName ? (
                      <p className="text-sm mt-0.5">
                        {award.winnerTeamName}
                        {award.isViewerWinner && (
                          <span className="text-[var(--color-league-primary)] font-semibold"> · You</span>
                        )}
                        {award.qualifyingSymbol && (
                          <span className="text-muted">
                            {" "}
                            · {award.qualifyingSymbol}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-sm text-muted mt-0.5">
                        {award.noWinnerReason ?? "No winner this week"}
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-bold text-[var(--color-league-primary)] shrink-0">
                    {formatMoney(award.amountUsd)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
