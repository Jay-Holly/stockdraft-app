"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import symbolNames from "@/data/symbol-names.json";

const SYMBOL_NAMES: Record<string, string> = symbolNames.names;

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

export function PlayerDetailsModal({
  player,
  allPlayers,
  entryBase,
  onClose,
  onPlayerChange,
}: {
  player: LeaderboardRow;
  allPlayers: LeaderboardRow[];
  /** Route prefix for entry detail pages, e.g. "/stockdraft-dfs/entry". */
  entryBase: string;
  onClose: () => void;
  onPlayerChange: (player: LeaderboardRow) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredPlayers = useMemo(() => {
    if (!searchQuery.trim()) return allPlayers;
    const query = searchQuery.toLowerCase();
    return allPlayers.filter((p) =>
      p.username.toLowerCase().includes(query)
    );
  }, [searchQuery, allPlayers]);

  /**
   * Shortcut ranks for the jump menu, always including the rank being viewed —
   * a <select> whose value isn't among its options renders blank.
   */
  const jumpRanks = useMemo(() => {
    const existing = new Set(allPlayers.map((p) => p.rank));
    const shortcuts = [1, 2, 3, 5, 10, 20, 50, 100].filter((r) =>
      existing.has(r)
    );
    return [...new Set([...shortcuts, player.rank])].sort((a, b) => a - b);
  }, [allPlayers, player.rank]);

  const currentIndex = filteredPlayers.findIndex(
    (p) => p.entryId === player.entryId
  );
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < filteredPlayers.length - 1;

  const handlePrev = () => {
    if (canGoPrev) {
      onPlayerChange(filteredPlayers[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (canGoNext) {
      onPlayerChange(filteredPlayers[currentIndex + 1]);
    }
  };

  const handleJumpToRank = (rank: number) => {
    const targetPlayer = allPlayers.find((p) => p.rank === rank);
    if (targetPlayer) {
      setSearchQuery("");
      onPlayerChange(targetPlayer);
    }
  };

  const formatPct = (pct: number | null) => {
    if (pct == null) return "—";
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(2)}%`;
  };

  const getPickColor = (pct: number | null) => {
    if (pct == null) return "bg-white/5";
    if (pct > 2) return "bg-green-900/20 border-green-700/50";
    if (pct > 0) return "bg-green-900/10 border-green-800/30";
    if (pct > -2) return "bg-red-900/10 border-red-800/30";
    return "bg-red-900/20 border-red-700/50";
  };

  const getScoreColor = (score: number) => {
    if (score > 5) return "text-green-500";
    if (score > 0) return "text-green-400";
    if (score > -5) return "text-red-400";
    return "text-red-500";
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-dark-card border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-dark-card border-b border-white/10 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={onClose}
              className="text-white/50 hover:text-white text-2xl leading-none"
            >
              ✕
            </button>
            <div className="text-right">
              <div className="text-xs text-muted">
                Showing {currentIndex + 1} of {filteredPlayers.length}
              </div>
            </div>
          </div>

          {/* Player Info */}
          <div className="space-y-2">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold text-muted">#{player.rank}</span>
              <span className={`text-3xl font-bold ${player.isMe ? "text-gold" : "text-white"}`}>
                {player.isMe ? "You" : player.username}
              </span>
            </div>
            <div className="flex gap-6">
              <div>
                <div className="text-xs text-muted">Score</div>
                <div className={`text-2xl font-bold ${getScoreColor(player.totalScore)}`}>
                  {formatPct(player.totalScore)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted">Payout</div>
                <div className="text-2xl font-bold text-green-400">
                  ${player.payout.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Search & Navigation */}
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Search players..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-gold/50"
            />

            <div className="flex gap-2">
              <button
                onClick={handlePrev}
                disabled={!canGoPrev}
                className="flex-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-2 rounded-lg text-sm font-medium transition"
              >
                ← Prev
              </button>

              <select
                value={player.rank}
                onChange={(e) => handleJumpToRank(Number(e.target.value))}
                className="flex-1 bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg text-sm font-medium appearance-none cursor-pointer transition text-white"
              >
                <option value="" disabled>
                  Jump to rank...
                </option>
                {jumpRanks.map((rank) => (
                  <option key={rank} value={rank}>
                    #{rank}
                  </option>
                ))}
              </select>

              <button
                onClick={handleNext}
                disabled={!canGoNext}
                className="flex-1 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-2 rounded-lg text-sm font-medium transition"
              >
                Next →
              </button>
            </div>
          </div>
        </div>

        {/* Lineup */}
        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-muted uppercase mb-4">
              12-Pick Lineup
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {player.picks.map((pick) => (
                <div
                  key={pick.symbol}
                  className={`px-4 py-3 rounded-lg border text-sm flex items-center justify-between gap-2 ${getPickColor(
                    pick.pctChange
                  )}`}
                >
                  <div className="min-w-0">
                    <div className="font-bold text-lg">{pick.symbol}</div>
                    <div className="text-xs text-muted truncate">
                      {SYMBOL_NAMES[pick.symbol.toUpperCase()] ?? ""}
                    </div>
                  </div>
                  <div
                    className={`text-xl font-bold flex-shrink-0 ${
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
          </div>

          <Link
            href={`${entryBase}/${player.entryId}`}
            className="inline-block text-sm text-gold hover:underline"
          >
            View full entry details →
          </Link>
        </div>
      </div>
    </div>
  );
}
