import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { MatchupsPageContent } from "@/components/season/MatchupsPageContent";

export default async function MatchupsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  return (
    <SeasonShell title="Matchups">
      <MatchupsPageContent />
    </SeasonShell>
  );
}
