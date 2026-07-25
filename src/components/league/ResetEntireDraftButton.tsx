"use client";

import { useState } from "react";
import { Button } from "@/components/Button";

export function ResetEntireDraftButton({
  leagueId,
  leagueName,
}: {
  leagueId: string;
  leagueName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    const confirmed = confirm(
      `Wipe EVERY team's picks in "${leagueName}" and restart the draft from pick 1? This cannot be undone.`
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/draft/reset-all`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error ?? "Could not reset the draft.");
        return;
      }
      setMessage("Draft fully reset.");
    } catch {
      setMessage("Could not reset the draft.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        className="text-xs px-3 text-red-400 border-red-500/30 hover:border-red-400/50"
        disabled={busy}
        onClick={handleClick}
      >
        {busy ? "Resetting…" : "Reset entire draft"}
      </Button>
      {message && <p className="text-xs text-muted">{message}</p>}
    </div>
  );
}
