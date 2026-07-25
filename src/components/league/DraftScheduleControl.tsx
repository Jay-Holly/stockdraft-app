"use client";

import { useState } from "react";
import { Button } from "@/components/Button";

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function DraftScheduleControl({
  leagueId,
  scheduledDraftAt,
  onUpdated,
}: {
  leagueId: string;
  scheduledDraftAt: string | null;
  onUpdated: (scheduledDraftAt: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => toDatetimeLocalValue(scheduledDraftAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!value) {
      setError("Pick a date and time.");
      return;
    }
    const iso = new Date(value).toISOString();
    setSaving(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledDraftAt: iso }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not update the draft time.");
        return;
      }
      onUpdated(data.scheduledDraftAt ?? iso);
      setEditing(false);
    } catch {
      setError("Network error — try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dark-border bg-dark/40 px-4 py-3">
        <p className="text-sm text-muted">
          Draft time:{" "}
          <span className="text-white font-medium">
            {scheduledDraftAt
              ? new Date(scheduledDraftAt).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })
              : "Not scheduled yet"}
          </span>
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setValue(toDatetimeLocalValue(scheduledDraftAt));
            setError(null);
            setEditing(true);
          }}
        >
          Reset draft time
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-gold/30 bg-gold/5 px-4 py-3">
      <label className="block text-sm font-semibold" htmlFor="scheduled-draft-at">
        New draft date &amp; time
      </label>
      <input
        id="scheduled-draft-at"
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
