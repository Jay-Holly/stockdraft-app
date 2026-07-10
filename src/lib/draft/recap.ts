import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireSeasonLeague } from "@/lib/roster/server";
import type { DraftFeedEvent } from "@/lib/draft/types";

export type DraftRecapPick = {
  globalPickNumber: number;
  roundNumber: number;
  teamName: string;
  userId: string;
  symbol: string;
  pickType: string;
  budgetSpent: number;
  isAutoPick: boolean;
};

export type DraftRecapPageData = {
  leagueId: string;
  leagueName: string;
  totalPicks: number;
  totalRounds: number;
  picks: DraftRecapPick[];
};

export async function loadDraftRecapPageData(
  userId: string
): Promise<{ ok: true; data: DraftRecapPageData } | { ok: false; error: string }> {
  const season = await requireSeasonLeague(userId);
  if ("error" in season) return { ok: false, error: season.error };

  const { league } = season;
  const supabase = await createClient();

  const { data: events, error } = await supabase
    .from("league_draft_events")
    .select("*")
    .eq("league_id", league.id)
    .neq("pick_type", "skip")
    .order("global_pick_number", { ascending: true });

  if (error) return { ok: false, error: error.message };
  if (!events || events.length === 0) {
    return {
      ok: false,
      error: "No draft picks recorded yet for this league.",
    };
  }

  // league_draft_events occasionally has exact-duplicate rows for the same
  // global_pick_number (a double-write in event logging, not a real double
  // pick) — keep one entry per pick number rather than showing duplicates.
  const byPickNumber = new Map<number, DraftFeedEvent>();
  for (const event of events as DraftFeedEvent[]) {
    byPickNumber.set(event.global_pick_number, event);
  }

  const picks: DraftRecapPick[] = [...byPickNumber.values()]
    .sort((a, b) => a.global_pick_number - b.global_pick_number)
    .map((event) => ({
      globalPickNumber: event.global_pick_number,
      roundNumber: event.round_number,
      teamName: event.team_name,
      userId: event.user_id,
      symbol: event.symbol,
      pickType: event.pick_type,
      budgetSpent: event.budget_spent,
      isAutoPick: event.is_auto_pick,
    }));

  const totalRounds = picks.reduce(
    (max, pick) => Math.max(max, pick.roundNumber),
    0
  );

  return {
    ok: true,
    data: {
      leagueId: league.id,
      leagueName: league.name,
      totalPicks: picks.length,
      totalRounds,
      picks,
    },
  };
}
