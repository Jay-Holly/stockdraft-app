"use client";

import type { LiveDraftView } from "@/lib/draft/types";
import { PickTimer } from "./PickTimer";

export function OnClockBanner({
  liveDraft,
  myTeamName,
  onTimerExpired,
}: {
  liveDraft: LiveDraftView;
  myTeamName: string;
  onTimerExpired?: () => void;
}) {
  if (liveDraft.status === "complete") {
    return (
      <div className="on-clock-banner on-clock-banner--complete">
        Live draft complete — all teams have finished their boards.
      </div>
    );
  }

  const pickNum = liveDraft.globalPickNumber + 1;
  const total = liveDraft.totalPickSlots;

  if (liveDraft.isMyTurn) {
    return (
      <div className="on-clock-banner on-clock-banner--mine">
        <div className="on-clock-banner__main">
          <p className="on-clock-banner__title">You&apos;re on the clock!</p>
          <p className="on-clock-banner__detail">
            Pick {pickNum} of {total} · {myTeamName}
          </p>
        </div>
        <PickTimer
          deadlineAt={liveDraft.pickDeadlineAt}
          active
          onExpired={onTimerExpired}
        />
      </div>
    );
  }

  return (
    <div className="on-clock-banner on-clock-banner--watching">
      <p className="on-clock-banner__title">
        On the clock:{" "}
        <strong>{liveDraft.onClockTeamName ?? "Another team"}</strong>
      </p>
      <p className="on-clock-banner__detail">
        Pick {pickNum} of {total} · Watching — draft pool is read-only
      </p>
      {liveDraft.pickDeadlineAt && (
        <PickTimer deadlineAt={liveDraft.pickDeadlineAt} active={false} />
      )}
    </div>
  );
}
