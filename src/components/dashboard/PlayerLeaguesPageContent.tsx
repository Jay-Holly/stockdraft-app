"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { DeleteLeagueModal } from "@/components/league/DeleteLeagueModal";
import { HumanLeagueCard } from "@/components/league/HumanLeagueCard";
import { useLeagueSelection } from "@/hooks/useLeagueSelection";
import type { HumanLeagueListItem } from "@/lib/league/human-league";
import { LeagueRulesModal } from "@/components/league/LeagueRulesModal";
import { SdplRulesContent } from "@/components/league/rules-content";

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
  const [rulesOpen, setRulesOpen] = useState(false);
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

      {rulesOpen && (
        <LeagueRulesModal title="SDPL Rules" onClose={() => setRulesOpen(false)}>
          <SdplRulesContent />
        </LeagueRulesModal>
      )}

      <div className="text-center">
        <Image
          src="/images/leagues/sdpl.png"
          alt="SDPL"
          width={160}
          height={160}
          className="mx-auto rounded-2xl"
          priority
        />
        <h1 className="text-xl font-bold mt-4">Player Leagues</h1>
        <p className="text-muted text-sm mt-2">
          Draft against real managers, invite-only or open.
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            className="text-sm font-medium text-gold hover:underline"
          >
            SDPL Rules
          </button>
        </div>
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
