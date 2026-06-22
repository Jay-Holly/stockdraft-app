"use client";

import { useEffect, useRef, useState } from "react";
import type { DraftFeedEvent } from "@/lib/draft/types";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type LiveDraftFeedConnection =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type UseLiveDraftFeedOptions = {
  onDisconnected?: () => void;
};

export function useLiveDraftFeed(
  leagueId: string | null | undefined,
  initialFeed: DraftFeedEvent[],
  onEvent: (event: DraftFeedEvent) => void,
  options?: UseLiveDraftFeedOptions
): LiveDraftFeedConnection {
  const [connection, setConnection] =
    useState<LiveDraftFeedConnection>("connecting");
  const seenIds = useRef(new Set(initialFeed.map((e) => e.id)));
  const onEventRef = useRef(onEvent);
  const onDisconnectedRef = useRef(options?.onDisconnected);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onDisconnectedRef.current = options?.onDisconnected;
  }, [options?.onDisconnected]);

  useEffect(() => {
    seenIds.current = new Set(initialFeed.map((e) => e.id));
  }, [initialFeed]);

  useEffect(() => {
    if (!leagueId) {
      setConnection("disconnected");
      return;
    }

    const supabase = createClient();
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let channel: RealtimeChannel | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const removeChannel = () => {
      if (!channel) return;
      void supabase.removeChannel(channel);
      channel = null;
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;

      const delayMs = Math.min(1000 * 2 ** reconnectAttempt, 15000);
      reconnectAttempt += 1;
      setConnection("disconnected");
      onDisconnectedRef.current?.();

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (cancelled) return;
        removeChannel();
        connect();
      }, delayMs);
    };

    const connect = () => {
      if (cancelled) return;

      setConnection(reconnectAttempt === 0 ? "connecting" : "disconnected");
      removeChannel();

      channel = supabase
        .channel(`live-draft-feed:${leagueId}:${reconnectAttempt}`)
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
            onEventRef.current(event);
          }
        )
        .subscribe((status) => {
          if (cancelled) return;

          if (status === "SUBSCRIBED") {
            reconnectAttempt = 0;
            setConnection("connected");
            return;
          }

          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            if (status === "CHANNEL_ERROR") {
              setConnection("error");
            }
            scheduleReconnect();
          }
        });
    };

    connect();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      removeChannel();
      setConnection("disconnected");
    };
  }, [leagueId]);

  return connection;
}
