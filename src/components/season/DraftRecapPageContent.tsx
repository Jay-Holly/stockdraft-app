"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/format";

type DraftRecapPick = {
  globalPickNumber: number;
  roundNumber: number;
  teamName: string;
  userId: string;
  symbol: string;
  pickType: string;
  budgetSpent: number;
  isAutoPick: boolean;
};

type DraftRecapPageData = {
  leagueId: string;
  leagueName: string;
  totalPicks: number;
  totalRounds: number;
  picks: DraftRecapPick[];
};

function downloadCsv(data: DraftRecapPageData) {
  const header = ["Round", "Pick #", "Team", "Asset", "Type", "Price", "Auto-pick"];
  const rows = data.picks.map((pick) => [
    pick.roundNumber,
    pick.globalPickNumber,
    pick.teamName,
    pick.symbol,
    pick.pickType,
    pick.budgetSpent.toFixed(2),
    pick.isAutoPick ? "yes" : "no",
  ]);

  const csv = [header, ...rows]
    .map((row) =>
      row
        .map((cell) => {
          const str = String(cell);
          return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${data.leagueName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-draft-recap.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function DraftRecapPageContent() {
  const [data, setData] = useState<DraftRecapPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/draft-recap", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not load draft recap");
        setLoading(false);
        return;
      }
      setData(json as DraftRecapPageData);
      setError(null);
      setLoading(false);
    } catch {
      setError("Network error loading draft recap");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toUpperCase();
    if (!q) return data.picks;
    return data.picks.filter(
      (pick) =>
        pick.symbol.toUpperCase().includes(q) ||
        pick.teamName.toUpperCase().includes(q)
    );
  }, [data, filter]);

  if (loading && !data) {
    return <p className="text-muted text-sm py-12 text-center">Loading draft recap…</p>;
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
        {error}
      </div>
    );
  }

  if (!data) return null;

  let lastRound: number | null = null;

  return (
    <div className="space-y-4">
      <section className="season-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Draft Recap</h1>
            <p className="text-muted text-xs mt-1">
              {data.leagueName} · {data.totalPicks} picks · {data.totalRounds} rounds
            </p>
          </div>
          <button
            type="button"
            className="season-select-btn"
            onClick={() => downloadCsv(data)}
          >
            Download CSV
          </button>
        </div>
        <input
          type="search"
          placeholder="Filter by ticker or team…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="draft-input w-full mt-3"
        />
      </section>

      <section className="season-card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="season-standings-table">
            <thead>
              <tr>
                <th>Pick</th>
                <th>Team</th>
                <th>Asset</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((pick) => {
                const showRoundHeader = pick.roundNumber !== lastRound;
                lastRound = pick.roundNumber;
                return (
                  <FragmentRow
                    key={pick.globalPickNumber}
                    pick={pick}
                    showRoundHeader={showRoundHeader}
                  />
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="text-sm text-muted p-4">No picks match that filter.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function FragmentRow({
  pick,
  showRoundHeader,
}: {
  pick: DraftRecapPick;
  showRoundHeader: boolean;
}) {
  return (
    <>
      {showRoundHeader && (
        <tr>
          <td colSpan={4} className="text-xs text-gold font-semibold uppercase tracking-wide pt-4">
            Round {pick.roundNumber}
          </td>
        </tr>
      )}
      <tr>
        <td>{pick.globalPickNumber}</td>
        <td>{pick.teamName}</td>
        <td>
          <span className="font-semibold">{pick.symbol}</span>
          {pick.isAutoPick && (
            <span className="text-[10px] text-muted ml-1">(auto)</span>
          )}
        </td>
        <td>{formatMoney(pick.budgetSpent)}</td>
      </tr>
    </>
  );
}
