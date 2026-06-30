import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeasonShell } from "@/components/season/SeasonShell";
import { AwardsPageContent } from "@/components/season/AwardsPageContent";

export default async function AwardsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?mode=login");

  return (
    <SeasonShell title="Awards">
      <AwardsPageContent />
    </SeasonShell>
  );
}
