import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { FreeAgentsPageContent } from "@/components/season/FreeAgentsPageContent";
import { isSeasonLeagueSportsSim, resolveSeasonLeague, seasonLeagueThemeId } from "@/lib/roster/server";

export default async function FreeAgentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  const league = await resolveSeasonLeague(user.id);
  const isSportsSim = league ? isSeasonLeagueSportsSim(league) : false;

  return (
    <SeasonShell title="Free Agents" isSportsSim={isSportsSim} themeId={seasonLeagueThemeId(league)}>
      <FreeAgentsPageContent />
    </SeasonShell>
  );
}
