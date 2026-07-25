"use client";

import { useState } from "react";
import { Button } from "@/components/Button";

export function ResetDraftClockButton({ leagueId }: { leagueId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/draft/reset-clock`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error ?? "Could not reset the draft clock.");
        return;
      }
      setMessage("Draft clock reset.");
    } catch {
      setMessage("Could not reset the draft clock.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        className="text-xs px-3"
        disabled={busy}
        onClick={handleClick}
      >
        {busy ? "Resetting…" : "Reset draft time"}
      </Button>
      {message && <p className="text-xs text-muted">{message}</p>}
    </div>
  );
}
