import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { MatchupsPageContent } from "@/components/season/MatchupsPageContent";
import { isSeasonLeagueSportsSim, resolveSeasonLeague, seasonLeagueThemeId } from "@/lib/roster/server";
import { loadMatchupsPageData } from "@/lib/matchup/page-data";

export default async function MatchupsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  const league = await resolveSeasonLeague(user.id);
  const isSportsSim = league ? isSeasonLeagueSportsSim(league) : false;

  // Fetched server-side so the first paint has real data instead of a
  // client-side "Loading matchups..." flash on every navigation. The client
  // component still refreshes itself afterward (live prices, polling).
  const initial = await loadMatchupsPageData(user.id);

  return (
    <SeasonShell title="Matchups" isSportsSim={isSportsSim} themeId={seasonLeagueThemeId(league)}>
      <MatchupsPageContent
        initialData={initial.ok ? initial.data : null}
        initialError={initial.ok ? null : initial.error}
      />
    </SeasonShell>
  );
}
