"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import {
  canEnterScheduledDraftRoom,
  DRAFT_COUNTDOWN_TICK_MS,
  draftRoomHref,
  formatDraftBeginsIn,
  getMsUntilScheduledDraft,
  isDraftCountdownVisible,
} from "@/lib/league/scheduled-draft";

export function ScheduledDraftCountdown({
  scheduledDraftAt,
  leagueId,
  compact = false,
  onEnterDraft,
}: {
  scheduledDraftAt: string | null | undefined;
  leagueId: string;
  compact?: boolean;
  onEnterDraft?: (leagueId: string, href: string) => void;
}) {
  const [msRemaining, setMsRemaining] = useState<number | null>(() =>
    getMsUntilScheduledDraft(scheduledDraftAt)
  );

  useEffect(() => {
    function tick() {
      setMsRemaining(getMsUntilScheduledDraft(scheduledDraftAt));
    }

    tick();
    const id = window.setInterval(tick, DRAFT_COUNTDOWN_TICK_MS);
    return () => window.clearInterval(id);
  }, [scheduledDraftAt]);

  if (
    msRemaining === null ||
    !isDraftCountdownVisible(scheduledDraftAt) ||
    msRemaining <= 0
  ) {
    return null;
  }

  const showEnterDraft = canEnterScheduledDraftRoom(scheduledDraftAt);
  const draftHref = draftRoomHref(leagueId);

  return (
    <div
      className={`rounded-xl border border-gold/30 bg-gold/5 ${
        compact ? "px-3 py-2 space-y-2" : "p-4 space-y-3"
      }`}
    >
      <p className={`${compact ? "text-xs" : "text-sm"} text-gold font-medium`}>
        Draft begins in {formatDraftBeginsIn(msRemaining)}
      </p>
      {showEnterDraft &&
        (onEnterDraft ? (
          <Button
            variant="primary"
            className={`w-full ${compact ? "text-xs py-2" : "text-sm"}`}
            onClick={() => onEnterDraft(leagueId, draftHref)}
          >
            Enter Draft
          </Button>
        ) : (
          <Button
            href={draftHref}
            variant="primary"
            className={`w-full ${compact ? "text-xs py-2" : "text-sm"}`}
          >
            Enter Draft
          </Button>
        ))}
    </div>
  );
}
