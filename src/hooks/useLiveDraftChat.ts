"use client";

import { useEffect, useRef, useState } from "react";
import type { DraftChatMessage } from "@/lib/draft/chat-types";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type LiveDraftChatConnection =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export function useLiveDraftChat(
  leagueId: string | null | undefined,
  initialMessages: DraftChatMessage[],
  onMessage: (message: DraftChatMessage) => void
): LiveDraftChatConnection {
  const [connection, setConnection] =
    useState<LiveDraftChatConnection>("connecting");
  const seenIds = useRef(new Set(initialMessages.map((m) => m.id)));
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    seenIds.current = new Set(initialMessages.map((m) => m.id));
  }, [initialMessages]);

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
        .channel(`live-draft-chat:${leagueId}:${reconnectAttempt}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "league_draft_chat_messages",
            filter: `league_id=eq.${leagueId}`,
          },
          (payload) => {
            const message = payload.new as DraftChatMessage;
            if (seenIds.current.has(message.id)) return;
            seenIds.current.add(message.id);
            onMessageRef.current(message);
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
            if (status === "CHANNEL_ERROR") setConnection("error");
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
