import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveLeagueId } from "@/lib/league/active-league";
import { listHumanLeaguesForUser } from "@/lib/league/human-league";
import { ensureDashboardSession } from "@/lib/dashboard/session-setup";
import { CategoryPageHeader } from "@/components/dashboard/CategoryPageHeader";
import { SportsSimLeaguesPageContent } from "@/components/dashboard/SportsSimLeaguesPageContent";

export default async function SportsSimLeaguesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  const session = await ensureDashboardSession(supabase, user);
  if (!session.ok) {
    redirect("/dashboard");
  }

  const [allHumanLeagues, activeLeagueId] = await Promise.all([
    listHumanLeaguesForUser(user.id),
    resolveActiveLeagueId(user.id),
  ]);

  const leagues = allHumanLeagues.filter(
    (item) => item.league.format_type === "sports_league"
  );

  return (
    <div className="min-h-screen flex flex-col">
      <CategoryPageHeader title="Sports Sim" />
      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <SportsSimLeaguesPageContent
          leagues={leagues}
          currentUserId={user.id}
          activeLeagueId={activeLeagueId}
        />
      </main>
    </div>
  );
}
