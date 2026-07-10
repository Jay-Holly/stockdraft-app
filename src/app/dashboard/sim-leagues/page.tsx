import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveLeagueId } from "@/lib/league/active-league";
import { listAiLeagueListItems } from "@/lib/league/ai-league";
import { ensureDashboardSession } from "@/lib/dashboard/session-setup";
import { CategoryPageHeader } from "@/components/dashboard/CategoryPageHeader";
import { SimLeaguesPageContent } from "@/components/dashboard/SimLeaguesPageContent";

export default async function SimLeaguesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  const session = await ensureDashboardSession(supabase, user);
  if (!session.ok) {
    redirect("/dashboard");
  }

  const [leagues, activeLeagueId] = await Promise.all([
    listAiLeagueListItems(user.id),
    resolveActiveLeagueId(user.id),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <CategoryPageHeader title="Sim Leagues" />
      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <SimLeaguesPageContent
          leagues={leagues}
          currentUserId={user.id}
          activeLeagueId={activeLeagueId}
        />
      </main>
    </div>
  );
}
