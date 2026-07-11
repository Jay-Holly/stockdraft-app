import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { MyTeamPageContent } from "@/components/season/MyTeamPageContent";
import { isSeasonLeagueSportsSim, resolveSeasonLeague, seasonLeagueThemeId } from "@/lib/roster/server";

export default async function MyTeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  const league = await resolveSeasonLeague(user.id);
  const isSportsSim = league ? isSeasonLeagueSportsSim(league) : false;

  return (
    <SeasonShell title="My Team" isSportsSim={isSportsSim} themeId={seasonLeagueThemeId(league)}>
      <MyTeamPageContent />
    </SeasonShell>
  );
}
