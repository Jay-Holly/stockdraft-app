"use client";

import { useEffect, useState } from "react";

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function PickTimer({
  deadlineAt,
  active,
  onExpired,
}: {
  deadlineAt: string | null;
  active: boolean;
  onExpired?: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (!active || !deadlineAt) {
      setRemainingMs(null);
      return;
    }

    function tick() {
      const ms = new Date(deadlineAt!).getTime() - Date.now();
      setRemainingMs(ms);
      if (ms <= 0) {
        onExpired?.();
      }
    }

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [active, deadlineAt, onExpired]);

  if (!active || !deadlineAt || remainingMs === null) return null;

  const urgent = remainingMs <= 30_000;

  return (
    <div
      className={`pick-timer ${urgent ? "pick-timer--urgent" : ""}`}
      role="timer"
      aria-live="polite"
    >
      <span className="pick-timer__label">Pick clock</span>
      <span className="pick-timer__value">{formatCountdown(remainingMs)}</span>
    </div>
  );
}
