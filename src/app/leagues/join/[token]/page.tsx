import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getLeagueInvitePreview } from "@/lib/league/human-league";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

function JoinPageShell({ children }: { children: React.ReactNode }) {
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
      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">{children}</main>
    </div>
  );
}

export default async function JoinLeaguePage({ params }: PageProps) {
  const { token } = await params;
  const preview = await getLeagueInvitePreview(token);

  if (!preview) {
    return (
      <JoinPageShell>
        <div>preview is null for token: {token}</div>
      </JoinPageShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let defaultTeamName = "My Team";
  let initialIsMember = false;
  let profileTeamName: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("team_name")
      .eq("id", user.id)
      .single();

    profileTeamName = profile?.team_name ?? null;
    defaultTeamName = profile?.team_name?.trim() || defaultTeamName;

    const { data: membership } = await supabase
      .from("league_members")
      .select("user_id")
      .eq("league_id", preview.leagueId)
      .eq("user_id", user.id)
      .maybeSingle();

    initialIsMember = Boolean(membership);
  }

  return (
    <JoinPageShell>
      <div className="space-y-2">
        <div>
          League: {preview.leagueName} — Status: {preview.status}
        </div>
        <div>Authenticated: {user ? "yes" : "no"}</div>
        {user ? <div>User ID: {user.id}</div> : null}
        <div>Default team name: {defaultTeamName}</div>
        {profileTeamName ? <div>Profile team name: {profileTeamName}</div> : null}
        <div>Is member: {initialIsMember ? "yes" : "no"}</div>
        <div>
          Roster: {preview.memberCount} / {preview.playerCount}
        </div>
      </div>
    </JoinPageShell>
  );
}
