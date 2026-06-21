import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { FreeAgentsPageContent } from "@/components/season/FreeAgentsPageContent";

export default async function FreeAgentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  return (
    <SeasonShell title="Free Agents">
      <FreeAgentsPageContent />
    </SeasonShell>
  );
}
