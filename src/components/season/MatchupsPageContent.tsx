"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney, formatPct, formatSignedMoney } from "@/lib/format";
import { getAvatarHex } from "@/lib/types";
import type { LeagueScoringMode } from "@/lib/league/scoring-mode";
import type { MatchupDetail, MatchupsPageData } from "@/lib/matchup/page-data";
import { formatPlayoffRoundLabel } from "@/lib/matchup/schedule";
import {
  getOrderedGainStats,
  getOrderedPickGainStats,
  type OrderedGainStat,
} from "@/lib/roster/team-stats";
import type { RosterPickView } from "@/lib/roster/types";
import {
  fetchJsonWithTimeout,
  formatFetchError,
} from "@/lib/fetch-client";
import { SeasonWeekNavigator } from "@/components/season/SeasonWeekNavigator";

function formatGainStat(stat: OrderedGainStat): string {
  return stat.format === "money"
    ? formatSignedMoney(stat.value)
    : formatPct(stat.value);
}

function TeamGainStatsBlock({
  stats,
  scoringMode,
  isLeading,
}: {
  stats: MatchupDetail["home"]["stats"];
  scoringMode: LeagueScoringMode;
  isLeading: boolean;
}) {
  const ordered = getOrderedGainStats(stats, scoringMode);

  return (
    <div className="matchup-team-stats">
      {ordered.map((stat, index) => (
        <div
          key={stat.key}
          className={`matchup-team-stat ${index === 0 ? "matchup-team-stat--primary" : ""} ${
            isLeading && index === 0 ? "matchup-team-stat--leading" : ""
          }`}
        >
          <p className="matchup-team-stat__label">{stat.label}</p>
          <p
            className={`matchup-team-stat__value ${
              stat.value >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {formatGainStat(stat)}
          </p>
        </div>
      ))}
    </div>
  );
}

function PickGainLine({
  pick,
  scoringMode,
}: {
  pick: RosterPickView;
  scoringMode: LeagueScoringMode;
}) {
  const stats = getOrderedPickGainStats(pick, scoringMode);

  return (
    <div className="matchup-pick-stats">
      {stats.map((stat, index) => (
        <span
          key={stat.key}
          className={index === 0 ? "matchup-pick-stat--primary" : ""}
        >
          {formatGainStat(stat)}
        </span>
      ))}
    </div>
  );
}

function RosterColumn({
  side,
  scoringMode,
  isLeading,
}: {
  side: MatchupDetail["home"];
  scoringMode: LeagueScoringMode;
  isLeading: boolean;
}) {
  return (
    <div className={`matchup-team-column ${isLeading ? "matchup-team-column--leading" : ""}`}>
      <div className="matchup-team-header">
        <div
          className="matchup-team-avatar"
          style={{ backgroundColor: getAvatarHex(side.avatarColor) }}
        >
          {side.teamName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="matchup-team-name">
            {side.teamName}
            {side.isViewer && (
              <span className="matchup-team-you"> · You</span>
            )}
          </p>
          <p className="text-[11px] text-muted">Manager</p>
        </div>
      </div>

      <TeamGainStatsBlock
        stats={side.stats}
        scoringMode={scoringMode}
        isLeading={isLeading}
      />

      <div className="matchup-roster-section">
        <p className="matchup-roster-section__title">Starters</p>
        {side.starters.length === 0 ? (
          <p className="text-xs text-muted">No starters</p>
        ) : (
          side.starters.map((pick) => (
            <div key={pick.id} className="matchup-pick-row">
              <div className="min-w-0">
                <p className="matchup-pick-symbol">{pick.symbol}</p>
                <p className="text-[11px] text-muted">
                  {formatMoney(pick.currentValue)} value
                </p>
              </div>
              <PickGainLine pick={pick} scoringMode={scoringMode} />
            </div>
          ))
        )}
      </div>

      <div className="matchup-roster-section">
        <p className="matchup-roster-section__title">Crypto</p>
        {side.crypto.length === 0 ? (
          <p className="text-xs text-muted">No crypto</p>
        ) : (
          side.crypto.map((pick) => (
            <div key={pick.id} className="matchup-pick-row">
              <div className="min-w-0">
                <p className="matchup-pick-symbol">{pick.symbol}</p>
                <p className="text-[11px] text-muted">
                  {formatMoney(pick.currentValue)} value
                </p>
              </div>
              <PickGainLine pick={pick} scoringMode={scoringMode} />
            </div>
          ))
        )}
      </div>

      {side.bench.some((pick) => pick.symbol.toUpperCase() !== "__OPEN__") && (
        <div className="matchup-roster-section">
          <p className="matchup-roster-section__title">Bench</p>
          {side.bench
            .filter((pick) => pick.symbol.toUpperCase() !== "__OPEN__")
            .map((pick) => (
              <div key={pick.id} className="matchup-pick-row matchup-pick-row--bench">
                <div className="min-w-0">
                  <p className="matchup-pick-symbol">{pick.symbol}</p>
                  <p className="text-[11px] text-muted">Does not score</p>
                </div>
                <PickGainLine pick={pick} scoringMode={scoringMode} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function MatchupDetailPanel({
  matchup,
  scoringMode,
}: {
  matchup: MatchupDetail;
  scoringMode: LeagueScoringMode;
}) {
  const homeLeading = matchup.leader === "home";
  const awayLeading = matchup.leader === "away";

  return (
    <section className="season-card matchup-detail-panel">
      <div className="matchup-detail-panel__header">
        <div>
          <h2 className="season-card-title">
            Week {matchup.weekNumber}
            {matchup.isPlayoff && matchup.playoffRound
              ? ` · ${formatPlayoffRoundLabel(matchup.playoffRound)}`
              : ""}
          </h2>
          <p className="text-sm text-muted">
            {matchup.homeTeamName} vs {matchup.awayTeamName}
            {matchup.status === "complete" ? " · Final" : " · Live"}
          </p>
        </div>
        {matchup.leader && (
          <p className="matchup-detail-panel__leader">
            {matchup.leader === "tie"
              ? "Tied"
              : matchup.leader === "home"
                ? `${matchup.homeTeamName} leading`
                : `${matchup.awayTeamName} leading`}
          </p>
        )}
      </div>

      <div className="matchup-detail-grid">
        <RosterColumn
          side={matchup.home}
          scoringMode={scoringMode}
          isLeading={homeLeading}
        />
        <div className="matchup-detail-vs">VS</div>
        <RosterColumn
          side={matchup.away}
          scoringMode={scoringMode}
          isLeading={awayLeading}
        />
      </div>
    </section>
  );
}

function MatchupPreviewCard({
  matchup,
  scoringMode,
  selected,
  onSelect,
}: {
  matchup: MatchupDetail;
  scoringMode: LeagueScoringMode;
  selected: boolean;
  onSelect: () => void;
}) {
  const primaryLabel =
    scoringMode === "dollar_gain" ? "Weekly $" : "Weekly %";

  return (
    <button
      type="button"
      className={`matchup-preview-card ${selected ? "matchup-preview-card--selected" : ""}`}
      onClick={onSelect}
    >
      <p className="matchup-preview-card__teams">
        {matchup.homeTeamName}
        <span className="text-muted"> vs </span>
        {matchup.awayTeamName}
      </p>
      <div className="matchup-preview-card__scores">
        <span className={matchup.leader === "home" ? "text-green-400 font-semibold" : ""}>
          {scoringMode === "dollar_gain"
            ? formatSignedMoney(matchup.homePrimaryScore)
            : formatPct(matchup.homePrimaryScore)}
        </span>
        <span className="text-muted">–</span>
        <span className={matchup.leader === "away" ? "text-green-400 font-semibold" : ""}>
          {scoringMode === "dollar_gain"
            ? formatSignedMoney(matchup.awayPrimaryScore)
            : formatPct(matchup.awayPrimaryScore)}
        </span>
      </div>
      <p className="matchup-preview-card__meta">
        {primaryLabel}
        {matchup.includesViewer ? " · Your game" : ""}
        {matchup.leader === "tie"
          ? " · Tied"
          : matchup.leader === "home"
            ? ` · ${matchup.homeTeamName} up`
            : matchup.leader === "away"
              ? ` · ${matchup.awayTeamName} up`
              : ""}
      </p>
    </button>
  );
}

export function MatchupsPageContent() {
  const [data, setData] = useState<MatchupsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusedMatchupId, setFocusedMatchupId] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  const load = useCallback(async (weekNumber?: number) => {
    try {
      const weekQuery =
        weekNumber != null ? `?week=${encodeURIComponent(String(weekNumber))}` : "";
      const { res, data: json } = await fetchJsonWithTimeout<
        MatchupsPageData & { error?: string }
      >(`/api/matchups${weekQuery}`, {
        cache: "no-store",
        timeoutMs: 45_000,
        label: "Matchups load",
      });

      if (!res.ok) {
        setError(json.error ?? `Could not load matchups (HTTP ${res.status})`);
        setLoading(false);
        return;
      }

      setData(json as MatchupsPageData);
      setSelectedWeek((current) => current ?? json.viewWeek);
      setFocusedMatchupId((current) => {
        if (current && json.matchups.some((matchup) => matchup.id === current)) {
          return current;
        }
        return json.myMatchupId ?? json.matchups[0]?.id ?? null;
      });
      setError(null);
      setLoading(false);
    } catch (err) {
      setError(formatFetchError(err, "Matchups load"));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(selectedWeek ?? undefined);
  }, [load, selectedWeek]);

  useEffect(() => {
    if (!data || data.isHistorical) return;
    const id = window.setInterval(
      () => void load(data.viewWeek),
      30_000
    );
    return () => window.clearInterval(id);
  }, [load, data?.isHistorical, data?.viewWeek]);

  const focusedMatchup = useMemo(
    () => data?.matchups.find((matchup) => matchup.id === focusedMatchupId) ?? null,
    [data, focusedMatchupId]
  );

  const otherMatchups = useMemo(
    () =>
      data?.matchups.filter((matchup) => matchup.id !== focusedMatchupId) ?? [],
    [data, focusedMatchupId]
  );

  if (loading && !data) {
    return (
      <p className="text-muted text-sm py-12 text-center">Loading matchups…</p>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!data || !focusedMatchup) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
        {error ?? "No matchups available this week."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="season-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Matchups</h1>
            <p className="text-muted text-sm mt-1">
              {data.leagueName}
              {data.isHistorical
                ? ` · Week ${data.viewWeek} archive`
                : ` · Week ${data.viewWeek} live`}
            </p>
          </div>
          <SeasonWeekNavigator
            selectedWeek={data.viewWeek}
            currentWeek={data.currentWeek}
            availableWeeks={data.availableWeeks}
            onWeekChange={(week) => {
              setLoading(true);
              setSelectedWeek(week);
            }}
          />
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      )}

      <div>
        <p className="text-xs uppercase tracking-wider text-muted mb-2">
          {focusedMatchup.includesViewer ? "Your matchup" : "Matchup detail"}
        </p>
        <MatchupDetailPanel
          matchup={focusedMatchup}
          scoringMode={data.scoringMode}
        />
      </div>

      {otherMatchups.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">
            {data.viewWeek === data.currentWeek
              ? "Other matchups this week"
              : `Other week ${data.viewWeek} matchups`}
          </h2>
          <div className="matchup-preview-grid">
            {otherMatchups.map((matchup) => (
              <MatchupPreviewCard
                key={matchup.id}
                matchup={matchup}
                scoringMode={data.scoringMode}
                selected={false}
                onSelect={() => {
                  setFocusedMatchupId(matchup.id);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
