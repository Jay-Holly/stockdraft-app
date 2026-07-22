import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { PublicLeagueList } from "@/components/leagues/PublicLeagueList";
import { listPublicHumanLeagues } from "@/lib/league/human-league";
import {
  SPORTS_LEAGUE_FORMATS,
  leagueThemeIdForSportsLeague,
} from "@/lib/league/league-config";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type PageProps = { params: Promise<{ sportsLeagueId: string }> };

export default async function JoinPublicSportsSimLeaguePage({ params }: PageProps) {
  const { sportsLeagueId } = await params;
  const format = SPORTS_LEAGUE_FORMATS.find((f) => f.id === sportsLeagueId);
  if (!format) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/auth?mode=login&next=${encodeURIComponent(
        `/leagues/join-public/sports-sim/${sportsLeagueId}`
      )}`
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_name")
    .eq("id", user.id)
    .single();

  const defaultTeamName = profile?.team_name?.trim() || "My Team";
  const leagues = await listPublicHumanLeagues({ sportsLeagueId });
  const themeId = leagueThemeIdForSportsLeague(sportsLeagueId);

  return (
    <div className="min-h-screen flex flex-col" data-league-theme={themeId}>
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
        <div className="text-center space-y-2">
          {format.logoSrc ? (
            <Image
              src={format.logoSrc}
              alt={format.label}
              width={96}
              height={120}
              className="mx-auto rounded"
            />
          ) : null}
          <h1 className="text-2xl font-bold">{format.label} Public Leagues</h1>
          <p className="text-muted text-sm">{format.description}</p>
        </div>

        <PublicLeagueList
          leagues={leagues}
          defaultTeamName={defaultTeamName}
          sportsLeagueId={sportsLeagueId}
        />
      </main>
    </div>
  );
}
