import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { SdflIdentityForm } from "@/components/league/SdflIdentityForm";
import { GenericTeamMapForm } from "@/components/league/GenericTeamMapForm";
import {
  isSdflLeague,
  memberNeedsSdflIdentity,
} from "@/lib/league/team-identity";
import {
  isGenericMapLeague,
  memberNeedsGenericMapClaim,
} from "@/lib/league/generic-team-map";

type PageProps = { params: Promise<{ id: string }> };

export default async function LeagueIdentityPage({ params }: PageProps) {
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

  const isSdfl = league ? isSdflLeague(league.sports_league_id) : false;
  const isGenericMap = league ? isGenericMapLeague(league.sports_league_id) : false;

  if (!league || league.league_type !== "human" || (!isSdfl && !isGenericMap)) {
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

  const needsIdentity = isSdfl
    ? await memberNeedsSdflIdentity(user.id, leagueId, supabase)
    : await memberNeedsGenericMapClaim(user.id, leagueId, supabase);

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
        {isSdfl ? (
          <SdflIdentityForm leagueId={leagueId} />
        ) : (
          <GenericTeamMapForm leagueId={leagueId} />
        )}
      </main>
    </div>
  );
}
