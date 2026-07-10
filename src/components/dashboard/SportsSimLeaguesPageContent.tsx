"use client";

import { DeleteLeagueModal } from "@/components/league/DeleteLeagueModal";
import { HumanLeagueCard } from "@/components/league/HumanLeagueCard";
import { useLeagueSelection } from "@/hooks/useLeagueSelection";
import type { HumanLeagueListItem } from "@/lib/league/human-league";

export function SportsSimLeaguesPageContent({
  leagues,
  currentUserId,
  activeLeagueId,
}: {
  leagues: HumanLeagueListItem[];
  currentUserId: string;
  activeLeagueId: string | null;
}) {
  const {
    switchingLeagueId,
    leagueError,
    deleteTarget,
    setDeleteTarget,
    setActiveLeague,
    openDeleteLeagueModal,
  } = useLeagueSelection();

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
        <h1 className="text-xl font-bold">Sports Sim Leagues</h1>
        <p className="text-muted text-sm mt-1">
          Draft real players&apos; stocks — injuries and all.
        </p>
      </div>

      {leagueError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {leagueError}
        </div>
      )}

      {leagues.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
          No Sports Sim leagues yet. Create an SDFL league from the main
          dashboard to get started.
        </div>
      ) : (
        <div className="space-y-4">
          {leagues.map((item) => (
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
