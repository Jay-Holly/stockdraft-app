import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { MyTeamPageContent } from "@/components/season/MyTeamPageContent";
import {
  isSeasonLeagueSportsSim,
  loadMyTeamPageData,
  resolveSeasonLeague,
  seasonLeagueThemeId,
} from "@/lib/roster/server";

export default async function MyTeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  const league = await resolveSeasonLeague(user.id);
  const isSportsSim = league ? isSeasonLeagueSportsSim(league) : false;

  // Fetched server-side so the first paint has real data instead of a
  // client-side "Loading roster..." flash on every navigation. The client
  // component still refreshes itself afterward (live prices, polling).
  const initial = await loadMyTeamPageData(user.id);

  return (
    <SeasonShell title="My Team" isSportsSim={isSportsSim} themeId={seasonLeagueThemeId(league)}>
      <MyTeamPageContent
        initialRoster={initial.ok ? initial.data : null}
        initialError={initial.ok ? null : initial.error}
      />
    </SeasonShell>
  );
}
