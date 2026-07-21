import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { StandingsPageContent } from "@/components/season/StandingsPageContent";
import { isSeasonLeagueSportsSim, resolveSeasonLeague, seasonLeagueThemeId } from "@/lib/roster/server";

export default async function StandingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  const league = await resolveSeasonLeague(user.id);
  if (!league) redirect("/league");

  const isSportsSim = isSeasonLeagueSportsSim(league);

  return (
    <SeasonShell title="Standings" isSportsSim={isSportsSim} themeId={seasonLeagueThemeId(league)}>
      <StandingsPageContent leagueId={league.id} currentUserId={user.id} />
    </SeasonShell>
  );
}
