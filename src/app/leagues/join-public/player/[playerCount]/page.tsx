import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { PublicLeagueList } from "@/components/leagues/PublicLeagueList";
import { listPublicHumanLeagues } from "@/lib/league/human-league";
import { STANDARD_PLAYER_COUNTS } from "@/lib/league/league-config";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type PageProps = { params: Promise<{ playerCount: string }> };

export default async function JoinPublicPlayerLeaguePage({ params }: PageProps) {
  const { playerCount: playerCountParam } = await params;
  const playerCount = Number(playerCountParam);
  if (
    !Number.isInteger(playerCount) ||
    !STANDARD_PLAYER_COUNTS.includes(playerCount as (typeof STANDARD_PLAYER_COUNTS)[number])
  ) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/auth?mode=login&next=${encodeURIComponent(
        `/leagues/join-public/player/${playerCount}`
      )}`
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_name")
    .eq("id", user.id)
    .single();

  const defaultTeamName = profile?.team_name?.trim() || "My Team";
  const leagues = await listPublicHumanLeagues({ playerCount });

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
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">{playerCount}-Team Public Leagues</h1>
          <p className="text-muted text-sm">
            Join a standard player league that&apos;s still filling up.
          </p>
        </div>

        <PublicLeagueList leagues={leagues} defaultTeamName={defaultTeamName} />
      </main>
    </div>
  );
}
