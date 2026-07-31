"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Pick {
  symbol: string;
  pctChange: number | null;
}

interface LeaderboardRow {
  rank: number;
  entryId: string;
  userId: string;
  username: string;
  totalScore: number;
  payout: number;
  isMe: boolean;
  picks: Pick[];
}

interface ContestData {
  prizePool: number;
  isFinal: boolean;
  rows: LeaderboardRow[];
}

export function ContestBigBoard({
  contestId,
  initialData,
}: {
  contestId: string;
  initialData: ContestData;
}) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    if (data.isFinal) return;

    const interval = setInterval(async () => {
      setLoading(true);
      try {
        const resp = await fetch(`/api/sddfs/contest/${contestId}/leaderboard`);
        if (resp.ok) {
          const newData = await resp.json();
          setData(newData);
          setLastUpdate(new Date());
        }
      } catch (e) {
        console.error("Failed to update leaderboard", e);
      } finally {
        setLoading(false);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [contestId, data.isFinal]);

  const toggleEntry = (entryId: string) => {
    const newExpanded = new Set(expandedEntries);
    if (newExpanded.has(entryId)) {
      newExpanded.delete(entryId);
    } else {
      newExpanded.add(entryId);
    }
    setExpandedEntries(newExpanded);
  };

  const formatPct = (pct: number | null) => {
    if (pct == null) return "—";
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(2)}%`;
  };

  const getScoreColor = (score: number) => {
    if (score > 5) return "text-green-500";
    if (score > 0) return "text-green-400";
    if (score > -5) return "text-red-400";
    return "text-red-500";
  };

  const getPickColor = (pct: number | null) => {
    if (pct == null) return "bg-white/5";
    if (pct > 2) return "bg-green-900/20 border-green-700/50";
    if (pct > 0) return "bg-green-900/10 border-green-800/30";
    if (pct > -2) return "bg-red-900/10 border-red-800/30";
    return "bg-red-900/20 border-red-700/50";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-xs text-muted">
            Pool: <span className="font-semibold text-white">${data.prizePool.toFixed(2)}</span>
          </span>
          {!data.isFinal && (
            <span className="text-xs text-muted ml-4">
              Updated: {lastUpdate.toLocaleTimeString()} {loading && "..."}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {data.rows.map((row) => {
          const isExpanded = expandedEntries.has(row.entryId);
          const topStocks = row.picks
            .sort((a, b) => (b.pctChange ?? 0) - (a.pctChange ?? 0))
            .slice(0, 3);

          return (
            <div
              key={row.entryId}
              className={`border border-white/10 rounded-xl overflow-hidden transition ${
                row.isMe ? "bg-gold/5 border-gold/30" : "bg-dark-card hover:bg-white/5"
              }`}
            >
              <button
                onClick={() => toggleEntry(row.entryId)}
                className="w-full px-4 py-3 flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-8 text-center">
                    <span className="font-bold text-lg">#{row.rank}</span>
                  </div>
                  <div>
                    <div
                      className={`font-semibold ${
                        row.isMe ? "text-gold" : "text-white"
                      }`}
                    >
                      {row.isMe ? "You" : row.username}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {topStocks.length > 0 &&
                        topStocks.map((p) => p.symbol).join(" • ")}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className={`font-bold text-lg ${getScoreColor(row.totalScore)}`}>
                    {formatPct(row.totalScore)}
                  </div>
                  <div className="text-xs text-green-400 font-medium">
                    ${row.payout.toFixed(2)}
                  </div>
                </div>

                <div className="ml-4">
                  <span className="text-lg text-muted">
                    {isExpanded ? "▼" : "▶"}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-white/5 px-4 py-3 bg-black/20">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {row.picks.map((pick) => (
                      <div
                        key={pick.symbol}
                        className={`px-3 py-2 rounded-lg border text-sm ${getPickColor(
                          pick.pctChange
                        )}`}
                      >
                        <div className="font-semibold">{pick.symbol}</div>
                        <div
                          className={`text-xs ${
                            pick.pctChange == null
                              ? "text-muted"
                              : pick.pctChange >= 0
                                ? "text-green-400"
                                : "text-red-400"
                          }`}
                        >
                          {formatPct(pick.pctChange)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Link
                    href={`/stockdraft-dfs/entry/${row.entryId}`}
                    className="inline-block mt-3 text-xs text-gold hover:underline"
                  >
                    View full details →
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
