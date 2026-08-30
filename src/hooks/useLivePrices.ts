"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { PRICE_CHANNEL, type PriceTick } from "@/lib/pricing/price-channel";

export type LivePriceConnection = "connecting" | "connected" | "disconnected" | "error";

/**
 * Tells a page when something it holds has actually moved.
 *
 * The logger pushes only the symbols that changed — under write-on-change,
 * nothing else was even written. This listens for that push and, when a symbol
 * the page cares about is in it, calls `onChange` so the page can refresh
 * itself immediately instead of waiting out its polling timer.
 *
 * IT DELIBERATELY DOES NOT HAND THE PRICE TO THE PAGE TO DISPLAY.
 *
 * That is the important design decision here. A roster's displayed numbers are
 * not prices — they are values, gains and percentages computed from prices,
 * cost bases and baselines. If the browser started patching prices into those
 * numbers itself, it would be a second implementation of the scoring math,
 * running on partial data, drifting from the server's version. This system has
 * already been burned by the same number being computed in more than one
 * place. So the push is a signal — "ask again now" — and the server stays the
 * single thing that decides what a roster is worth.
 *
 * Polling remains as a fallback, exactly as DraftRoom treats its channels: if
 * the socket never connects, the page keeps its own timer and nothing breaks.
 */
export function useLivePrices(
  symbols: readonly string[],
  onChange: (changed: string[]) => void
): LivePriceConnection {
  const [connection, setConnection] = useState<LivePriceConnection>("connecting");
  const onChangeRef = useRef(onChange);
  const watchedRef = useRef<Set<string>>(new Set());
  const lastFiredRef = useRef(0);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    watchedRef.current = new Set(symbols.map((s) => String(s).toUpperCase()));
  }, [symbols]);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const removeChannel = () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      reconnectAttempt += 1;
      const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt, 5));
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    };

    const connect = () => {
      if (cancelled) return;
      setConnection(reconnectAttempt === 0 ? "connecting" : "disconnected");
      removeChannel();

      channel = supabase
        .channel(`${PRICE_CHANNEL}:${reconnectAttempt}`)
        .on("broadcast", { event: "prices" }, (message) => {
          const payload = message.payload as { ticks?: PriceTick[] } | undefined;
          const ticks = payload?.ticks ?? [];
          if (ticks.length === 0) return;

          const watched = watchedRef.current;
          const changed = ticks
            .map((t) => String(t.symbol).toUpperCase())
            .filter((s) => watched.has(s));
          if (changed.length === 0) return;

          // A sweep can move many held symbols at once. One refresh covers
          // all of them, so collapse a burst instead of firing per symbol.
          const now = Date.now();
          if (now - lastFiredRef.current < 2_000) return;
          lastFiredRef.current = now;

          onChangeRef.current(changed);
        })
        .subscribe((status) => {
          if (cancelled) return;

          if (status === "SUBSCRIBED") {
            reconnectAttempt = 0;
            setConnection("connected");
            return;
          }

          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            if (status === "CHANNEL_ERROR") setConnection("error");
            scheduleReconnect();
          }
        });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      removeChannel();
    };
  }, []);

  return connection;
}
