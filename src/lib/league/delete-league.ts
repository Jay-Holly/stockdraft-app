import { createClient } from "@/lib/supabase/server";

export type LeagueDeletePreview = {
  leagueId: string;
  leagueName: string;
  supportCode: string;
  leagueType: string;
  draftPickCount: number;
};

export async function assertLeagueOwnerForDelete(
  userId: string,
  leagueId: string
): Promise<
  | {
      league: {
        league_type: string;
        owner_user_id: string;
        name: string;
        support_code: string;
      };
    }
  | { error: string }
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select("league_type, owner_user_id, name, support_code")
    .eq("id", leagueId)
    .maybeSingle();

  if (!data?.owner_user_id || data.owner_user_id !== userId) {
    return { error: "League not found." };
  }

  if (data.league_type === "solo") {
    return { error: "Solo leagues cannot be deleted." };
  }

  return { league: data };
}

/** Non-skip picks across all drafts in the league. */
export async function countLeagueDraftPicks(leagueId: string): Promise<number> {
  const supabase = await createClient();
  const { data: drafts } = await supabase
    .from("drafts")
    .select("id")
    .eq("league_id", leagueId);

  const draftIds = (drafts ?? []).map((row) => row.id);
  if (draftIds.length === 0) return 0;

  const { count, error } = await supabase
    .from("draft_picks")
    .select("*", { count: "exact", head: true })
    .in("draft_id", draftIds)
    .neq("pick_type", "skip");

  if (error) {
    console.error("countLeagueDraftPicks failed:", error.message);
    return 0;
  }

  return count ?? 0;
}

export async function getLeagueDeletePreview(
  userId: string,
  leagueId: string
): Promise<{ preview?: LeagueDeletePreview; error?: string }> {
  const owner = await assertLeagueOwnerForDelete(userId, leagueId);
  if ("error" in owner) {
    return { error: owner.error };
  }

  const draftPickCount = await countLeagueDraftPicks(leagueId);

  return {
    preview: {
      leagueId,
      leagueName: owner.league.name,
      supportCode: owner.league.support_code,
      leagueType: owner.league.league_type,
      draftPickCount,
    },
  };
}
