"use client";

import { useEffect, useRef } from "react";
import type { DraftFeedEvent } from "@/lib/draft/types";

export function LiveDraftTicker({
  feed,
  status,
}: {
  feed: DraftFeedEvent[];
  status?: "waiting" | "in_progress" | "complete";
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  return (
    <section className="live-draft-ticker" aria-live="polite">
      <div className="live-draft-ticker__header">
        <h2 className="live-draft-ticker__title">Live Draft Feed</h2>
        <span
          className={`live-draft-ticker__status live-draft-ticker__status--${status ?? "in_progress"}`}
        >
          {status === "complete"
            ? "Draft complete"
            : status === "waiting"
              ? "Waiting"
              : "Live"}
        </span>
      </div>
      <div className="live-draft-ticker__list" ref={listRef}>
        {feed.length === 0 ? (
          <p className="live-draft-ticker__empty">
            Picks will appear here as the draft unfolds…
          </p>
        ) : (
          feed.map((event) => (
            <div
              key={event.id}
              className={`live-draft-ticker__item ${event.is_auto_pick ? "live-draft-ticker__item--auto" : ""}`}
            >
              <span className="live-draft-ticker__pick-num">
                #{event.global_pick_number}
              </span>
              <p className="live-draft-ticker__message">{event.message}</p>
              {event.is_auto_pick && (
                <span className="live-draft-ticker__auto-tag">Auto</span>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
