import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveLeagueId } from "@/lib/league/active-league";
import { listHumanLeaguesForUser, listPendingHumanLeagueInvites } from "@/lib/league/human-league";
import {
  getAiLeagueSummary,
  listAiLeagueListItems,
} from "@/lib/league/ai-league";
import {
  ensureAiLeagueReadyForMatchups,
  ensureHumanLeagueReadyForMatchups,
  scoreActiveMatchupsOnVisit,
} from "@/lib/matchup/scoring";
import { DashboardContent } from "@/components/DashboardContent";
import { Logo } from "@/components/Logo";
import { PageWatermark } from "@/components/PageWatermark";
import { loadDayTraderDashboardSummary } from "@/lib/day-trader/dashboard-summary";
import type { Profile } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?mode=login");
  }

  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    const username =
      (user.user_metadata?.username as string) ||
      `player_${user.id.slice(0, 8)}`;
    const teamName =
      (user.user_metadata?.team_name as string) || "My Team";
    const avatarColor =
      (user.user_metadata?.avatar_color as string) || "blue";

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

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 mb-4">
            Could not load your profile. Make sure you ran the database migration
            in Supabase.
          </p>
          <Link href="/" className="text-gold hover:underline">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

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

  const [aiLeagues, humanLeagues, activeLeagueId, pendingInvites, dayTrader] =
    await Promise.all([
      listAiLeagueListItems(user.id),
      listHumanLeaguesForUser(user.id),
      resolveActiveLeagueId(user.id),
      listPendingHumanLeagueInvites(),
      loadDayTraderDashboardSummary(user.id),
    ]);

  const activeHumanLeague = humanLeagues.find((h) => h.league.id === activeLeagueId);
  const activeSummary = activeLeagueId && !activeHumanLeague
    ? await getAiLeagueSummary(user.id, activeLeagueId)
    : null;

  return (
    <div className="min-h-screen flex flex-col">
      <PageWatermark />
      <header className="px-4 py-4 border-b border-dark-border">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Logo size="sm" />
          <span className="text-xs text-gold font-semibold uppercase tracking-wider">
            Dashboard
          </span>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <Suspense fallback={<p className="text-muted text-sm py-12 text-center">Loading dashboard…</p>}>
          <DashboardContent
            profile={profile as Profile}
            leagues={aiLeagues}
            humanLeagues={humanLeagues}
            activeHumanLeague={activeHumanLeague ?? null}
            activeLeagueId={activeLeagueId}
            activeSummary={activeSummary}
            scoringNotice={scoringNotice}
            pendingInvites={pendingInvites}
            dayTrader={dayTrader}
          />
        </Suspense>
      </main>
    </div>
  );
}
