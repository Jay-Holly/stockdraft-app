import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { MyTeamPageContent } from "@/components/season/MyTeamPageContent";

export default async function MyTeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  return (
    <SeasonShell title="My Team">
      <MyTeamPageContent />
    </SeasonShell>
  );
}
