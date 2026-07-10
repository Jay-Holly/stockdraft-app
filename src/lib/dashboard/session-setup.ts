import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  ensureAiLeagueReadyForMatchups,
  ensureHumanLeagueReadyForMatchups,
  scoreActiveMatchupsOnVisit,
} from "@/lib/matchup/scoring";
import type { Profile } from "@/lib/types";

export type DashboardSession = {
  profile: Profile;
  scoringNotice: string | null;
};

/**
 * Shared dashboard entry setup — profile fetch/create, matchup-readiness
 * checks, and on-visit scoring. Every dashboard page (home and each
 * category page) runs this on every visit, same as the single dashboard
 * page did before the category split.
 */
export async function ensureDashboardSession(
  supabase: SupabaseClient,
  user: User
): Promise<{ ok: true; session: DashboardSession } | { ok: false }> {
  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    const username =
      (user.user_metadata?.username as string) || `player_${user.id.slice(0, 8)}`;
    const teamName = (user.user_metadata?.team_name as string) || "My Team";
    const avatarColor = (user.user_metadata?.avatar_color as string) || "blue";

    const { data: newProfile } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        username,
        team_name: teamName,
        avatar_color: avatarColor,
      })
      .select()
      .single();

    profile = newProfile;
  }

  if (!profile) return { ok: false };

  await ensureAiLeagueReadyForMatchups(user.id);
  await ensureHumanLeagueReadyForMatchups(user.id);

  let scoringNotice: string | null = null;
  try {
    const scoring = await scoreActiveMatchupsOnVisit(user.id);
    if (scoring.error && !scoring.scored) {
      scoringNotice = scoring.error;
    } else if (scoring.notice) {
      scoringNotice = scoring.notice;
    }
  } catch (error) {
    console.error("Dashboard scoring failed:", error);
    scoringNotice =
      "Scoring temporarily unavailable — live prices could not be loaded. We'll retry on your next visit.";
  }

  return { ok: true, session: { profile: profile as Profile, scoringNotice } };
}
