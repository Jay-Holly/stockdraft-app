"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DraftFeedEvent, LiveDraftView } from "@/lib/draft/types";
import { TOTAL_ROUNDS } from "@/lib/draft/types";
import { SPORTS_SIM_TOTAL_ROUNDS } from "@/lib/draft/draft-constants";
import {
  buildRoundRecap,
  getCurrentDraftRound,
  getMaxRoundWithEvents,
} from "@/lib/draft/round-recap";

export function DraftRoundSelector({
  feed,
  liveDraft,
  compact = false,
  sportsSimDraftRules = false,
}: {
  feed: DraftFeedEvent[];
  liveDraft: LiveDraftView | null;
  compact?: boolean;
  sportsSimDraftRules?: boolean;
}) {
  const totalRounds = sportsSimDraftRules ? SPORTS_SIM_TOTAL_ROUNDS : TOTAL_ROUNDS;
  const draftOrder = liveDraft?.draftOrder ?? [];
  const teamCount = draftOrder.length;
  const draftComplete = liveDraft?.status === "complete";
  const currentPickIndex = liveDraft?.currentPickIndex ?? 0;

  const currentRound = useMemo(
    () => getCurrentDraftRound(currentPickIndex, teamCount),
    [currentPickIndex, teamCount]
  );

  const maxRoundWithEvents = useMemo(
    () => getMaxRoundWithEvents(feed),
    [feed]
  );

  const followLiveRound = useRef(true);
  const [selectedRound, setSelectedRound] = useState(1);

  useEffect(() => {
    if (!followLiveRound.current) return;
    const target = draftComplete
      ? Math.max(maxRoundWithEvents, totalRounds)
      : currentRound;
    setSelectedRound(target);
  }, [currentRound, maxRoundWithEvents, draftComplete, totalRounds]);

  const recapLines = useMemo(
    () =>
      buildRoundRecap(feed, selectedRound, draftOrder, {
        currentPickIndex,
        draftComplete,
      }),
    [feed, selectedRound, draftOrder, currentPickIndex, draftComplete]
  );

  const rounds = useMemo(
    () => Array.from({ length: totalRounds }, (_, i) => i + 1),
    [totalRounds]
  );

  function handleSelectRound(round: number) {
    followLiveRound.current = round !== currentRound || draftComplete;
    if (round === currentRound && !draftComplete) {
      followLiveRound.current = true;
    }
    setSelectedRound(round);
  }

  const hasAnyPicks = recapLines.some((line) => line.status === "picked" || line.status === "skipped");

  return (
    <section
      className={`draft-round-selector ${compact ? "draft-round-selector--compact" : ""}`}
      aria-label="Draft round recap"
    >
      <div className="draft-round-selector__header">
        <h2 className="draft-round-selector__title">Round Recap</h2>
        {!followLiveRound.current && !draftComplete && (
          <button
            type="button"
            className="draft-round-selector__follow"
            onClick={() => {
              followLiveRound.current = true;
              setSelectedRound(currentRound);
            }}
          >
            Follow live
          </button>
        )}
      </div>

      <div
        className="draft-round-selector__pills"
        role="tablist"
        aria-label="Draft rounds"
      >
        {rounds.map((round) => {
          const isSelected = round === selectedRound;
          const isCurrent = round === currentRound && !draftComplete;
          const isFuture =
            !draftComplete && round > currentRound && round > maxRoundWithEvents;

          return (
            <button
              key={round}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls="draft-round-recap-panel"
              className={`draft-round-selector__pill ${
                isSelected ? "draft-round-selector__pill--active" : ""
              } ${isCurrent ? "draft-round-selector__pill--current" : ""} ${
                isFuture ? "draft-round-selector__pill--future" : ""
              }`}
              onClick={() => handleSelectRound(round)}
            >
              {round}
            </button>
          );
        })}
      </div>

      <div
        id="draft-round-recap-panel"
        className="draft-round-selector__panel"
        role="tabpanel"
      >
        <p className="draft-round-selector__round-label">Round {selectedRound}</p>

        {!hasAnyPicks && selectedRound > maxRoundWithEvents && !draftComplete ? (
          <p className="draft-round-selector__empty">
            This round hasn&apos;t started yet. Picks will appear here as each
            team goes on the clock.
          </p>
        ) : (
          <ul className="draft-round-selector__list">
            {recapLines.map((line) => (
              <li
                key={line.userId}
                className={`draft-round-selector__item draft-round-selector__item--${line.status}`}
              >
                <p className="draft-round-selector__summary">{line.summary}</p>
                {line.isAutoPick && line.status === "picked" && (
                  <span className="draft-round-selector__auto-tag">Auto</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
