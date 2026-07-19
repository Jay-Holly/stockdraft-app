import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { LeaguePageContent } from "@/components/season/LeaguePageContent";
import {
  isSeasonLeagueSportsSim,
  loadLeaguePageData,
  resolveSeasonLeague,
  seasonLeagueThemeId,
} from "@/lib/roster/server";

export default async function LeaguePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  const league = await resolveSeasonLeague(user.id);
  const isSportsSim = league ? isSeasonLeagueSportsSim(league) : false;

  // Fetched server-side so the first paint has real data instead of a
  // client-side loading flash on every navigation.
  const initial = await loadLeaguePageData(user.id);

  return (
    <SeasonShell title="League" isSportsSim={isSportsSim} themeId={seasonLeagueThemeId(league)}>
      <LeaguePageContent
        initialData={initial.ok ? initial.data : null}
        initialError={initial.ok ? null : initial.error}
      />
    </SeasonShell>
  );
}
