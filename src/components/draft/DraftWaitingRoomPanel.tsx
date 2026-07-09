"use client";

import { useEffect, useState } from "react";
import {
  DRAFT_COUNTDOWN_TICK_MS,
  formatDraftBeginsIn,
  getMsUntilScheduledDraft,
} from "@/lib/league/scheduled-draft";

export type DraftWaitingRoomMember = {
  userId: string;
  teamName: string;
};

export function DraftWaitingRoomPanel({
  scheduledDraftAt,
  members,
  myUserId,
  rosterFill,
  identityFill,
  schedulerError,
}: {
  scheduledDraftAt: string | null | undefined;
  members: DraftWaitingRoomMember[];
  myUserId: string;
  rosterFill?: { current: number; target: number } | null;
  identityFill?: { complete: number; target: number } | null;
  schedulerError?: string | null;
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

  return (
    <section className="rounded-xl border border-gold/30 bg-gold/5 p-6 space-y-4">
      {schedulerError ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <p className="font-semibold text-red-100">Draft could not start yet</p>
          <p className="mt-1 text-red-200/90">{schedulerError}</p>
          <p className="mt-2 text-xs text-red-200/70">
            The scheduler will retry automatically every couple of minutes. Refresh
            this page to see updated roster progress.
          </p>
        </div>
      ) : null}

      {rosterFill && rosterFill.current < rosterFill.target ? (
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Filling roster: {rosterFill.current} of {rosterFill.target} teams (adding bot
          managers…)
        </div>
      ) : null}

      {identityFill && identityFill.complete < identityFill.target ? (
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Franchise identities: {identityFill.complete} of {identityFill.target} complete
        </div>
      ) : null}

      <div>
        <h2 className="text-lg font-semibold text-gold">Waiting for draft</h2>
        <p className="text-sm text-muted mt-1">
          {msRemaining !== null && msRemaining > 0
            ? `Draft begins in ${formatDraftBeginsIn(msRemaining)}. Chat with your league while you wait.`
            : scheduledDraftAt
              ? "The draft should begin shortly. Stay in the room — picks will open automatically."
              : "The commissioner scheduled a live draft. Chat with your league while you wait."}
        </p>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
          In the room ({members.length})
        </h3>
        <ul className="space-y-2">
          {members.map((member) => (
            <li
              key={member.userId}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                member.userId === myUserId
                  ? "border-gold/40 bg-gold/10"
                  : "border-dark-border bg-dark/30"
              }`}
            >
              <span className="font-medium truncate">{member.teamName}</span>
              {member.userId === myUserId && (
                <span className="text-[10px] uppercase tracking-wider text-gold shrink-0 ml-2">
                  You
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
