"use client";

import { useMemo } from "react";
import type { DraftFeedEvent } from "@/lib/draft/types";
import type { LiveDraftFeedConnection } from "@/hooks/useLiveDraftFeed";

export type LiveDraftFeedSyncStatus =
  | "live"
  | "reconnecting"
  | "polling"
  | "offline";

export function LiveDraftTicker({
  feed,
  status,
  syncStatus = "live",
  syncDetail,
}: {
  feed: DraftFeedEvent[];
  status?: "waiting" | "in_progress" | "complete";
  syncStatus?: LiveDraftFeedSyncStatus;
  syncDetail?: string | null;
}) {
  const latestPick = useMemo(() => {
    if (feed.length === 0) return null;
    return [...feed].sort(
      (a, b) => a.global_pick_number - b.global_pick_number
    )[feed.length - 1];
  }, [feed]);

  const statusLabel =
    status === "complete"
      ? "Draft complete"
      : status === "waiting"
        ? "Waiting"
        : syncStatus === "live"
          ? "Live"
          : syncStatus === "reconnecting"
            ? "Reconnecting"
            : syncStatus === "polling"
              ? "Polling"
              : "Offline";

  const statusClass =
    status === "complete"
      ? "complete"
      : syncStatus === "live"
        ? "in_progress"
        : syncStatus === "offline"
          ? "offline"
          : "reconnecting";

  return (
    <section
      className={`live-draft-ticker ${syncStatus !== "live" && status !== "complete" ? "live-draft-ticker--degraded" : ""}`}
      aria-live="polite"
    >
      <div className="live-draft-ticker__header">
        <h2 className="live-draft-ticker__title">Live Draft Feed</h2>
        <span
          className={`live-draft-ticker__status live-draft-ticker__status--${statusClass}`}
          title={syncDetail ?? undefined}
        >
          {statusLabel}
        </span>
      </div>
      {syncDetail && status !== "complete" && syncStatus !== "live" && (
        <p className="live-draft-ticker__sync-warning" role="status">
          {syncDetail}
        </p>
      )}
      <div className="live-draft-ticker__current">
        {!latestPick ? (
          <p className="live-draft-ticker__empty">
            The most recent pick will appear here as the draft unfolds…
          </p>
        ) : (
          <div
            className={`live-draft-ticker__item live-draft-ticker__item--featured ${latestPick.is_auto_pick ? "live-draft-ticker__item--auto" : ""}`}
          >
            <span className="live-draft-ticker__pick-num">
              #{latestPick.global_pick_number}
            </span>
            <div className="live-draft-ticker__featured-copy">
              <p className="live-draft-ticker__featured-label">Latest pick</p>
              <p className="live-draft-ticker__message">{latestPick.message}</p>
            </div>
            {latestPick.is_auto_pick && (
              <span className="live-draft-ticker__auto-tag">Auto</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
