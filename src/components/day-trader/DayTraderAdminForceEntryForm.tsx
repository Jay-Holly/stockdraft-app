"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

export function DayTraderAdminForceEntryForm() {
  const router = useRouter();
  const [supportCode, setSupportCode] = useState("SDAI-00039");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/day-trader/admin/force-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supportCode: supportCode.trim() }),
      });
      const payload = (await response.json()) as {
        error?: string;
        entry?: { id: string };
      };

      if (!response.ok) {
        setError(payload.error ?? "Force entry failed.");
        return;
      }

      setMessage("Entry created. Open /day-trader to trade or view the portfolio.");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <p className="text-sm font-semibold mb-1">Beta: force entry (admin)</p>
        <p className="text-xs text-muted mb-3">
          Bypasses the Fri 4 PM – Mon 9:30 AM entry window for the current open
          contest week. Uses your logged-in account and the league&apos;s 10
          starters.
        </p>
        <label htmlFor="force-support-code" className="block text-sm text-muted mb-2">
          League support code
        </label>
        <input
          id="force-support-code"
          value={supportCode}
          onChange={(event) => setSupportCode(event.target.value.toUpperCase())}
          className="w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-sm"
          placeholder="SDAI-00039"
        />
      </div>

      {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button type="submit" variant="secondary" className="w-full" disabled={submitting}>
        {submitting ? "Creating entry…" : "Force entry for this week"}
      </Button>
    </form>
  );
}
