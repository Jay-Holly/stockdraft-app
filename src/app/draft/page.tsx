import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveAiLeagueId } from "@/lib/league/active-league";
import { DraftRoom } from "@/components/draft/DraftRoom";
import { Logo } from "@/components/Logo";
import type { Draft } from "@/lib/draft/types";
import type { Profile } from "@/lib/types";

export default async function DraftPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?mode=login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/dashboard");
  }

  const activeLeagueId = await resolveActiveAiLeagueId(user.id);
  let draft: Draft | null = null;

  if (activeLeagueId) {
    const { data } = await supabase
      .from("drafts")
      .select("*")
      .eq("user_id", user.id)
      .eq("league_id", activeLeagueId)
      .maybeSingle();
    draft = (data as Draft | null) ?? null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-4 border-b border-dark-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Logo size="sm" />
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-xs text-muted hover:text-gold transition-colors"
            >
              Dashboard
            </Link>
            <span className="text-xs text-gold font-semibold uppercase tracking-wider">
              Draft Room
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-5xl mx-auto w-full">
        <DraftRoom
          profile={profile as Profile}
          initialDraft={draft}
        />
      </main>
    </div>
  );
}
