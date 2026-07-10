"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type DeleteLeagueTarget = {
  leagueId: string;
  leagueName: string;
  supportCode: string;
};

/** Shared select/delete league actions for dashboard category pages. */
export function useLeagueSelection() {
  const router = useRouter();
  const [switchingLeagueId, setSwitchingLeagueId] = useState<string | null>(
    null
  );
  const [leagueError, setLeagueError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteLeagueTarget | null>(
    null
  );

  async function setActiveLeague(leagueId: string, navigateTo?: string) {
    setSwitchingLeagueId(leagueId);
    try {
      const res = await fetch("/api/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setLeagueError(data.error ?? "Could not switch league");
        return;
      }
      if (navigateTo) {
        router.push(navigateTo);
      } else {
        router.refresh();
      }
    } finally {
      setSwitchingLeagueId(null);
    }
  }

  function openDeleteLeagueModal(league: {
    id: string;
    name: string;
    support_code: string;
  }) {
    setDeleteTarget({
      leagueId: league.id,
      leagueName: league.name,
      supportCode: league.support_code,
    });
  }

  return {
    switchingLeagueId,
    leagueError,
    setLeagueError,
    deleteTarget,
    setDeleteTarget,
    setActiveLeague,
    openDeleteLeagueModal,
  };
}
