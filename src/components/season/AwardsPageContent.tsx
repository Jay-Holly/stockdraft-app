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

      {data.pending.length > 0 && (
        <section className="season-card border-gold/30 bg-gold/5 space-y-4">
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
                className="rounded-xl border border-gold/25 bg-dark/40 p-4 space-y-3"
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

      <section className="season-card space-y-3">
        <h2 className="season-card-title">Bonus pool</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-dark-border bg-dark/40 px-3 py-2">
            <p className="text-xs text-muted">Weekly pool</p>
            <p className="text-lg font-bold text-gold">
              {formatMoney(data.pool.weeklyPoolAmount)}
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              Base {formatMoney(data.pool.weeklyBaseAmount)}
              {data.pool.draftSurchargeTotal > 0
                ? ` + surcharge share`
                : ""}
            </p>
          </div>
          <div className="rounded-lg border border-dark-border bg-dark/40 px-3 py-2">
            <p className="text-xs text-muted">Rollover balance</p>
            <p className="text-lg font-bold">
              {formatMoney(data.pool.rolloverBalance)}
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              Playoff pool {formatMoney(data.pool.playoffPoolBalance)}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted">
          Season base pool {formatMoney(data.pool.seasonBaseTotal)} across{" "}
          {data.awardsEnabled ? "11 regular-season weeks" : "the season"}.
          Unclaimed weekly amounts roll forward to the playoff bonus pool.
        </p>
      </section>

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
                      ? "border-gold/40 bg-gold/5"
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
                          <span className="text-gold font-semibold"> · You</span>
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
                  <p className="text-sm font-bold text-gold shrink-0">
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
