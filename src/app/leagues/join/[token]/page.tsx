import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getLeagueInvitePreview } from "@/lib/league/human-league";
import { JoinLeaguePanel } from "@/components/league/JoinLeaguePanel";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

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
        <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-3">
          <h1 className="text-xl font-bold">Invite not found</h1>
          <p className="text-sm text-muted">
            This invite link is invalid or has expired.
          </p>
          <Link
            href="/dashboard"
            className="inline-block text-sm text-gold hover:text-white transition-colors"
          >
            Back to dashboard
          </Link>
        </div>
      </JoinPageShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let defaultTeamName = "My Team";
  let initialIsMember = false;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("team_name")
      .eq("id", user.id)
      .single();

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
      <JoinLeaguePanel
        token={token}
        preview={preview}
        defaultTeamName={defaultTeamName}
        isAuthenticated={Boolean(user)}
        initialIsMember={initialIsMember}
      />
    </JoinPageShell>
  );
}
