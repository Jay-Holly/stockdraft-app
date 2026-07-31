"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WfsShell } from "@/components/dfs/WfsShell";

function formatWeekHeading(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return `${start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} — ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

interface ContestEntry {
  contestId: string;
  contestName: string;
  buyIn: number;
  startDate: string;
  endDate: string;
  contestStatus: "open" | "locked" | "scored";
  finalRank?: number;
  payout?: number;
}

interface WeekData {
  week: string;
  contests: ContestEntry[];
}

export default function WfsMyTeamsPage() {
  const [weeks, setWeeks] = useState<WeekData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchEntries = async () => {
      const resp = await fetch("/api/sdwfs/my-entries");
      if (!resp.ok) {
        setLoading(false);
        return;
      }
      const data = await resp.json();
      const entriesByWeek = data.entriesByWeek || {};

      const weeksArray: WeekData[] = Object.entries(entriesByWeek).map(
        ([weekKey, contests]: [string, any]) => {
          const [startDate] = weekKey.split("_");
          return {
            week: weekKey,
            contests: contests as ContestEntry[],
          };
        }
      );

      setWeeks(weeksArray);
      setLoading(false);
    };
    fetchEntries();
  }, []);

  const toggleWeek = (week: string) => {
    const newExpanded = new Set(expandedWeeks);
    if (newExpanded.has(week)) {
      newExpanded.delete(week);
    } else {
      newExpanded.add(week);
    }
    setExpandedWeeks(newExpanded);
  };

  if (loading) {
    return (
      <WfsShell title="SDWFS — My Contests">
        <div className="max-w-3xl mx-auto text-center text-muted">
          Loading...
        </div>
      </WfsShell>
    );
  }

  return (
    <WfsShell title="SDWFS — My Contests">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">My Contests</h1>
          <p className="text-muted text-sm">
            Your SDWFS contests from the last month, organized by week.
          </p>
        </div>

        {weeks.length === 0 ? (
          <div className="bg-dark-card border border-white/10 rounded-xl p-8 text-center text-muted">
            You haven&apos;t entered any SDWFS contests in the last month.
          </div>
        ) : (
          <div className="space-y-2">
            {weeks.map((weekData) => {
              const isExpanded = expandedWeeks.has(weekData.week);
              const [startDate, endDate] = weekData.week.split("_");

              return (
                <div key={weekData.week}>
                  <button
                    onClick={() => toggleWeek(weekData.week)}
                    className="w-full flex items-center justify-between p-4 bg-dark-card border border-white/10 rounded-xl hover:bg-white/5 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">
                        {isExpanded ? "▼" : "▶"}
                      </span>
                      <div>
                        <h2 className="font-semibold">
                          Week of {formatWeekHeading(startDate, endDate)}
                        </h2>
                        <p className="text-xs text-muted">
                          {weekData.contests.length} contest
                          {weekData.contests.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="space-y-2 mt-2 pl-4">
                      {weekData.contests.map((entry) => (
                        <Link
                          key={entry.contestId}
                          href={`/stockdraft-wfs/contests/${entry.contestId}`}
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
    </WfsShell>
  );
}
