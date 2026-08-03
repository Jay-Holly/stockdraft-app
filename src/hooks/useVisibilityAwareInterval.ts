"use client";

import { useEffect, useRef } from "react";

/**
 * setInterval that only ticks while the tab is visible.
 *
 * Every polling loop in the app used to keep firing in background tabs, so a
 * tab left open overnight kept querying Supabase the whole time — a single 15s
 * poll is ~5,700 requests a day on its own, and enough forgotten tabs saturated
 * the database. Pausing while hidden cuts that to nothing; running the callback
 * once on re-show keeps the data fresh the moment someone comes back, so the
 * pause is invisible to the user.
 */
export function useVisibilityAwareInterval(
  callback: () => void,
  delayMs: number | null,
  options?: { runOnVisible?: boolean }
) {
  const savedCallback = useRef(callback);
  const runOnVisible = options?.runOnVisible ?? true;

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null || delayMs <= 0) return;

    let intervalId: number | undefined;

    const stop = () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const start = () => {
      if (intervalId !== undefined) return;
      intervalId = window.setInterval(() => savedCallback.current(), delayMs);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }
      // Data went stale while hidden; refresh before resuming the cadence.
      if (runOnVisible) savedCallback.current();
      start();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stop();
    };
  }, [delayMs, runOnVisible]);
}
