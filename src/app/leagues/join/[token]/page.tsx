import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getLeagueInvitePreview } from "@/lib/league/human-league";
import { JoinLeaguePanel } from "@/components/league/JoinLeaguePanel";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type PageProps = { params: Promise<{ token: string }> };

const LOG = "[JoinLeaguePage]";

function isNextNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    (error as { digest?: string }).digest === "NEXT_NOT_FOUND"
  );
}

export default async function JoinLeaguePage({ params }: PageProps) {
  try {
    console.log(`${LOG} enter`, { paramsType: typeof params });

    const resolvedParams = await params;
    console.log(`${LOG} resolvedParams`, resolvedParams);

    const { token } = resolvedParams;
    console.log(`${LOG} token`, {
      token,
      tokenLength: token?.length,
      tokenTrimmed: token?.trim(),
    });

    const preview = await getLeagueInvitePreview(token);
    console.log(`${LOG} getLeagueInvitePreview result`, {
      token,
      previewIsNull: preview === null,
      previewIsUndefined: preview === undefined,
      previewTruthy: Boolean(preview),
      preview,
    });

    if (!preview) {
      console.error(`${LOG} PATH → notFound()`, {
        reason: "getLeagueInvitePreview returned falsy",
        token,
        preview,
      });
      notFound();
    }

    console.log(`${LOG} preview accepted`, {
      leagueId: preview.leagueId,
      leagueName: preview.leagueName,
      status: preview.status,
      memberCount: preview.memberCount,
      playerCount: preview.playerCount,
    });

    const supabase = await createClient();
    console.log(`${LOG} supabase client created`);

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    console.log(`${LOG} auth.getUser`, {
      hasUser: Boolean(user),
      userId: user?.id ?? null,
      authError: authError
        ? { message: authError.message, name: authError.name }
        : null,
    });

    let defaultTeamName = "My Team";
    let initialIsMember = false;

    if (user) {
      console.log(`${LOG} loading profile for user`, { userId: user.id });

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("team_name")
        .eq("id", user.id)
        .single();

      console.log(`${LOG} profile query`, {
        profile,
        profileError: profileError
          ? { message: profileError.message, code: profileError.code }
          : null,
      });

      defaultTeamName = profile?.team_name?.trim() || defaultTeamName;

      console.log(`${LOG} loading membership`, {
        leagueId: preview.leagueId,
        userId: user.id,
      });

      const { data: membership, error: membershipError } = await supabase
        .from("league_members")
        .select("user_id")
        .eq("league_id", preview.leagueId)
        .eq("user_id", user.id)
        .maybeSingle();

      console.log(`${LOG} membership query`, {
        membership,
        membershipError: membershipError
          ? { message: membershipError.message, code: membershipError.code }
          : null,
      });

      initialIsMember = Boolean(membership);
    } else {
      console.log(`${LOG} skipping profile/membership — no authenticated user`);
    }

    const renderProps = {
      token,
      preview,
      defaultTeamName,
      isAuthenticated: Boolean(user),
      initialIsMember,
    };

    console.log(`${LOG} PATH → return JSX`, renderProps);

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

        <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
          <JoinLeaguePanel
            token={token}
            preview={preview}
            defaultTeamName={defaultTeamName}
            isAuthenticated={Boolean(user)}
            initialIsMember={initialIsMember}
          />
        </main>
      </div>
    );
  } catch (error) {
    if (isNextNotFoundError(error)) {
      console.error(`${LOG} catch — rethrowing NEXT_NOT_FOUND from notFound()`, {
        error,
      });
      throw error;
    }

    console.error(`${LOG} catch — unexpected error (NOT notFound path)`, {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
    });
    throw error;
  }
}
