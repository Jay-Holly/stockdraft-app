"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlayerDetailsModal } from "./PlayerDetailsModal";

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

/**
 * Shared by SDDFS and SDWFS. `league` selects which contest family's API and
 * entry routes to talk to — without it the WFS board silently polls the DFS
 * endpoint and links to DFS entries.
 */
export function ContestBigBoard({
  contestId,
  initialData,
  league,
}: {
  contestId: string;
  initialData: ContestData;
  league: "sddfs" | "sdwfs";
}) {
  const apiBase = league === "sddfs" ? "/api/sddfs" : "/api/sdwfs";
  const entryBase =
    league === "sddfs" ? "/stockdraft-dfs/entry" : "/stockdraft-wfs/entry";
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [selectedPlayer, setSelectedPlayer] = useState<LeaderboardRow | null>(
    null
  );

  useEffect(() => {
    if (data.isFinal) return;

    const interval = setInterval(async () => {
      setLoading(true);
      try {
        const resp = await fetch(`${apiBase}/contest/${contestId}/leaderboard`);
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
  }, [contestId, data.isFinal, apiBase]);


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
          const topStocks = row.picks
            .sort((a, b) => (b.pctChange ?? 0) - (a.pctChange ?? 0))
            .slice(0, 3);

          return (
            <button
              key={row.entryId}
              onClick={() => setSelectedPlayer(row)}
              className={`w-full px-4 py-3 border border-white/10 rounded-xl flex items-center justify-between text-left transition hover:border-white/30 ${
                row.isMe ? "bg-gold/5 border-gold/30" : "bg-dark-card hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-8 text-center flex-shrink-0">
                  <span className="font-bold text-lg">#{row.rank}</span>
                </div>
                <div className="min-w-0">
                  <div
                    className={`font-semibold truncate ${
                      row.isMe ? "text-gold" : "text-white"
                    }`}
                  >
                    {row.isMe ? "You" : row.username}
                  </div>
                  <div className="text-xs text-muted mt-0.5 truncate">
                    {topStocks.length > 0 &&
                      topStocks.map((p) => p.symbol).join(" • ")}
                  </div>
                </div>
              </div>

              <div className="text-right flex-shrink-0 ml-4">
                <div className={`font-bold text-lg ${getScoreColor(row.totalScore)}`}>
                  {formatPct(row.totalScore)}
                </div>
                <div className="text-xs text-green-400 font-medium">
                  ${row.payout.toFixed(2)}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedPlayer && (
        <PlayerDetailsModal
          player={selectedPlayer}
          allPlayers={data.rows}
          entryBase={entryBase}
          onClose={() => setSelectedPlayer(null)}
          onPlayerChange={setSelectedPlayer}
        />
      )}
    </div>
  );
}
