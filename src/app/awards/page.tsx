import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { AwardsPageContent } from "@/components/season/AwardsPageContent";
import { isSeasonLeagueSportsSim, resolveSeasonLeague } from "@/lib/roster/server";

export default async function AwardsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  const league = await resolveSeasonLeague(user.id);
  const isSportsSim = league ? isSeasonLeagueSportsSim(league) : false;

  return (
    <SeasonShell title="Awards" isSportsSim={isSportsSim}>
      <AwardsPageContent />
    </SeasonShell>
  );
}
