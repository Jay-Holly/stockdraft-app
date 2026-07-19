"use client";

import Image from "next/image";
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

function gainToneClass(value: number): string {
  if (value > 0) return "matchup-stat-value--gain";
  if (value < 0) return "matchup-stat-value--loss";
  return "matchup-stat-value--flat";
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
          <p className={`matchup-team-stat__value ${gainToneClass(stat.value)}`}>
            {formatGainStat(stat)}
          </p>
        </div>
      ))}
    </div>
  );
}

function PickStatHeaders({ scoringMode }: { scoringMode: LeagueScoringMode }) {
  const headers = getOrderedGainStats(
    {
      weekDollarGain: 0,
      weekGainPercent: 0,
      seasonDollarGain: 0,
      seasonGainPercent: 0,
    },
    scoringMode
  );

  return (
    <div className="matchup-pick-table__row matchup-pick-table__row--head">
      <span className="matchup-pick-table__pick-head">Pick</span>
      {headers.map((stat) => (
        <span key={stat.key} className="matchup-pick-table__stat-head">
          {stat.label}
        </span>
      ))}
    </div>
  );
}

function PickGainCells({
  pick,
  scoringMode,
}: {
  pick: RosterPickView;
  scoringMode: LeagueScoringMode;
}) {
  const stats = getOrderedPickGainStats(pick, scoringMode);

  return (
    <>
      {stats.map((stat, index) => (
        <span
          key={stat.key}
          className={`matchup-pick-table__cell ${gainToneClass(stat.value)} ${
            index === 0 ? "matchup-pick-table__cell--primary" : ""
          }`}
        >
          {formatGainStat(stat)}
        </span>
      ))}
    </>
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
    <div className="matchup-pick-stats matchup-pick-stats--compact">
      {stats.map((stat, index) => (
        <div
          key={stat.key}
          className={`matchup-pick-stat ${index === 0 ? "matchup-pick-stat--primary" : ""}`}
        >
          <span className="matchup-pick-stat__label">{stat.label}</span>
          <span className={`matchup-pick-stat__value ${gainToneClass(stat.value)}`}>
            {formatGainStat(stat)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RosterPickSection({
  title,
  variant,
  picks,
  scoringMode,
  bench = false,
}: {
  title: string;
  variant: "starters" | "crypto" | "bench";
  picks: RosterPickView[];
  scoringMode: LeagueScoringMode;
  bench?: boolean;
}) {
  const visiblePicks = bench
    ? picks.filter((pick) => pick.symbol.toUpperCase() !== "__OPEN__")
    : picks;

  if (visiblePicks.length === 0) {
    return (
      <div className={`matchup-roster-section matchup-roster-section--${variant}`}>
        <p className="matchup-roster-section__title">{title}</p>
        <p className="text-xs text-muted">
          {bench ? "No bench" : variant === "crypto" ? "No crypto" : "No starters"}
        </p>
      </div>
    );
  }

  return (
    <div className={`matchup-roster-section matchup-roster-section--${variant}`}>
      <p className="matchup-roster-section__title">{title}</p>
      <div className="matchup-pick-table">
        <PickStatHeaders scoringMode={scoringMode} />
        {visiblePicks.map((pick) => (
          <div
            key={pick.id}
            className={`matchup-pick-table__row ${bench ? "matchup-pick-table__row--bench" : ""}`}
          >
            <div className="matchup-pick-table__pick">
              <p className="matchup-pick-symbol">{pick.symbol}</p>
              <p className="matchup-pick-table__pick-meta">
                {bench
                  ? "Does not score"
                  : `${formatMoney(pick.currentValue)} value`}
              </p>
            </div>
            <div className="matchup-pick-table__stats matchup-pick-table__stats--wide">
              <PickGainCells pick={pick} scoringMode={scoringMode} />
            </div>
            <div className="matchup-pick-table__stats matchup-pick-table__stats--compact">
              <PickGainLine pick={pick} scoringMode={scoringMode} />
            </div>
          </div>
        ))}
      </div>
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
        {side.logoUrl ? (
          <Image
            src={side.logoUrl}
            alt={`${side.teamName} logo`}
            width={40}
            height={40}
            unoptimized
            className="matchup-team-avatar matchup-team-avatar--logo"
          />
        ) : (
          <div
            className="matchup-team-avatar"
            style={{ backgroundColor: getAvatarHex(side.avatarColor) }}
          >
            {side.teamName.slice(0, 2).toUpperCase()}
          </div>
        )}
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

      <RosterPickSection
        title="Starters"
        variant="starters"
        picks={side.starters}
        scoringMode={scoringMode}
      />

      {side.crypto.length > 0 && (
        <RosterPickSection
          title="Crypto"
          variant="crypto"
          picks={side.crypto}
          scoringMode={scoringMode}
        />
      )}

      {side.bench.some((pick) => pick.symbol.toUpperCase() !== "__OPEN__") && (
        <RosterPickSection
          title="Bench"
          variant="bench"
          picks={side.bench}
          scoringMode={scoringMode}
          bench
        />
      )}
    </div>
  );
}

const PLAYOFF_BANNER_COPY: Record<
  string,
  { eyebrow: string; message: string; tone: "semifinal" | "championship" }
> = {
  semifinal: {
    eyebrow: "Semifinal",
    message: "Win to punch your ticket to the Championship.",
    tone: "semifinal",
  },
  final: {
    eyebrow: "Championship",
    message: "This is it — win it all.",
    tone: "championship",
  },
  third_place: {
    eyebrow: "3rd Place",
    message: "One last game to close out the season.",
    tone: "semifinal",
  },
  wild_card: {
    eyebrow: "Wild Card",
    message: "Win and advance.",
    tone: "semifinal",
  },
  divisional: {
    eyebrow: "Divisional Round",
    message: "Win and advance.",
    tone: "semifinal",
  },
  conference_championship: {
    eyebrow: "Conference Championship",
    message: "Winner goes to the title game.",
    tone: "championship",
  },
};

function PlayoffBanner({ matchup }: { matchup: MatchupDetail }) {
  if (!matchup.isPlayoff || !matchup.playoffRound) return null;
  const copy = PLAYOFF_BANNER_COPY[matchup.playoffRound];
  if (!copy) return null;

  return (
    <div className={`playoff-banner playoff-banner--${copy.tone}`}>
      <span className="playoff-banner__eyebrow">{copy.eyebrow}</span>
      <p className="playoff-banner__matchup">
        {matchup.homeTeamName} <span>vs</span> {matchup.awayTeamName}
      </p>
      <p className="playoff-banner__message">{copy.message}</p>
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
          <div className="matchup-detail-panel__title-row">
            <h2 className="season-card-title">
              Week {matchup.weekNumber}
              {matchup.isPlayoff && matchup.playoffRound
                ? ` · ${formatPlayoffRoundLabel(matchup.playoffRound)}`
                : ""}
            </h2>
            <span
              className={`matchup-detail-panel__status ${
                matchup.status === "complete"
                  ? "matchup-detail-panel__status--final"
                  : "matchup-detail-panel__status--live"
              }`}
            >
              {matchup.status === "complete" ? "Final" : "Live"}
            </span>
          </div>
          <p className="matchup-detail-panel__subtitle">
            {matchup.homeTeamName} vs {matchup.awayTeamName}
          </p>
        </div>
        {matchup.leader && (
          <p
            className={`matchup-detail-panel__leader ${
              matchup.leader === "tie" ? "matchup-detail-panel__leader--tie" : ""
            }`}
          >
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
      {matchup.isPlayoff && matchup.playoffRound && (
        <span className="matchup-preview-card__round">
          {formatPlayoffRoundLabel(matchup.playoffRound)}
        </span>
      )}
      <p className="matchup-preview-card__teams">
        {matchup.homeTeamName}
        <span className="text-muted"> vs </span>
        {matchup.awayTeamName}
      </p>
      <div className="matchup-preview-card__scores">
        <span
          className={
            matchup.leader === "home"
              ? "matchup-preview-card__score matchup-preview-card__score--leading"
              : "matchup-preview-card__score"
          }
        >
          {scoringMode === "dollar_gain"
            ? formatSignedMoney(matchup.homePrimaryScore)
            : formatPct(matchup.homePrimaryScore)}
        </span>
        <span className="matchup-preview-card__dash">–</span>
        <span
          className={
            matchup.leader === "away"
              ? "matchup-preview-card__score matchup-preview-card__score--leading"
              : "matchup-preview-card__score"
          }
        >
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
  const [showAllMatchups, setShowAllMatchups] = useState(false);

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
    <div className="matchups-page space-y-6">
      <section className="season-card matchup-page-header">
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
              setShowAllMatchups(false);
            }}
          />
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      )}

      {otherMatchups.length > 0 && (
        <section className="matchup-other-section space-y-4">
          <h2 className="matchup-other-section__title">
            {data.viewWeek === data.currentWeek
              ? "Other matchups this week"
              : `Other week ${data.viewWeek} matchups`}
          </h2>
          <div className="matchup-preview-grid">
            {(showAllMatchups ? otherMatchups : otherMatchups.slice(0, 4)).map(
              (matchup) => (
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
              )
            )}
          </div>
          {otherMatchups.length > 4 && (
            <button
              type="button"
              className="matchup-other-section__toggle"
              onClick={() => setShowAllMatchups((current) => !current)}
            >
              {showAllMatchups
                ? "Show fewer matchups"
                : `Show all ${otherMatchups.length} matchups`}
            </button>
          )}
        </section>
      )}

      <div className="matchup-focus-block">
        <PlayoffBanner matchup={focusedMatchup} />
        <p className="matchup-focus-block__label">
          {focusedMatchup.includesViewer ? "Your matchup" : "Matchup detail"}
        </p>
        <MatchupDetailPanel
          matchup={focusedMatchup}
          scoringMode={data.scoringMode}
        />
      </div>
    </div>
  );
}
