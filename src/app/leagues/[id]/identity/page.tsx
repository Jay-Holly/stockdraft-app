import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { SdflIdentityForm } from "@/components/league/SdflIdentityForm";
import {
  isSdflLeague,
  memberNeedsSdflIdentity,
} from "@/lib/league/team-identity";

type PageProps = { params: Promise<{ id: string }> };

export default async function SdflIdentityPage({ params }: PageProps) {
  const { id: leagueId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth?mode=login&next=${encodeURIComponent(`/leagues/${leagueId}/identity`)}`);
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, sports_league_id, status, league_type")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league || league.league_type !== "human" || !isSdflLeague(league.sports_league_id)) {
    redirect("/dashboard");
  }

  const { data: membership } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    redirect("/dashboard");
  }

  const needsIdentity = await memberNeedsSdflIdentity(user.id, leagueId, supabase);
  if (!needsIdentity && league.status !== "waiting") {
    redirect(`/draft?league=${leagueId}`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-4 border-b border-dark-border">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Logo size="sm" />
          <Link
            href="/dashboard"
            className="text-xs text-muted hover:text-gold transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </header>
      <main className="flex-1 px-4 py-6 max-w-3xl mx-auto w-full">
        <SdflIdentityForm leagueId={leagueId} />
      </main>
    </div>
  );
}
