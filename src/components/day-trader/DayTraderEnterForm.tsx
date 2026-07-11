"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

type EligibleLeague = {
  leagueId: string;
  leagueName: string;
  leagueType: "ai" | "human";
  teamName: string;
  starters: Array<{ symbol: string; pickOrder: number }>;
};

type DayTraderEnterFormProps = {
  eligibleLeagues: EligibleLeague[];
};

export function DayTraderEnterForm({ eligibleLeagues }: DayTraderEnterFormProps) {
  const router = useRouter();
  const [leagueId, setLeagueId] = useState(eligibleLeagues[0]?.leagueId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected =
    eligibleLeagues.find((league) => league.leagueId === leagueId) ??
    eligibleLeagues[0];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!leagueId) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/day-trader/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Entry failed.");
        return;
      }

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
        <label htmlFor="day-trader-league" className="block text-sm text-muted mb-2">
          Copy starters from
        </label>
        <select
          id="day-trader-league"
          value={leagueId}
          onChange={(event) => setLeagueId(event.target.value)}
          className="w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-sm text-white"
        >
          {eligibleLeagues.map((league) => (
            <option key={league.leagueId} value={league.leagueId}>
              {league.leagueName} ({league.teamName})
            </option>
          ))}
        </select>
      </div>

      {selected ? (
        <div className="rounded-xl border border-[var(--color-league-accent)] bg-dark/60 p-4">
          <p className="text-xs text-muted mb-3">
            Each starter resets to $50,000 at the current price (10 × $50K =
            $500K portfolio).
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {selected.starters.map((starter) => (
              <div
                key={starter.symbol}
                className="rounded-lg bg-primary/20 px-2 py-1.5 text-center text-xs font-semibold"
              >
                {starter.symbol}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={submitting || !leagueId}
      >
        {submitting ? "Entering…" : "Enter This Week's Contest"}
      </Button>
    </form>
  );
}
