"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type LiveDraftClockConnection =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type LiveDraftStateRow = {
  status: "waiting" | "in_progress" | "complete";
  on_clock_user_id: string | null;
  pick_deadline_at: string | null;
  current_pick_index: number;
  total_pick_slots: number;
  global_pick_number: number;
};

type UseLiveDraftClockOptions = {
  onDisconnected?: () => void;
};

export function useLiveDraftClock(
  leagueId: string | null | undefined,
  onUpdate: (row: LiveDraftStateRow) => void,
  options?: UseLiveDraftClockOptions
): LiveDraftClockConnection {
  const [connection, setConnection] =
    useState<LiveDraftClockConnection>("connecting");
  const onUpdateRef = useRef(onUpdate);
  const onDisconnectedRef = useRef(options?.onDisconnected);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    onDisconnectedRef.current = options?.onDisconnected;
  }, [options?.onDisconnected]);

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
        .channel(`live-draft-clock:${leagueId}:${reconnectAttempt}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "league_draft_state",
            filter: `league_id=eq.${leagueId}`,
          },
          (payload) => {
            onUpdateRef.current(payload.new as LiveDraftStateRow);
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
