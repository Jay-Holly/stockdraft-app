import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listHumanLeaguesForUser } from "@/lib/league/human-league";
import { ensureDashboardSession } from "@/lib/dashboard/session-setup";
import { CategoryPageHeader } from "@/components/dashboard/CategoryPageHeader";
import { SportsSimLandingPageContent } from "@/components/dashboard/SportsSimLandingPageContent";
import { PageWatermark } from "@/components/PageWatermark";

export default async function SportsSimLandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  const session = await ensureDashboardSession(supabase, user);
  if (!session.ok) {
    redirect("/dashboard");
  }

  const allHumanLeagues = await listHumanLeaguesForUser(user.id);

  const leagues = allHumanLeagues.filter(
    (item) => item.league.format_type === "sports_league"
  );

  return (
    <div className="min-h-screen flex flex-col">
      <PageWatermark />
      <CategoryPageHeader title="Sports Sim" />
      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <SportsSimLandingPageContent leagues={leagues} />
      </main>
    </div>
  );
}
