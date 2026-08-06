"use client";

import { useState } from "react";
import Image from "next/image";
import { DeleteLeagueModal } from "@/components/league/DeleteLeagueModal";
import { AiLeagueCard } from "@/components/league/AiLeagueCard";
import { useLeagueSelection } from "@/hooks/useLeagueSelection";
import type { AiLeagueListItem } from "@/lib/league/ai-league";
import { LeagueRulesModal } from "@/components/league/LeagueRulesModal";
import { SdaiRulesContent } from "@/components/league/rules-content";

export function SimLeaguesPageContent({
  leagues,
  currentUserId,
  activeLeagueId,
}: {
  leagues: AiLeagueListItem[];
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
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <div className="space-y-4">
      <DeleteLeagueModal
        open={deleteTarget != null}
        leagueId={deleteTarget?.leagueId ?? null}
        leagueName={deleteTarget?.leagueName ?? ""}
        supportCode={deleteTarget?.supportCode ?? ""}
        onClose={() => setDeleteTarget(null)}
      />

      {rulesOpen && (
        <LeagueRulesModal title="SDAI Rules" onClose={() => setRulesOpen(false)}>
          <SdaiRulesContent />
        </LeagueRulesModal>
      )}

      <div className="text-center">
        <Image
          src="/images/leagues/sdai.png"
          alt="SDAI"
          width={160}
          height={160}
          className="mx-auto rounded-2xl"
          priority
        />
        <h1 className="text-xl font-bold mt-4">Sim Leagues</h1>
        <p className="text-muted text-sm mt-2">
          {leagues.length} league{leagues.length === 1 ? "" : "s"} vs. platform
          bot managers
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            className="text-sm font-medium text-gold hover:underline"
          >
            SDAI Rules
          </button>
        </div>
      </div>

      {leagueError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {leagueError}
        </div>
      )}

      {leagues.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark/40 p-4 text-sm text-muted">
          No Sim Leagues yet. Create one from the main dashboard to draft
          against bot managers.
        </div>
      ) : (
        <div className="space-y-4">
          {leagues.map((item) => (
            <AiLeagueCard
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
