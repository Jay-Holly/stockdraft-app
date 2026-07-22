"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { isSdflLeague } from "@/lib/league/sdfl-divisions";
import type { PublicHumanLeagueListItem } from "@/lib/league/human-league";

const inputClass =
  "w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm";

export function PublicLeagueList({
  leagues,
  defaultTeamName,
  sportsLeagueId,
}: {
  leagues: PublicHumanLeagueListItem[];
  defaultTeamName: string;
  /** Present for sports-sim leagues (SDFL uses "Pending" team names, no input needed). */
  sportsLeagueId?: string;
}) {
  const router = useRouter();
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [teamNameById, setTeamNameById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const isSdfl = sportsLeagueId ? isSdflLeague(sportsLeagueId) : false;

  if (leagues.length === 0) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
        No public leagues are waiting for players right now. Check back soon,
        or create your own league and invite friends.
      </div>
    );
  }

  async function handleJoin(leagueId: string) {
    setError(null);
    setJoiningId(leagueId);
    try {
      const teamName = isSdfl ? "" : (teamNameById[leagueId] ?? defaultTeamName);
      const res = await fetch("/api/leagues/join-public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, teamName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not join league.");
        return;
      }
      router.push(
        typeof data.redirectTo === "string"
          ? data.redirectTo
          : isSdfl
            ? `/leagues/${data.activeLeagueId}/identity`
            : "/draft"
      );
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {leagues.map((league) => {
        const isFull = league.memberCount >= league.playerCount;
        const busy = joiningId === league.leagueId;
        return (
          <div
            key={league.leagueId}
            className="rounded-xl border border-dark-border bg-dark-card p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold truncate">{league.leagueName}</p>
                <p className="text-xs text-muted truncate">
                  @{league.commissionerUsername}
                </p>
              </div>
              <span
                className={`shrink-0 text-xs font-semibold rounded-full px-2.5 py-1 ${
                  isFull
                    ? "bg-dark/60 text-muted"
                    : "bg-[var(--color-league-primary)]/15 text-[var(--color-league-primary)]"
                }`}
              >
                {isFull ? "FULL" : `${league.memberCount} / ${league.playerCount} teams`}
              </span>
            </div>

            {!isSdfl && !isFull && (
              <input
                className={inputClass}
                placeholder="Your team name"
                maxLength={40}
                value={teamNameById[league.leagueId] ?? defaultTeamName}
                onChange={(e) =>
                  setTeamNameById((prev) => ({
                    ...prev,
                    [league.leagueId]: e.target.value,
                  }))
                }
              />
            )}

            <Button
              variant="primary"
              className="w-full !text-white"
              disabled={isFull || busy}
              onClick={() => handleJoin(league.leagueId)}
            >
              {isFull ? "League full" : busy ? "Joining…" : "Join league"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
