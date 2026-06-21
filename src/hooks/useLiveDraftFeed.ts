"use client";

import { useEffect, useRef } from "react";
import type { DraftFeedEvent } from "@/lib/draft/types";
import { createClient } from "@/lib/supabase/client";

export function useLiveDraftFeed(
  leagueId: string | null | undefined,
  initialFeed: DraftFeedEvent[],
  onEvent: (event: DraftFeedEvent) => void
) {
  const seenIds = useRef(new Set(initialFeed.map((e) => e.id)));

  useEffect(() => {
    seenIds.current = new Set(initialFeed.map((e) => e.id));
  }, [initialFeed]);

  useEffect(() => {
    if (!leagueId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`live-draft-feed:${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "league_draft_events",
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          const event = payload.new as DraftFeedEvent;
          if (seenIds.current.has(event.id)) return;
          seenIds.current.add(event.id);
          onEvent(event);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [leagueId, onEvent]);
}
