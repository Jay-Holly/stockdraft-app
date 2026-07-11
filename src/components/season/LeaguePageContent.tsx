"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatMoney, formatPct } from "@/lib/format";
import {
  formatMatchupScore,
  scoringModeShortLabel,
} from "@/lib/league/scoring-mode";
import type { LeaguePageData } from "@/lib/roster/types";
import { LeagueSupportId } from "@/components/league/LeagueSupportId";
import { DeleteLeagueModal } from "@/components/league/DeleteLeagueModal";
import { Button } from "@/components/Button";
import { SPORTS_LEAGUE_FORMATS } from "@/lib/league/league-config";

export function LeaguePageContent() {
  const [data, setData] = useState<LeaguePageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/league", { cache: "no-store" });

      let json: { error?: string } & Partial<LeaguePageData> = {};
      try {
        const text = await res.text();
        if (text.trim()) {
          json = JSON.parse(text) as typeof json;
        }
      } catch {
        setError(
          res.ok
            ? "League API returned an invalid JSON response."
            : `League API HTTP ${res.status}: empty or invalid JSON body.`
        );
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(json.error ?? `Could not load league (HTTP ${res.status})`);
        setLoading(false);
        return;
      }

      if (!json.leagueId) {
        setError("League API returned unexpected data.");
        setLoading(false);
        return;
      }

      setData(json as LeaguePageData);
      setLoading(false);
    } catch (err) {
      setError(
        err instanceof TypeError && err.message === "Failed to fetch"
          ? "Network error: could not reach /api/league. Check that the dev server is running."
          : err instanceof Error
            ? err.message
            : "Could not load league data."
      );
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading) {
    return <p className="text-muted text-sm py-12 text-center">Loading league…</p>;
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        {error ?? "Could not load league data."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DeleteLeagueModal
        open={deleteOpen}
        leagueId={data.leagueId}
        leagueName={data.leagueName}
        supportCode={data.leagueSupportCode}
        onClose={() => setDeleteOpen(false)}
      />

      <section className="season-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-2">
              <LeagueSupportId code={data.leagueSupportCode} size="md" />
            </div>
            <h1 className="text-xl font-bold">{data.leagueName}</h1>
            <p className="text-muted text-sm mt-1 capitalize">
              Week {data.currentWeek} · {data.leagueStatus} ·{" "}
              {scoringModeShortLabel(data.scoringMode)} matchups
            </p>
          </div>
          {data.isSportsSim ? (
            (() => {
              const logoSrc = SPORTS_LEAGUE_FORMATS.find(
                (f) => f.id === data.sportsLeagueId
              )?.logoSrc;
              return logoSrc ? (
                <Image
                  src={logoSrc}
                  alt=""
                  width={96}
                  height={120}
                  className="shrink-0 rounded-lg"
                />
              ) : null;
            })()
          ) : data.isLeagueOwner ? (
            <Button
              variant="ghost"
              className="text-xs px-3 text-red-400 border-red-500/30 hover:border-red-400/50 shrink-0"
              onClick={() => setDeleteOpen(true)}
            >
              Delete League
            </Button>
          ) : null}
        </div>
        <p className="text-2xl font-black text-[var(--color-league-primary)] mt-3">
          {data.humanRecord.wins}-{data.humanRecord.losses}
          <span className="text-sm font-semibold text-muted ml-2">Your record</span>
        </p>
      </section>

      {data.bonusPool.awardsEnabled && (
        <section className="season-card border-[var(--color-league-primary)]/30 bg-[var(--color-league-primary)]/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="season-card-title">Bonus pool</h2>
              <p className="text-2xl font-black text-[var(--color-league-primary)]">
                {formatMoney(data.bonusPool.totalBonusPool)}
              </p>
              <p className="text-xs text-muted">
                Playoff pool · {formatMoney(data.bonusPool.playoffPoolBalance)}
                {data.bonusPool.rolloverBalance > 0 && (
                  <>
                    {" "}
                    · {formatMoney(data.bonusPool.rolloverBalance)} unclaimed
                    rollover
                  </>
                )}
              </p>
              <p className="text-xs text-muted">
                This week&apos;s award pool:{" "}
                {formatMoney(data.bonusPool.weeklyPoolAmount)}
              </p>
            </div>
            <Link
              href="/awards"
              className="landing-btn landing-btn--primary !w-auto !px-4 !py-2 text-sm shrink-0"
            >
              {data.bonusPool.pendingClaimCount > 0
                ? `Claim ${formatMoney(data.bonusPool.pendingClaimTotalUsd)}`
                : "View awards"}
            </Link>
          </div>
          {data.bonusPool.pendingClaimCount > 0 && (
            <p className="text-sm mt-3 text-[var(--color-league-primary)] font-semibold">
              You won {formatMoney(data.bonusPool.pendingClaimTotalUsd)} — claim
              it on the Awards page.
            </p>
          )}
        </section>
      )}

      {data.currentMatchup && (
        <section className="season-card">
          <h2 className="season-card-title">
            Week {data.currentMatchup.weekNumber} matchup
          </h2>
          <p className="text-sm text-muted mb-4">
            vs <strong className="text-white">{data.currentMatchup.opponentName}</strong>
            {data.currentMatchup.status === "complete" ? " · Final" : " · Live scoring"}
          </p>
          <div className="season-matchup-grid">
            <div className="season-matchup-team">
              <p className="season-matchup-label">You</p>
              <p
                className={`season-matchup-score ${
                  data.currentMatchup.winner === "human"
                    ? "text-green-400"
                    : ""
                }`}
              >
                {formatMatchupScore(
                  data.currentMatchup.status === "complete" &&
                    data.currentMatchup.humanScored != null
                    ? data.currentMatchup.humanScored
                    : data.currentMatchup.humanWeeklyScore,
                  data.scoringMode
                )}
              </p>
              <p className="text-xs text-muted">
                {data.scoringMode === "dollar_gain"
                  ? "Weekly $ gain · starters + crypto"
                  : "Weekly % gain · starters + crypto"}
              </p>
            </div>
            <div className="season-matchup-vs">vs</div>
            <div className="season-matchup-team">
              <p className="season-matchup-label">{data.currentMatchup.opponentName}</p>
              <p
                className={`season-matchup-score ${
                  data.currentMatchup.winner === "opponent"
                    ? "text-green-400"
                    : ""
                }`}
              >
                {formatMatchupScore(
                  data.currentMatchup.status === "complete" &&
                    data.currentMatchup.opponentScored != null
                    ? data.currentMatchup.opponentScored
                    : data.currentMatchup.opponentWeeklyScore,
                  data.scoringMode
                )}
              </p>
              <p className="text-xs text-muted">
                {data.scoringMode === "dollar_gain"
                  ? "Weekly $ gain · starters + crypto"
                  : "Weekly % gain · starters + crypto"}
              </p>
            </div>
          </div>
          {data.currentMatchup.status === "complete" &&
            data.currentMatchup.winner && (
              <p className="text-sm mt-4 font-medium">
                {data.currentMatchup.winner === "human"
                  ? "You won this week!"
                  : data.currentMatchup.winner === "opponent"
                    ? `${data.currentMatchup.opponentName} won this week.`
                    : "This week was a tie."}
              </p>
            )}
        </section>
      )}

      <section className="season-card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-dark-border">
          <h2 className="season-card-title">Standings</h2>
          <p className="text-xs text-muted mt-1">
            Sorted by record, then season % gain
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="season-standings-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>W-L</th>
                <th>Season %</th>
              </tr>
            </thead>
            <tbody>
              {data.standings.map((team, index) => (
                <tr
                  key={team.userId}
                  className={team.isViewer ? "season-standings-row--mine" : ""}
                >
                  <td>{index + 1}</td>
                  <td>
                    <span className="font-semibold">{team.teamName}</span>
                    {team.isViewer && (
                      <span className="text-xs text-[var(--color-league-primary)] ml-1">(you)</span>
                    )}
                  </td>
                  <td>
                    {team.wins}-{team.losses}
                  </td>
                  <td
                    className={
                      team.seasonGainPercent >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }
                  >
                    {formatPct(team.seasonGainPercent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
