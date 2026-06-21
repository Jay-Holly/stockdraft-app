import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { LeaguePageContent } from "@/components/season/LeaguePageContent";

export default async function LeaguePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  return (
    <SeasonShell title="League">
      <LeaguePageContent />
    </SeasonShell>
  );
}
