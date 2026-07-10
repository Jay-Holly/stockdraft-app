"use client";

import { useMemo, useState } from "react";
import { DeleteLeagueModal } from "@/components/league/DeleteLeagueModal";
import { HumanLeagueCard } from "@/components/league/HumanLeagueCard";
import { useLeagueSelection } from "@/hooks/useLeagueSelection";
import type { HumanLeagueListItem } from "@/lib/league/human-league";

type Visibility = "private" | "public";

export function PlayerLeaguesPageContent({
  leagues,
  currentUserId,
  activeLeagueId,
}: {
  leagues: HumanLeagueListItem[];
  currentUserId: string;
  activeLeagueId: string | null;
}) {
  const [tab, setTab] = useState<Visibility>("private");
  const {
    switchingLeagueId,
    leagueError,
    deleteTarget,
    setDeleteTarget,
    setActiveLeague,
    openDeleteLeagueModal,
  } = useLeagueSelection();

  const privateLeagues = useMemo(
    () => leagues.filter((item) => item.league.visibility === "private"),
    [leagues]
  );
  const publicLeagues = useMemo(
    () => leagues.filter((item) => item.league.visibility === "public"),
    [leagues]
  );

  const visible = tab === "private" ? privateLeagues : publicLeagues;

  return (
    <div className="space-y-4">
      <DeleteLeagueModal
        open={deleteTarget != null}
        leagueId={deleteTarget?.leagueId ?? null}
        leagueName={deleteTarget?.leagueName ?? ""}
        supportCode={deleteTarget?.supportCode ?? ""}
        onClose={() => setDeleteTarget(null)}
      />

      <div>
        <h1 className="text-xl font-bold">Player Leagues</h1>
        <p className="text-muted text-sm mt-1">
          Draft against real managers, invite-only or open.
        </p>
      </div>

      <div className="draft-pool-filters">
        <button
          type="button"
          className={`draft-filter-btn ${tab === "private" ? "draft-filter-btn--active" : ""}`}
          onClick={() => setTab("private")}
        >
          Private ({privateLeagues.length})
        </button>
        <button
          type="button"
          className={`draft-filter-btn ${tab === "public" ? "draft-filter-btn--active" : ""}`}
          onClick={() => setTab("public")}
        >
          Public ({publicLeagues.length})
        </button>
      </div>

      {leagueError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {leagueError}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
          {tab === "private"
            ? "No private Player Leagues yet. Create one from the main dashboard and invite friends."
            : "Public leagues (join without an invite) aren't open yet — check back later."}
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((item) => (
            <HumanLeagueCard
              key={item.league.id}
              item={item}
              currentUserId={currentUserId}
              activeLeagueId={activeLeagueId}
              switchingLeagueId={switchingLeagueId}
              onSelect={(leagueId, navigateTo) =>
                void setActiveLeague(leagueId, navigateTo)
              }
              onDelete={openDeleteLeagueModal}
            />
          ))}
        </div>
      )}
    </div>
  );
}
