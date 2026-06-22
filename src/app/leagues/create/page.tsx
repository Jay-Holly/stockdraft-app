import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CreateLeagueForm } from "@/components/league/CreateLeagueForm";
import { Logo } from "@/components/Logo";

export default async function CreateLeaguePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?mode=login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_name")
    .eq("id", user.id)
    .single();

  const defaultTeamName = profile?.team_name?.trim() || "My Team";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-4 border-b border-dark-border">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Logo size="sm" />
          <Link
            href="/dashboard"
            className="text-xs text-muted hover:text-gold transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Create a league</h1>
          <p className="text-muted text-sm mt-1">
            Configure your league. The 2-player private all-human path is live
            today — other options are selectable for planning ahead.
          </p>
        </div>

        <CreateLeagueForm defaultTeamName={defaultTeamName} />
      </main>
    </div>
  );
}
