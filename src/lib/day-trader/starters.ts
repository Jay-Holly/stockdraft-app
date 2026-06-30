import { loadDraftStateDetailed } from "@/lib/draft/server";
import type { DraftPick } from "@/lib/draft/types";
import { STOCK_ROUNDS } from "@/lib/draft/types";
import { verifyUserCanAccessLeague } from "@/lib/league/active-league";
import { createClient } from "@/lib/supabase/server";

export type DayTraderStarterPick = {
  id: string;
  symbol: string;
  pickOrder: number;
};

export type LoadLeagueStockStartersResult =
  | { ok: true; picks: DayTraderStarterPick[] }
  | { ok: false; error: string };

function isActiveStockStarter(pick: DraftPick): boolean {
  return (
    pick.pick_type === "stock" &&
    pick.symbol.trim().length > 0 &&
    pick.symbol.toUpperCase() !== "__OPEN__"
  );
}

export async function loadLeagueStockStarters(
  userId: string,
  leagueId: string
): Promise<LoadLeagueStockStartersResult> {
  if (!(await verifyUserCanAccessLeague(userId, leagueId))) {
    return { ok: false, error: "You do not have access to that league." };
  }

  const draft = await loadDraftStateDetailed(userId, { leagueId });
  if (!draft.ok) {
    return { ok: false, error: draft.error };
  }

  if (draft.state.draft.status !== "complete") {
    return {
      ok: false,
      error: "Finish your league draft before entering Day Trader.",
    };
  }

  const picks = draft.state.picks
    .filter(isActiveStockStarter)
    .sort((a, b) => a.pick_order - b.pick_order)
    .map((pick) => ({
      id: pick.id,
      symbol: pick.symbol.toUpperCase(),
      pickOrder: pick.pick_order,
    }));

  if (picks.length !== STOCK_ROUNDS) {
    return {
      ok: false,
      error: `Need exactly ${STOCK_ROUNDS} starter stocks (found ${picks.length}).`,
    };
  }

  return { ok: true, picks };
}

export async function loadLeagueName(leagueId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select("name")
    .eq("id", leagueId)
    .maybeSingle();

  return data?.name ?? null;
}
