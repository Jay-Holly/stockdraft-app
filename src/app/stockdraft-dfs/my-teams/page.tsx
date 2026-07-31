"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DfsShell } from "@/components/dfs/DfsShell";

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDayHeading(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

interface ContestEntry {
  contestId: string;
  contestName: string;
  buyIn: number;
  contestStatus: "open" | "locked" | "scored";
  finalRank?: number;
  payout?: number;
}

export default function DfsMyTeamsPage() {
  const [entries, setEntries] = useState<Record<string, ContestEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchEntries = async () => {
      const resp = await fetch("/api/sddfs/my-entries");
      if (!resp.ok) {
        setLoading(false);
        return;
      }
      const data = await resp.json();
      setEntries(data.entriesByDay || {});
      setLoading(false);
    };
    fetchEntries();
  }, []);

  const weekStart = startOfWeek(new Date());
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().split("T")[0]);
  }
  days.reverse();

  const toggleDate = (date: string) => {
    const newExpanded = new Set(expandedDates);
    if (newExpanded.has(date)) {
      newExpanded.delete(date);
    } else {
      newExpanded.add(date);
    }
    setExpandedDates(newExpanded);
  };

  const hasAnyEntries = days.some((day) => (entries[day] || []).length > 0);

  if (loading) {
    return (
      <DfsShell title="SDDFS — My Contests">
        <div className="max-w-3xl mx-auto text-center text-muted">
          Loading...
        </div>
      </DfsShell>
    );
  }

  return (
    <DfsShell title="SDDFS — My Contests">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">My Contests</h1>
          <p className="text-muted text-sm">
            This week&apos;s SDDFS contests, organized by day.
          </p>
        </div>

        {!hasAnyEntries ? (
          <div className="bg-dark-card border border-white/10 rounded-xl p-8 text-center text-muted">
            You haven&apos;t entered any SDDFS contests this week.
          </div>
        ) : (
          <div className="space-y-2">
            {days.map((day) => {
              const dayEntries = entries[day] || [];
              if (dayEntries.length === 0) return null;

              const isExpanded = expandedDates.has(day);

              return (
                <div key={day}>
                  <button
                    onClick={() => toggleDate(day)}
                    className="w-full flex items-center justify-between p-4 bg-dark-card border border-white/10 rounded-xl hover:bg-white/5 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">
                        {isExpanded ? "▼" : "▶"}
                      </span>
                      <div>
                        <h2 className="font-semibold">
                          {formatDayHeading(day)}
                        </h2>
                        <p className="text-xs text-muted">
                          {dayEntries.length} contest
                          {dayEntries.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="space-y-2 mt-2 pl-4">
                      {dayEntries.map((entry) => (
                        <Link
                          key={entry.contestId}
                          href={`/stockdraft-dfs/contests/${entry.contestId}`}
                          className="block bg-dark-card border border-white/10 rounded-xl p-4 hover:bg-white/5"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold">
                                {entry.contestName}
                              </div>
                              <div className="text-xs text-muted mt-1">
                                ${entry.buyIn} buy-in
                              </div>
                              <div className="text-xs text-muted">
                                {entry.contestStatus === "open"
                                  ? "Open"
                                  : entry.contestStatus === "locked"
                                    ? "Locked"
                                    : "Scored"}
                              </div>
                            </div>
                            <div className="text-right">
                              {entry.finalRank ? (
                                <>
                                  <div className="font-semibold text-gold">
                                    #{entry.finalRank}
                                  </div>
                                  <div className="text-xs text-green-400">
                                    ${entry.payout?.toFixed(2) ?? "0.00"}
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DfsShell>
  );
}
