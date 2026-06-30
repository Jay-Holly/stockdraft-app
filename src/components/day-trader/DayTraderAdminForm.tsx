"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/Button";
import { formatDayTraderContestRange } from "@/lib/day-trader/format-contest";
import type { DayTraderContestRow } from "@/lib/day-trader/types";

type DayTraderAdminFormProps = {
  contests: DayTraderContestRow[];
  initialContestId: string | null;
};

function contestFields(contest: DayTraderContestRow) {
  return {
    contestName: contest.contest_name,
    dollarPrizeText: contest.dollar_prize_text,
    percentPrizeText: contest.percent_prize_text,
  };
}

export function DayTraderAdminForm({
  contests,
  initialContestId,
}: DayTraderAdminFormProps) {
  const router = useRouter();
  const defaultContestId = initialContestId ?? contests[0]?.id ?? "";
  const [contestId, setContestId] = useState(defaultContestId);
  const [contestName, setContestName] = useState("");
  const [dollarPrizeText, setDollarPrizeText] = useState("");
  const [percentPrizeText, setPercentPrizeText] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => contests.find((contest) => contest.id === contestId) ?? null,
    [contests, contestId]
  );

  useEffect(() => {
    if (!selected) return;
    const fields = contestFields(selected);
    setContestName(fields.contestName);
    setDollarPrizeText(fields.dollarPrizeText);
    setPercentPrizeText(fields.percentPrizeText);
  }, [selected]);

  function handleContestChange(nextId: string) {
    setContestId(nextId);
    setMessage(null);
    setError(null);
  }

  if (contests.length === 0) {
    return (
      <p className="text-sm text-muted">
        No contests yet. Lifecycle sync will create the next week automatically.
      </p>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!contestId) return;

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/day-trader/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contestId,
          contestName,
          dollarPrizeText,
          percentPrizeText,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Save failed.");
        return;
      }

      setMessage("Contest settings saved.");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="admin-contest" className="block text-sm text-muted mb-2">
          Contest week
        </label>
        <select
          id="admin-contest"
          value={contestId}
          onChange={(event) => handleContestChange(event.target.value)}
          className="w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-sm text-white"
        >
          {contests.map((contest) => (
            <option key={contest.id} value={contest.id}>
              {contest.contest_name} · {contest.status} ·{" "}
              {formatDayTraderContestRange(
                contest.week_start_at,
                contest.week_end_at
              )}
            </option>
          ))}
        </select>
      </div>

      {selected ? (
        <p className="text-xs text-muted capitalize">Status: {selected.status}</p>
      ) : null}

      <div>
        <label htmlFor="contest-name" className="block text-sm text-muted mb-2">
          Contest name
        </label>
        <input
          id="contest-name"
          value={contestName}
          onChange={(event) => setContestName(event.target.value)}
          className="w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-sm"
          required
        />
      </div>

      <div>
        <label htmlFor="dollar-prize" className="block text-sm text-muted mb-2">
          $ Gainer prize text
        </label>
        <textarea
          id="dollar-prize"
          value={dollarPrizeText}
          onChange={(event) => setDollarPrizeText(event.target.value)}
          rows={3}
          className="w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-sm"
          placeholder="e.g. $100 Amazon gift card"
        />
      </div>

      <div>
        <label htmlFor="percent-prize" className="block text-sm text-muted mb-2">
          % Gainer prize text
        </label>
        <textarea
          id="percent-prize"
          value={percentPrizeText}
          onChange={(event) => setPercentPrizeText(event.target.value)}
          rows={3}
          className="w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-sm"
          placeholder="e.g. Bragging rights + featured on the homepage"
        />
      </div>

      {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button type="submit" variant="primary" className="w-full" disabled={saving}>
        {saving ? "Saving…" : "Save contest settings"}
      </Button>

      <Link
        href="/dashboard"
        className="block text-center text-sm text-muted hover:text-white"
      >
        Back to dashboard
      </Link>
    </form>
  );
}
